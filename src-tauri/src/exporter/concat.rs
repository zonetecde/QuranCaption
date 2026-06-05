use crate::path_utils;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::batching;
use super::codec;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::types::{ExportPerformanceProfile, FfmpegProgressContext};

// ---------------------------------------------------------------------------
// Fichier de concaténation FFmpeg
// ---------------------------------------------------------------------------

/// Écrit un fichier `.ffconcat` listant les vidéos à concaténer.
///
/// Chaque entrée est échappée via `path_utils::escape_ffconcat_path` pour
/// gérer les caractères spéciaux dans les chemins.
pub fn write_video_concat_file(
    base_dir: &Path,
    export_id: &str,
    video_paths: &[String],
) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync + 'static>> {
    fs::create_dir_all(base_dir)?;

    let concat_content = video_paths.join("|");
    let concat_hash = format!("{:x}", md5::compute(concat_content.as_bytes()));
    let concat_path = base_dir.join(format!(
        "videos-{}-{}.ffconcat",
        export_id,
        &concat_hash[..8]
    ));
    let mut concat_file = fs::File::create(&concat_path)?;

    writeln!(concat_file, "ffconcat version 1.0")?;
    for video_path in video_paths {
        let escaped = path_utils::escape_ffconcat_path(video_path);
        writeln!(concat_file, "file '{}'", escaped)?;
    }

    Ok(concat_path)
}

// ---------------------------------------------------------------------------
// Concaténation sans ré-encodage (stream copy)
// ---------------------------------------------------------------------------

/// Concatène des vidéos homogènes sans ré-encoder les flux (stream copy).
///
/// Utilise le demuxer `concat` de FFmpeg avec `-c copy`.
/// Pour les conteneurs MP4/MOV, ajoute `-movflags +faststart`.
pub fn concat_videos_with_stream_copy(
    export_id: &str,
    video_paths: &[String],
    output_path: &str,
    total_duration_s: f64,
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    ffmpeg_runner::ensure_export_not_cancelled(export_id)?;

    let output_path_buf = path_utils::normalize_output_path(output_path);
    if let Some(parent) = output_path_buf.parent() {
        fs::create_dir_all(parent)?;
    }

    let base_dir = output_path_buf
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let concat_path = write_video_concat_file(&base_dir, export_id, video_paths)?;
    let concat_name = concat_path.to_string_lossy().to_string();
    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());

    let mut cmd = vec![
        ffmpeg_exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-i".to_string(),
        concat_name,
        "-c".to_string(),
        "copy".to_string(),
    ];

    // Faststart pour les conteneurs compatibles
    let ext = output_path_buf
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }

    cmd.push(output_path_buf.to_string_lossy().to_string());

    println!(
        "[batching] concat stream-copy: {} fichier(s) -> {}",
        video_paths.len(),
        output_path
    );

    let result = ffmpeg_runner::run_ffmpeg_command(
        export_id,
        &cmd,
        Some(FfmpegProgressContext {
            base_time_s: 0.0,
            total_time_s: total_duration_s.max(0.001),
            local_duration_s: total_duration_s.max(0.001),
            suppress_error_event: false,
            current_batch_size: None,
        }),
        Some("Merging Files"),
        None,
        app_handle,
    );
    fs::remove_file(concat_path).ok();
    result
}

// ---------------------------------------------------------------------------
// Codec audio pour l'export final
// ---------------------------------------------------------------------------

/// Ajoute les arguments de codec audio correspondant au type d'export.
///
/// - Export sans fond + MOV : AAC 320k
/// - Export sans fond + WebM : Opus 256k
/// - Export avec fond : AAC 320k
pub fn append_export_audio_codec_args(
    cmd: &mut Vec<String>,
    export_without_background: bool,
    use_mov_alpha: bool,
) {
    if export_without_background && !use_mov_alpha {
        cmd.extend_from_slice(&[
            "-c:a".to_string(),
            "libopus".to_string(),
            "-b:a".to_string(),
            "256k".to_string(),
        ]);
    } else {
        cmd.extend_from_slice(&[
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "320k".to_string(),
        ]);
    }
}

// ---------------------------------------------------------------------------
// Muxage vidéo + audio (sans ré-encodage vidéo)
// ---------------------------------------------------------------------------

