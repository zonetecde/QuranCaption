use crate::path_utils;

use std::fs;
use std::path::Path;

use super::batching;
use super::codec;
use super::concat;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::types::{ExportPerformanceProfile, ExportVideoCodec, FfmpegProgressContext};

// ---------------------------------------------------------------------------

/// Concatène plusieurs vidéos en une seule.
///
/// Supporte les fades vidéo/audio optionnels, l'export transparent
/// (MOV ProRes ou WebM VP9 avec alpha), et le stream-copy quand aucun
/// traitement n'est nécessaire.
#[tauri::command]
pub async fn concat_videos(
    export_id: String,
    video_paths: Vec<String>,
    output_path: String,
    video_fade_in_enabled: Option<bool>,
    video_fade_out_enabled: Option<bool>,
    audio_fade_in_enabled: Option<bool>,
    audio_fade_out_enabled: Option<bool>,
    export_fade_duration_ms: Option<i32>,
    export_without_background: Option<bool>,
    transparent_export_format: Option<String>,
    video_codec: Option<ExportVideoCodec>,
    fps: Option<i32>,
    performance_profile: ExportPerformanceProfile,
    promotion_enabled: Option<bool>,
    promotion_position: Option<String>,
    video_width: Option<i32>,
    video_height: Option<i32>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Normalisation des chemins
    let normalized_video_paths: Vec<String> = video_paths
        .into_iter()
        .map(|p| {
            path_utils::normalize_existing_path(&p)
                .to_string_lossy()
                .to_string()
        })
        .collect();
    let output_path_buf = path_utils::normalize_output_path(&output_path);
    let output_path_str = output_path_buf.to_string_lossy().to_string();

    println!(
        "[concat_videos] Début de la concaténation de {} vidéos",
        normalized_video_paths.len()
    );
    println!("[concat_videos] Fichier de sortie: {}", output_path_str);
    println!(
        "[concat_videos] export_fade: video(in={}, out={}) audio(in={}, out={}) duration(ms)={}",
        video_fade_in_enabled.unwrap_or(false),
        video_fade_out_enabled.unwrap_or(false),
        audio_fade_in_enabled.unwrap_or(false),
        audio_fade_out_enabled.unwrap_or(false),
        export_fade_duration_ms.unwrap_or(0)
    );
    println!(
        "[concat_videos] export_without_background={}",
        export_without_background.unwrap_or(false)
    );
    println!(
        "[concat_videos] transparent_export_format={}",
        transparent_export_format
            .as_deref()
            .unwrap_or("mov_prores_4444")
    );
    let video_codec = video_codec.unwrap_or(ExportVideoCodec::H264);
    let promotion_enabled = promotion_enabled.unwrap_or(false);
    let promotion_position = promotion_position.as_deref().unwrap_or("end");
    let promotion_fps = fps.unwrap_or(30);
    let promotion_width = video_width.unwrap_or(0);
    let promotion_height = video_height.unwrap_or(0);

    let apply_video_fade =
        video_fade_in_enabled.unwrap_or(false) || video_fade_out_enabled.unwrap_or(false);
    let apply_audio_fade =
        audio_fade_in_enabled.unwrap_or(false) || audio_fade_out_enabled.unwrap_or(false);
    let apply_any_fade = apply_video_fade || apply_audio_fade;
    let use_mov_alpha = batching::transparent_export_uses_mov(
        export_without_background.unwrap_or(false),
        transparent_export_format.as_deref(),
    );
    let total_duration_s: f64 = normalized_video_paths
        .iter()
        .map(|p| ffmpeg_utils::ffprobe_duration_sec(p))
        .sum();
    let fade_s = (export_fade_duration_ms.unwrap_or(0) as f64 / 1000.0)
        .max(0.0)
        .min(total_duration_s.max(0.0));

    if normalized_video_paths.is_empty() {
        return Err("Aucune vidéo fournie pour la concaténation".to_string());
    }

    // Cas trivial : une seule vidéo sans fades → copie simple
    if normalized_video_paths.len() == 1 && !apply_any_fade {
        println!("[concat_videos] Une seule vidéo, copie vers le fichier final");
        std::fs::copy(&normalized_video_paths[0], &output_path_str)
            .map_err(|e| format!("Erreur lors de la copie: {}", e))?;
        if promotion_enabled {
            concat::apply_promotion_to_video(
                &export_id,
                &output_path_str,
                promotion_position,
                promotion_width,
                promotion_height,
                promotion_fps,
                export_without_background.unwrap_or(false),
                transparent_export_format.as_deref(),
                video_codec,
                performance_profile,
                &app,
            )
            .map_err(|error| format!("Erreur ajout de la promotion Quran Caption: {}", error))?;
        }
        return Ok(output_path_str);
    }

    // Créer le dossier de sortie
    if let Some(parent) = output_path_buf.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Erreur création dossier de sortie: {}", e))?;
    }

    // Vérification de l'existence des fichiers
    for video_path in &normalized_video_paths {
        if !Path::new(video_path).exists() {
            return Err(format!("Fichier vidéo non trouvé: {}", video_path));
        }
    }

    // Vérification de la présence d'audio dans chaque segment
    let audio_presence: Vec<bool> = normalized_video_paths
        .iter()
        .map(|p| ffmpeg_utils::video_has_audio(p))
        .collect();
    let all_have_audio = !audio_presence.is_empty() && audio_presence.iter().all(|&has| has);
    let any_have_audio = audio_presence.iter().any(|&has| has);
    if any_have_audio && !all_have_audio {
        println!(
            "[concat_videos][warn] Certains segments n'ont pas d'audio; l'audio final sera désactivé"
        );
    }

    // Voie rapide : stream copy sans ré-encodage
    if !apply_any_fade
        && !export_without_background.unwrap_or(false)
        && (!any_have_audio || all_have_audio)
    {
        concat::concat_videos_with_stream_copy(
            &export_id,
            &normalized_video_paths,
            &output_path_str,
            total_duration_s,
            &app,
        )
        .map_err(|e| format!("Erreur concaténation stream-copy FFmpeg: {}", e))?;
        if promotion_enabled {
            concat::apply_promotion_to_video(
                &export_id,
                &output_path_str,
                promotion_position,
                promotion_width,
                promotion_height,
                promotion_fps,
                export_without_background.unwrap_or(false),
                transparent_export_format.as_deref(),
                video_codec,
                performance_profile,
                &app,
            )
            .map_err(|error| format!("Erreur ajout de la promotion Quran Caption: {}", error))?;
        }
        return Ok(output_path_str);
    }

    // Voie complète : ré-encodage avec filtre complexe
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
    ];

    for video_path in &normalized_video_paths {
        cmd.extend_from_slice(&["-i".to_string(), video_path.clone()]);
    }

    if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }

    // Construction du filtre complexe
    let mut filter_lines: Vec<String> = Vec::new();
    let mut video_inputs = String::new();
    for idx in 0..normalized_video_paths.len() {
        filter_lines.push(format!("[{}:v]setpts=PTS-STARTPTS[v{}]", idx, idx));
        video_inputs.push_str(&format!("[v{}]", idx));
    }
    filter_lines.push(format!(
        "{}concat=n={}:v=1:a=0[vcat]",
        video_inputs,
        normalized_video_paths.len()
    ));

    // Fades vidéo
    let mut current_video_label = "vcat".to_string();
    if apply_video_fade && fade_s > 0.0 {
        if video_fade_in_enabled.unwrap_or(false) {
            let fade_expr = if export_without_background.unwrap_or(false) {
                format!("fade=t=in:st=0:d={:.6}:alpha=1", fade_s)
            } else {
                format!("fade=t=in:st=0:d={:.6}", fade_s)
            };
            filter_lines.push(format!("[{}]{}[vfadein]", current_video_label, fade_expr));
            current_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled.unwrap_or(false) {
            let fade_out_start = (total_duration_s - fade_s).max(0.0);
            let fade_expr = if export_without_background.unwrap_or(false) {
                format!(
                    "fade=t=out:st={:.6}:d={:.6}:alpha=1",
                    fade_out_start, fade_s
                )
            } else {
                format!("fade=t=out:st={:.6}:d={:.6}", fade_out_start, fade_s)
            };
            filter_lines.push(format!("[{}]{}[vfadeout]", current_video_label, fade_expr));
            current_video_label = "vfadeout".to_string();
        }
    }

    // Audio
    let mut current_audio_label: Option<String> = None;
    if all_have_audio {
        let mut audio_inputs = String::new();
        for idx in 0..normalized_video_paths.len() {
            filter_lines.push(format!(
                "[{}:a]aresample=48000,asetpts=PTS-STARTPTS[a{}]",
                idx, idx
            ));
            audio_inputs.push_str(&format!("[a{}]", idx));
        }
        filter_lines.push(format!(
            "{}concat=n={}:v=0:a=1[acat]",
            audio_inputs,
            normalized_video_paths.len()
        ));

        let mut audio_label = "acat".to_string();
        if apply_audio_fade && fade_s > 0.0 {
            if audio_fade_in_enabled.unwrap_or(false) {
                filter_lines.push(format!(
                    "[{}]afade=t=in:st=0:d={:.6}[afadein]",
                    audio_label, fade_s
                ));
                audio_label = "afadein".to_string();
            }
            if audio_fade_out_enabled.unwrap_or(false) {
                let fade_out_start = (total_duration_s - fade_s).max(0.0);
                filter_lines.push(format!(
                    "[{}]afade=t=out:st={:.6}:d={:.6}[afadeout]",
                    audio_label, fade_out_start, fade_s
                ));
                audio_label = "afadeout".to_string();
            }
        }
        current_audio_label = Some(audio_label);
    }

    cmd.extend_from_slice(&[
        "-filter_complex".to_string(),
        filter_lines.join(";"),
        "-map".to_string(),
        format!("[{}]", current_video_label),
    ]);

    // Codec vidéo selon le type d'export
    if export_without_background.unwrap_or(false) && use_mov_alpha {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "qtrle".to_string(),
            "-pix_fmt".to_string(),
            "argb".to_string(),
        ]);
    } else if export_without_background.unwrap_or(false) {
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
        if video_codec == ExportVideoCodec::H265 {
            let (vcodec, vparams, vextra) =
                codec::choose_h265_codec(true, 0, 0, performance_profile);
            cmd.extend_from_slice(&["-c:v".to_string(), vcodec]);
            if let Some(Some(preset)) = vextra.get("preset") {
                cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
            }
            cmd.extend(vparams);
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
    }

    // Codec audio
    if let Some(audio_label) = current_audio_label {
        if export_without_background.unwrap_or(false) && use_mov_alpha {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        } else if export_without_background.unwrap_or(false) {
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

    if !export_without_background.unwrap_or(false) {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }
    cmd.push(output_path_str.clone());

    println!("[concat_videos] Exécution de FFmpeg...");

    let progress_context = FfmpegProgressContext {
        base_time_s: 0.0,
        total_time_s: total_duration_s.max(0.001),
        local_duration_s: total_duration_s.max(0.001),
        suppress_error_event: false,
        current_batch_size: None,
    };

    ffmpeg_runner::run_ffmpeg_command(
        &export_id,
        &cmd,
        Some(progress_context),
        Some("Merging Files"),
        None,
        &app,
    )
    .map_err(|e| format!("Erreur exécution FFmpeg: {}", e))?;

    if promotion_enabled {
        concat::apply_promotion_to_video(
            &export_id,
            &output_path_str,
            promotion_position,
            promotion_width,
            promotion_height,
            promotion_fps,
            export_without_background.unwrap_or(false),
            transparent_export_format.as_deref(),
            video_codec,
            performance_profile,
            &app,
        )
        .map_err(|error| format!("Erreur ajout de la promotion Quran Caption: {}", error))?;
    }

    if !Path::new(&output_path_str).exists() {
        return Err("Le fichier de sortie n'a pas été créé".to_string());
    }

    println!(
        "[concat_videos] ✅ Concaténation réussie: {}",
        output_path_str
    );
    Ok(output_path_str)
}