/// Assemble une vidéo déjà rendue avec les pistes audio, sans ré-encoder la vidéo.
///
/// Applique les trims audio (`start_s` → `total_duration_s`), les fades audio
/// optionnels, et le faststart pour les conteneurs compatibles.
#[allow(clippy::too_many_arguments)]
pub fn mux_video_copy_with_audio(
    export_id: &str,
    video_path: &str,
    audio_paths: &[String],
    output_path: &str,
    total_duration_s: f64,
    start_s: f64,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    export_without_background: bool,
    use_mov_alpha: bool,
    performance_profile: ExportPerformanceProfile,
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    ffmpeg_runner::ensure_export_not_cancelled(export_id)?;

    let output_path_buf = path_utils::normalize_output_path(output_path);
    if let Some(parent) = output_path_buf.parent() {
        fs::create_dir_all(parent)?;
    }

    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let mut cmd = vec![
        ffmpeg_exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-i".to_string(),
        video_path.to_string(),
    ];

    for audio_path in audio_paths {
        cmd.extend_from_slice(&["-i".to_string(), audio_path.clone()]);
    }

    let fade_s = (export_fade_duration_ms as f64 / 1000.0)
        .max(0.0)
        .min(total_duration_s.max(0.0));
    let apply_audio_fade = audio_fade_in_enabled || audio_fade_out_enabled;
    let mut mapped_audio_label: Option<String> = None;

    // Construction du filtre audio
    if !audio_paths.is_empty() {
        let mut filter_lines: Vec<String> = Vec::new();
        if audio_paths.len() == 1 {
            filter_lines.push("[1:a]aresample=48000[aa0]".to_string());
            filter_lines.push(format!(
                "[aa0]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, total_duration_s
            ));
        } else {
            let mut audio_inputs = String::new();
            for idx in 0..audio_paths.len() {
                filter_lines.push(format!("[{}:a]aresample=48000[aa{}]", idx + 1, idx));
                audio_inputs.push_str(&format!("[aa{}]", idx));
            }
            filter_lines.push(format!(
                "{}concat=n={}:v=0:a=1[aacat]",
                audio_inputs,
                audio_paths.len()
            ));
            filter_lines.push(format!(
                "[aacat]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, total_duration_s
            ));
        }

        let mut current_audio_label = "aoutraw".to_string();
        if apply_audio_fade && fade_s > 0.0 {
            if audio_fade_in_enabled {
                filter_lines.push(format!(
                    "[{}]afade=t=in:st=0:d={:.6}[afadein]",
                    current_audio_label, fade_s
                ));
                current_audio_label = "afadein".to_string();
            }
            if audio_fade_out_enabled {
                let fade_out_start = (total_duration_s - fade_s).max(0.0);
                filter_lines.push(format!(
                    "[{}]afade=t=out:st={:.6}:d={:.6}[afadeout]",
                    current_audio_label, fade_out_start, fade_s
                ));
                current_audio_label = "afadeout".to_string();
            }
        }

        cmd.extend_from_slice(&["-filter_complex".to_string(), filter_lines.join(";")]);
        mapped_audio_label = Some(current_audio_label);
    }

    // Mapping vidéo (stream copy)
    cmd.extend_from_slice(&[
        "-map".to_string(),
        "0:v:0".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
    ]);

    // Mapping audio
    if let Some(audio_label) = mapped_audio_label {
        cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", audio_label)]);
        append_export_audio_codec_args(&mut cmd, export_without_background, use_mov_alpha);
    } else {
        cmd.push("-an".to_string());
    }

    if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }

    cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", total_duration_s)]);

    let ext = output_path_buf
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }

    cmd.push(output_path_buf.to_string_lossy().to_string());

    ffmpeg_runner::run_ffmpeg_command(
        export_id,
        &cmd,
        Some(FfmpegProgressContext {
            base_time_s: 0.0,
            total_time_s: total_duration_s.max(0.001),
            local_duration_s: total_duration_s.max(0.001),
            suppress_error_event: false,
            current_batch_size: None,
        }),
        Some("Merging Files"),
        None,
        app_handle,
    )
}

// ---------------------------------------------------------------------------
// Concaténation finale des batchs internes
// ---------------------------------------------------------------------------

/// Assemble les vidéos de batchs internes en une vidéo finale, avec audio, fades,
/// et choix du codec selon le type d'export.
///
/// Si un seul batch sans fades ni audio → simple copie de fichier.
/// Si pas de fades vidéo et pas d'export transparent → stream copy puis mux audio.
/// Sinon → ré-encodage complet avec filtre complexe.
#[allow(clippy::too_many_arguments)]
pub fn concat_internal_batch_videos(
    export_id: &str,
    batch_paths: &[String],
    batch_durations_s: &[f64],
    output_path: &str,
    total_duration_s: f64,
    start_time_ms: i32,
    audio_paths: &[String],
    video_fade_in_enabled: bool,
    video_fade_out_enabled: bool,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    export_without_background: bool,
    transparent_export_format: Option<&str>,
    performance_profile: ExportPerformanceProfile,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    if batch_paths.is_empty() {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Aucune vidéo de batch à concaténer",
        )));
    }
    if batch_paths.len() != batch_durations_s.len() {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Le nombre de vidéos de batch ne correspond pas au nombre de durées",
        )));
    }

    ffmpeg_runner::ensure_export_not_cancelled(export_id)?;

    let apply_video_fade = video_fade_in_enabled || video_fade_out_enabled;
    let apply_audio_fade = audio_fade_in_enabled || audio_fade_out_enabled;
    let apply_any_fade = apply_video_fade || apply_audio_fade;
    let use_mov_alpha =
        batching::transparent_export_uses_mov(export_without_background, transparent_export_format);
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);
    let total_audio_s: f64 = audio_paths
        .iter()
        .map(|p| ffmpeg_utils::ffprobe_duration_sec(p))
        .sum();
    let have_audio = !audio_paths.is_empty() && start_s < total_audio_s - 1e-6;

    // Cas trivial : 1 seul batch, pas de fades, pas d'audio → copie directe
    if batch_paths.len() == 1 && !apply_any_fade && !have_audio {
        fs::copy(&batch_paths[0], output_path)?;
        return Ok(());
    }

    let output_path_buf = path_utils::normalize_output_path(output_path);
    if let Some(parent) = output_path_buf.parent() {
        fs::create_dir_all(parent)?;
    }

    for batch_path in batch_paths {
        if !Path::new(batch_path).exists() {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Batch video not found: {}", batch_path),
            )));
        }
    }

    let fade_s = (export_fade_duration_ms as f64 / 1000.0)
        .max(0.0)
        .min(total_duration_s.max(0.0));
    let expected_video_s: f64 = batch_durations_s.iter().sum();
    println!(
        "[batching] concat interne: {} batch(s), duree calculee={:.6}s, duree finale={:.6}s",
        batch_paths.len(),
        expected_video_s,
        total_duration_s
    );

    // Voie rapide : pas de fades vidéo, pas d'export transparent → stream copy
    let can_copy_rendered_video = !apply_video_fade && !export_without_background;
    if can_copy_rendered_video {
        if have_audio {
            let temp_video_path = if batch_paths.len() > 1 {
                let temp_path = ffmpeg_utils::build_temp_output_path(&output_path_buf);
                let temp_output = temp_path.to_string_lossy().to_string();
                concat_videos_with_stream_copy(
                    export_id,
                    batch_paths,
                    &temp_output,
                    expected_video_s,
                    &app_handle,
                )?;
                Some(temp_path)
            } else {
                None
            };
            let video_path_for_mux = temp_video_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|| batch_paths[0].clone());

            let mux_result = mux_video_copy_with_audio(
                export_id,
                &video_path_for_mux,
                audio_paths,
                output_path,
                total_duration_s,
                start_s,
                audio_fade_in_enabled,
                audio_fade_out_enabled,
                export_fade_duration_ms,
                export_without_background,
                use_mov_alpha,
                performance_profile,
                &app_handle,
            );

            if let Some(temp_path) = temp_video_path {
                fs::remove_file(temp_path).ok();
            }

            return mux_result;
        }

        concat_videos_with_stream_copy(
            export_id,
            batch_paths,
            output_path,
            total_duration_s,
            &app_handle,
        )?;
        return Ok(());
    }

    // Voie complète : ré-encodage avec filtre complexe
    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let tmp_dir = output_path_buf
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    fs::create_dir_all(&tmp_dir).ok();
    let video_concat_path = write_video_concat_file(&tmp_dir, export_id, batch_paths)?;
    let video_concat_name = video_concat_path.to_string_lossy().to_string();
    let mut cmd = vec![
        ffmpeg_exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-i".to_string(),
        video_concat_name,
    ];

    for audio_path in audio_paths {
        cmd.extend_from_slice(&["-i".to_string(), audio_path.clone()]);
    }

    let mut filter_lines: Vec<String> = Vec::new();
    filter_lines.push(format!(
        "[0:v]trim=start=0:duration={:.6},setpts=PTS-STARTPTS[vcat]",
        expected_video_s.max(0.001)
    ));

    let mut mapped_video_label = "vcat".to_string();
    if apply_video_fade && fade_s > 0.0 {
        if video_fade_in_enabled {
            let fade_expr = if export_without_background {
                format!("fade=t=in:st=0:d={:.6}:alpha=1", fade_s)
            } else {
                format!("fade=t=in:st=0:d={:.6}", fade_s)
            };
            filter_lines.push(format!("[{}]{}[vfadein]", mapped_video_label, fade_expr));
            mapped_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled {
            let fade_out_start = (total_duration_s - fade_s).max(0.0);
            let fade_expr = if export_without_background {
                format!(
                    "fade=t=out:st={:.6}:d={:.6}:alpha=1",
                    fade_out_start, fade_s
                )
            } else {
                format!("fade=t=out:st={:.6}:d={:.6}", fade_out_start, fade_s)
            };
            filter_lines.push(format!("[{}]{}[vfadeout]", mapped_video_label, fade_expr));
            mapped_video_label = "vfadeout".to_string();
        }
    }

    let mut mapped_audio_label: Option<String> = None;
    if have_audio {
        let audio_start_idx = 1;
        if audio_paths.len() == 1 {
            filter_lines.push(format!("[{}:a]aresample=48000[aa0]", audio_start_idx));
            filter_lines.push(format!(
                "[aa0]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, total_duration_s
            ));
        } else {
            for idx in 0..audio_paths.len() {
                filter_lines.push(format!(
                    "[{}:a]aresample=48000[aa{}]",
                    audio_start_idx + idx,
                    idx
                ));
            }
            let mut ins = String::new();
            for idx in 0..audio_paths.len() {
                ins.push_str(&format!("[aa{}]", idx));
            }
            filter_lines.push(format!(
                "{}concat=n={}:v=0:a=1[aacat]",
                ins,
                audio_paths.len()
            ));
            filter_lines.push(format!(
                "[aacat]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, total_duration_s
            ));
        }

        let mut current_audio_label = "aoutraw".to_string();
        if apply_audio_fade && fade_s > 0.0 {
            if audio_fade_in_enabled {
                filter_lines.push(format!(
                    "[{}]afade=t=in:st=0:d={:.6}[afadein]",
                    current_audio_label, fade_s
                ));
                current_audio_label = "afadein".to_string();
            }
            if audio_fade_out_enabled {
                let fade_out_start = (total_duration_s - fade_s).max(0.0);
                filter_lines.push(format!(
                    "[{}]afade=t=out:st={:.6}:d={:.6}[afadeout]",
                    current_audio_label, fade_out_start, fade_s
                ));
                current_audio_label = "afadeout".to_string();
            }
        }

        mapped_audio_label = Some(current_audio_label);
    }

    let filter_complex = filter_lines.join(";");
    let fg_hash = format!("{:x}", md5::compute(filter_complex.as_bytes()));
    let fg_path = tmp_dir.join(format!("merge-{}.ffgraph", &fg_hash[..8]));
    fs::write(&fg_path, &filter_complex)?;

    cmd.extend_from_slice(&[
        "-filter_complex_script".to_string(),
        fg_path.to_string_lossy().to_string(),
        "-map".to_string(),
        format!("[{}]", mapped_video_label),
    ]);

    // Choix du codec vidéo selon le type d'export
    if export_without_background && use_mov_alpha {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "qtrle".to_string(),
            "-pix_fmt".to_string(),
            "argb".to_string(),
        ]);
    } else if export_without_background {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-crf".to_string(),
            "28".to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-row-mt".to_string(),
            "1".to_string(),
            "-cpu-used".to_string(),
            "2".to_string(),
            "-pix_fmt".to_string(),
            "yuva420p".to_string(),
        ]);
    } else {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "veryfast".to_string(),
            "-crf".to_string(),
            "18".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    }

    if let Some(audio_label) = mapped_audio_label {
        if export_without_background && use_mov_alpha {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        } else if export_without_background {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "libopus".to_string(),
                "-b:a".to_string(),
                "256k".to_string(),
            ]);
        } else {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        }
    } else {
        cmd.push("-an".to_string());
    }

    if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }

    cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", total_duration_s)]);

    let ext = output_path_buf
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }

    cmd.push(output_path_buf.to_string_lossy().to_string());

    let result = ffmpeg_runner::run_ffmpeg_command(
        export_id,
        &cmd,
        Some(FfmpegProgressContext {
            base_time_s: 0.0,
            total_time_s: total_duration_s.max(0.001),
            local_duration_s: total_duration_s.max(0.001),
            suppress_error_event: false,
            current_batch_size: None,
        }),
        Some("Merging Files"),
        None,
        &app_handle,
    );
    fs::remove_file(video_concat_path).ok();
    result
}
