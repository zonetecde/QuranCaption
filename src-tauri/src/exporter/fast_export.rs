use std::fs;
use std::path::Path;

use super::background_timeline::{build_background_transition_chain, build_timed_background_chain};
use super::batching;
use super::codec;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::overlay_plan::{
    build_overlay_concat_plan, create_temp_export_dir, export_error, is_no_space_left_error,
    OverlayFrameFormat,
};
use super::preprocess;
use super::types::{
    AudioInput, CodecUsage, ExportPerformanceProfile, ExportVideoCodec, FfmpegProgressContext,
    VideoClipTransitionMode, VideoInput,
};

type ExportError = Box<dyn std::error::Error + Send + Sync + 'static>;
type ExportResult<T> = Result<T, ExportError>;

/// Ajoute des keyframes regulieres pour rendre le seek MP4 rapide.
fn append_seek_friendly_gop_args(cmd: &mut Vec<String>, codec_name: &str, fps: i32) {
    let gop = fps.max(1).to_string();
    cmd.extend_from_slice(&["-g".to_string(), gop.clone()]);
    if codec_name == "libx264" {
        cmd.extend_from_slice(&[
            "-keyint_min".to_string(),
            gop,
            "-sc_threshold".to_string(),
            "0".to_string(),
        ]);
    } else if codec_name.contains("nvenc") {
        cmd.extend_from_slice(&["-forced-idr".to_string(), "1".to_string()]);
    }
}

/// Ajoute les options video rapides pour une sortie visible standard.
fn append_visible_h264_args(
    cmd: &mut Vec<String>,
    prefer_hw: bool,
    width: i32,
    height: i32,
    fps: i32,
    performance_profile: ExportPerformanceProfile,
) {
    let (vcodec, vparams, vextra) = codec::choose_best_codec(
        prefer_hw,
        width,
        height,
        CodecUsage::Final,
        performance_profile,
    );
    cmd.extend_from_slice(&["-c:v".to_string(), vcodec.clone()]);

    if vcodec == "h264_nvenc" {
        cmd.extend_from_slice(&[
            "-preset".to_string(),
            "p1".to_string(),
            "-tune".to_string(),
            "ll".to_string(),
            "-rc".to_string(),
            "constqp".to_string(),
            "-qp".to_string(),
            "18".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    } else {
        if let Some(Some(preset)) = vextra.get("preset") {
            cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
        }
        cmd.extend(vparams);
    }

    append_seek_friendly_gop_args(cmd, &vcodec, fps);
}

/// Ajoute les options vidéo visibles pour le codec final choisi.
fn append_visible_video_args(
    cmd: &mut Vec<String>,
    video_codec: ExportVideoCodec,
    prefer_hw: bool,
    width: i32,
    height: i32,
    fps: i32,
    performance_profile: ExportPerformanceProfile,
) {
    if video_codec == ExportVideoCodec::H265 {
        let (vcodec, vparams, vextra) =
            codec::choose_h265_codec(prefer_hw, width, height, performance_profile);
        cmd.extend_from_slice(&["-c:v".to_string(), vcodec.clone()]);
        if let Some(Some(preset)) = vextra.get("preset") {
            cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
        }
        cmd.extend(vparams);
        append_seek_friendly_gop_args(cmd, &vcodec, fps);
        return;
    }

    append_visible_h264_args(cmd, prefer_hw, width, height, fps, performance_profile);
}

/// Indique si l'audio simple peut etre copie sans reencodage dans la sortie.
fn can_stream_copy_simple_audio(audio_path: &str, out_path: &str) -> bool {
    let audio_ext = Path::new(audio_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let output_ext = Path::new(out_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    matches!(output_ext.as_str(), "mp4" | "m4v" | "mov")
        && matches!(audio_ext.as_str(), "mp3" | "aac" | "m4a")
}

/// Execute FFmpeg avec le contexte de progression principal.
fn run_final_export_command(
    export_id: &str,
    cmd: &[String],
    duration_s: f64,
    app_handle: &tauri::AppHandle,
) -> ExportResult<()> {
    ffmpeg_runner::run_ffmpeg_command(
        export_id,
        cmd,
        Some(FfmpegProgressContext {
            base_time_s: 0.0,
            total_time_s: duration_s.max(0.001),
            local_duration_s: duration_s.max(0.001),
            suppress_error_event: false,
            current_batch_size: None,
        }),
        Some("Adding Subtitles"),
        None,
        app_handle,
    )?;

    Ok(())
}

/// Execute l'export rapide complet avec overlay RGBA, fond, audio et codec final.
#[allow(clippy::too_many_arguments)]
pub(super) fn run_fast_export(
    export_id: &str,
    out_path: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
    target_size: (i32, i32),
    fps: i32,
    fade_duration_ms: i32,
    start_time_ms: i32,
    audio_paths: &[String],
    audio_clips: Option<&[AudioInput]>,
    audio_gain: f64,
    video_inputs: &[VideoInput],
    media_fill: bool,
    media_scale: f64,
    media_position_x: f64,
    media_position_y: f64,
    prefer_hw: bool,
    duration_ms: Option<i32>,
    blur: Option<f64>,
    video_fade_in_enabled: bool,
    video_fade_out_enabled: bool,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    export_without_background: bool,
    transparent_export_format: Option<&str>,
    video_codec: ExportVideoCodec,
    video_clip_transition_mode: VideoClipTransitionMode,
    video_clip_transition_duration_ms: i32,
    performance_profile: ExportPerformanceProfile,
    app_handle: tauri::AppHandle,
) -> ExportResult<()> {
    if image_paths.is_empty() {
        return Err(export_error("Aucune image fournie"));
    }
    if fps <= 0 {
        return Err(export_error("FPS invalide"));
    }

    let (w, h) = target_size;
    let tail_ms = fade_duration_ms.max(1000);
    let full_duration_ms = duration_ms
        .unwrap_or_else(|| timestamps_ms[timestamps_ms.len() - 1] + tail_ms)
        .max(1);
    let duration_s = full_duration_ms as f64 / 1000.0;
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);
    let export_fade_s = (export_fade_duration_ms.max(0) as f64 / 1000.0).min(duration_s.max(0.0));
    let video_clip_transition_s =
        (video_clip_transition_duration_ms.max(0) as f64 / 1000.0).min(duration_s.max(0.0));
    let has_video_clip_transition = video_clip_transition_mode != VideoClipTransitionMode::None
        && video_clip_transition_s > 1e-6;
    let use_mov_alpha =
        batching::transparent_export_uses_mov(export_without_background, transparent_export_format);

    // Filtrer les fichiers audio inexistants (projet ouvert sur une autre machine, etc.)
    let audio_paths: Vec<String> = audio_paths
        .iter()
        .filter(|p| {
            let exists = Path::new(p).exists();
            if !exists {
                println!("[fast_export] fichier audio introuvable, ignoré: {}", p);
            }
            exists
        })
        .cloned()
        .collect();
    let export_start_ms = start_time_ms as i64;
    let export_end_ms = export_start_ms.saturating_add(full_duration_ms as i64);
    let prepared_audio_clips: Vec<(String, f64, f64, f64, f64)> = audio_clips
        .unwrap_or_default()
        .iter()
        .filter_map(|clip| {
            let clip_start_ms = clip.timeline_start_ms;
            let clip_end_ms = clip_start_ms.saturating_add(clip.duration_ms.max(0));
            let intersection_start_ms = export_start_ms.max(clip_start_ms);
            let intersection_end_ms = export_end_ms.min(clip_end_ms);
            if intersection_end_ms <= intersection_start_ms {
                return None;
            }

            Some((
                clip.path.clone(),
                (clip.source_start_ms.max(0) + intersection_start_ms - clip_start_ms) as f64
                    / 1000.0,
                (intersection_start_ms - export_start_ms) as f64 / 1000.0,
                (intersection_end_ms - intersection_start_ms) as f64 / 1000.0,
                (clip.volume_percent.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0),
            ))
        })
        .collect();
    let has_timed_audio = audio_clips.is_some();
    let has_timed_background = video_inputs.iter().any(|input| {
        input.source_start_ms.is_some()
            && input.timeline_start_ms.is_some()
            && input.duration_ms.is_some()
    });

    let mut temp_dir = create_temp_export_dir(export_id)?;

    ffmpeg_runner::emit_export_progress(
        &app_handle,
        export_id,
        0.0,
        0.0,
        duration_s.max(0.001),
        Some("Initializing..."),
        None,
    );
    println!("[fast_export] Initialisation: generation du plan overlay TGA...");
    println!(
        "[fast_export] fade timeline effectif={}ms",
        fade_duration_ms.max(0)
    );
    let compose_black = !export_without_background
        && video_inputs.is_empty()
        && !video_fade_in_enabled
        && !video_fade_out_enabled;
    let overlay_plan = match build_overlay_concat_plan(
        export_id,
        image_paths,
        timestamps_ms,
        fps,
        fade_duration_ms,
        full_duration_ms,
        &temp_dir.path,
        compose_black,
        OverlayFrameFormat::Tga,
    ) {
        Ok(plan) => plan,
        Err(error) if is_no_space_left_error(error.as_ref()) => {
            println!(
                "[fast_export][warn] plan overlay TGA impossible par manque d'espace, retry PNG: {}",
                error
            );
            fs::remove_dir_all(&temp_dir.path).ok();
            temp_dir = create_temp_export_dir(export_id)?;
            build_overlay_concat_plan(
                export_id,
                image_paths,
                timestamps_ms,
                fps,
                fade_duration_ms,
                full_duration_ms,
                &temp_dir.path,
                compose_black,
                OverlayFrameFormat::Png,
            )?
        }
        Err(error) => return Err(error),
    };
    println!(
        "[fast_export] Frames source={} fades={} taille_source={}x{} opaque={} compose_noir={}",
        overlay_plan.source_frame_count,
        overlay_plan.generated_fade_frames,
        overlay_plan.width,
        overlay_plan.height,
        overlay_plan.all_frames_opaque,
        overlay_plan.composited_to_black
    );

    let preprocessed_background_videos = if !export_without_background && !video_inputs.is_empty() {
        preprocess::preprocess_background_videos(
            video_inputs,
            w,
            h,
            fps,
            prefer_hw,
            start_time_ms,
            Some(full_duration_ms),
            media_fill,
            media_scale,
            media_position_x,
            media_position_y,
            blur,
            performance_profile,
            export_id,
            duration_s,
            &app_handle,
        )
    } else {
        Vec::new()
    };
    ffmpeg_runner::ensure_export_not_cancelled(export_id)?;

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
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        overlay_plan.concat_path.to_string_lossy().to_string(),
    ];

    let mut current_idx = 1usize;
    let bg_start_idx = current_idx;
    for bg in &preprocessed_background_videos {
        // Pour la voie directe (non normalisé), ajouter un seek input
        if !bg.is_normalized {
            let seek_s = bg.source_start_s.unwrap_or(start_s).max(0.0);
            cmd.extend_from_slice(&["-ss".to_string(), format!("{:.6}", seek_s)]);
            println!("[background] input fast seek: {}s for {}", seek_s, bg.path);
        }
        cmd.extend_from_slice(&["-i".to_string(), bg.path.clone()]);
        current_idx += 1;
    }

    let total_bg_s: f64 = if has_timed_background {
        preprocessed_background_videos
            .iter()
            .map(|bg| bg.timeline_offset_s.unwrap_or(0.0) + bg.duration_s)
            .fold(0.0, f64::max)
    } else {
        preprocessed_background_videos
            .iter()
            .map(|bg| bg.duration_s)
            .sum()
    };
    let total_audio_s: f64 = audio_paths
        .iter()
        .map(|p| ffmpeg_utils::ffprobe_duration_sec(p))
        .sum();
    let have_audio = if has_timed_audio {
        !prepared_audio_clips.is_empty()
    } else {
        !audio_paths.is_empty() && start_s < total_audio_s - 1e-6
    };
    let direct_visible_export = !export_without_background
        && preprocessed_background_videos.is_empty()
        && (overlay_plan.all_frames_opaque || overlay_plan.composited_to_black)
        && overlay_plan.width == w
        && overlay_plan.height == h
        && !video_fade_in_enabled
        && !video_fade_out_enabled
        && !has_video_clip_transition
        && !has_timed_audio
        && !has_timed_background
        && (!have_audio
            || (audio_paths.len() == 1 && !audio_fade_in_enabled && !audio_fade_out_enabled));
    if direct_visible_export {
        println!(
            "[fast_export] chemin direct eligible: export_visible=true, fond_video=false, frames_opacifiees={}, audio_simple={}",
            overlay_plan.composited_to_black,
            !have_audio || audio_paths.len() == 1
        );
    } else {
        let mut reasons = Vec::new();
        if export_without_background {
            reasons.push("export_transparent=true".to_string());
        }
        if !preprocessed_background_videos.is_empty() {
            reasons.push(format!(
                "fond_video={} fichier(s)",
                preprocessed_background_videos.len()
            ));
        }
        if !overlay_plan.all_frames_opaque && !overlay_plan.composited_to_black {
            reasons.push("frames_non_opaques_et_non_composees".to_string());
        }
        if overlay_plan.width != w || overlay_plan.height != h {
            reasons.push(format!(
                "taille_overlay={}x{} taille_sortie={}x{}",
                overlay_plan.width, overlay_plan.height, w, h
            ));
        }
        if video_fade_in_enabled || video_fade_out_enabled {
            reasons.push("fade_video_global=true".to_string());
        }
        if has_video_clip_transition {
            reasons.push("transition_clips_video=true".to_string());
        }
        if has_timed_background {
            reasons.push("timeline_video=true".to_string());
        }
        if has_timed_audio {
            reasons.push("timeline_audio=true".to_string());
        }
        if have_audio && (audio_paths.len() != 1 || audio_fade_in_enabled || audio_fade_out_enabled)
        {
            reasons.push(format!(
                "audio_complexe=count:{} fade_in:{} fade_out:{}",
                audio_paths.len(),
                audio_fade_in_enabled,
                audio_fade_out_enabled
            ));
        }
        println!("[fast_export] chemin direct ignore: {}", reasons.join(", "));
    }

    let needs_black_background = !direct_visible_export
        && !export_without_background
        && (preprocessed_background_videos.is_empty() || total_bg_s <= 1e-6);
    let black_background_idx = if needs_black_background {
        let idx = current_idx;
        cmd.extend_from_slice(&[
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            format!("color=c=black:s={}x{}:r={}:d={:.6}", w, h, fps, duration_s),
        ]);
        current_idx += 1;
        Some(idx)
    } else {
        None
    };

    let audio_start_idx = current_idx;
    if have_audio {
        let input_paths: Vec<&str> = if has_timed_audio {
            prepared_audio_clips
                .iter()
                .map(|(path, _, _, _, _)| path.as_str())
                .collect()
        } else {
            audio_paths.iter().map(String::as_str).collect()
        };
        for path in input_paths {
            if direct_visible_export {
                cmd.extend_from_slice(&["-ss".to_string(), format!("{:.6}", start_s)]);
            }
            cmd.extend_from_slice(&["-i".to_string(), path.to_string()]);
        }
    }

    if !direct_visible_export {
        if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
            cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
        }
    }

    if direct_visible_export {
        let direct_duration_s = overlay_plan.duration_ticks as f64 / overlay_plan.timebase as f64;
        println!(
            "[fast_export] voie directe visible sans filtre overlay (duree_concat={:.3}s, duree_ui={:.3}s)",
            direct_duration_s, duration_s
        );
        cmd.extend_from_slice(&[
            "-filter_complex".to_string(),
            format!(
                "color=c=black:s={}x{}:r={}:d={:.6}[bg];[bg][0:v]overlay=eof_action=pass:repeatlast=0:shortest=0,trim=duration={:.6}[vout]",
                w, h, fps, duration_s, duration_s
            ),
            "-map".to_string(),
            "[vout]".to_string(),
            "-r".to_string(),
            fps.to_string(),
        ]);
        append_visible_video_args(
            &mut cmd,
            video_codec,
            prefer_hw,
            w,
            h,
            fps,
            performance_profile,
        );

        if have_audio {
            cmd.extend_from_slice(&["-map".to_string(), format!("{}:a", audio_start_idx)]);
            if (audio_gain - 1.0).abs() > 1e-6 {
                println!("[fast_export] audio direct: volume={:.3}", audio_gain);
                cmd.extend_from_slice(&[
                    "-af".to_string(),
                    format!("volume={:.6}", audio_gain),
                    "-c:a".to_string(),
                    "aac".to_string(),
                    "-b:a".to_string(),
                    "320k".to_string(),
                ]);
            } else if can_stream_copy_simple_audio(&audio_paths[0], out_path) {
                println!("[fast_export] audio direct: copie sans reencodage");
                cmd.extend_from_slice(&["-c:a".to_string(), "copy".to_string()]);
            } else {
                println!("[fast_export] audio direct: fallback reencodage aac");
                cmd.extend_from_slice(&[
                    "-c:a".to_string(),
                    "aac".to_string(),
                    "-b:a".to_string(),
                    "320k".to_string(),
                ]);
            }
        } else {
            cmd.push("-an".to_string());
        }

        cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", duration_s)]);
        let ext = Path::new(out_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
            cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
        }
        cmd.push(out_path.to_string());
        println!("[fast_export] commande directe complete: {}", cmd.join(" "));
        run_final_export_command(export_id, &cmd, duration_s, &app_handle)?;

        if !Path::new(out_path).exists() {
            return Err(export_error("Le fichier de sortie n'a pas ete cree"));
        }

        return Ok(());
    }

    let background_fit_filter = preprocess::build_background_fit_filter(
        w,
        h,
        media_fill,
        media_scale,
        media_position_x,
        media_position_y,
    );
    let mut filter_lines = Vec::new();
    filter_lines.push(format!(
        "[0:v]format=rgba,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps={},trim=start=0:end={:.6},setpts=PTS-STARTPTS,setsar=1[overlay_raw]",
        w, h, w, h, fps, duration_s
    ));

    let mut mapped_video_label;
    if export_without_background {
        mapped_video_label = "overlay_raw".to_string();
        if video_fade_in_enabled && export_fade_s > 0.0 {
            filter_lines.push(format!(
                "[{}]fade=t=in:st=0:d={:.6}:alpha=1[vfadein]",
                mapped_video_label, export_fade_s
            ));
            mapped_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled && export_fade_s > 0.0 {
            let fade_out_start = (duration_s - export_fade_s).max(0.0);
            filter_lines.push(format!(
                "[{}]fade=t=out:st={:.6}:d={:.6}:alpha=1[vfadeout]",
                mapped_video_label, fade_out_start, export_fade_s
            ));
            mapped_video_label = "vfadeout".to_string();
        }
        let alpha_format = if use_mov_alpha { "argb" } else { "yuva420p" };
        filter_lines.push(format!(
            "[{}]format={}[vout]",
            mapped_video_label, alpha_format
        ));
        mapped_video_label = "vout".to_string();
    } else {
        filter_lines
            .push("[overlay_raw]premultiply=inplace=1,format=yuva444p[overlay]".to_string());

        let bg_label = if has_timed_background && !preprocessed_background_videos.is_empty() {
            let mut labels = Vec::new();
            let mut durations = Vec::new();
            let mut timeline_offsets = Vec::new();
            for (i, bg) in preprocessed_background_videos.iter().enumerate() {
                let label = format!("bg{}", i);
                if bg.is_normalized {
                    filter_lines.push(format!(
                        "[{}:v]trim=start=0:end={:.6},setpts=PTS-STARTPTS[{}]",
                        bg_start_idx + i,
                        bg.duration_s,
                        label
                    ));
                } else {
                    filter_lines.push(format!(
                        "[{}:v]setpts=PTS-STARTPTS,{},fps={},setsar=1,trim=end={:.6}[{}]",
                        bg_start_idx + i,
                        background_fit_filter,
                        fps,
                        bg.duration_s,
                        label
                    ));
                }
                labels.push(label);
                durations.push(bg.duration_s);
                timeline_offsets.push(bg.timeline_offset_s.unwrap_or(0.0));
            }
            build_timed_background_chain(
                &mut filter_lines,
                &labels,
                &durations,
                &timeline_offsets,
                w,
                h,
                fps,
                duration_s,
                video_clip_transition_mode,
                video_clip_transition_s,
            )
        } else if let Some(idx) = black_background_idx {
            format!("{}:v", idx)
        } else if preprocessed_background_videos.len() > 1 {
            // Plusieurs backgrounds : tous sont normalisés par le pré-traitement
            let mut labels = Vec::new();
            let mut durations = Vec::new();
            for i in 0..preprocessed_background_videos.len() {
                let bg = &preprocessed_background_videos[i];
                let label = format!("bg{}", i);
                if bg.is_normalized {
                    filter_lines.push(format!(
                        "[{}:v]setpts=PTS-STARTPTS[bg{}]",
                        bg_start_idx + i,
                        i
                    ));
                    println!(
                        "[background] normalized=true redundant_scale_skipped=true idx={}",
                        i
                    );
                } else {
                    // Fallback: normaliser dans le graphe final
                    filter_lines.push(format!(
                        "[{}:v]setpts=PTS-STARTPTS,{},fps={},setsar=1[bg{}]",
                        bg_start_idx + i,
                        background_fit_filter,
                        fps,
                        i
                    ));
                    println!("[background] normalized=false idx={}", i);
                }
                labels.push(label);
                durations.push(bg.duration_s);
            }
            build_background_transition_chain(
                &mut filter_lines,
                &labels,
                &durations,
                video_clip_transition_mode,
                video_clip_transition_s,
            )
        } else {
            format!("{}:v", bg_start_idx)
        };

        if has_timed_background && !preprocessed_background_videos.is_empty() {
            filter_lines.push(format!(
                "[{}]trim=start=0:end={:.6},setpts=PTS-STARTPTS,setsar=1[bg_normalized]",
                bg_label, duration_s
            ));
        } else if black_background_idx.is_some() {
            filter_lines.push(format!("[{}]setsar=1[bg_normalized]", bg_label));
        } else {
            let bg_trim_end = duration_s.min(total_bg_s.max(0.001));
            let single_bg = preprocessed_background_videos.get(0);

            if let Some(bg) = single_bg {
                if bg.is_normalized {
                    // Background déjà à la bonne résolution, FPS et SAR
                    println!("[background] normalized=true redundant_scale_skipped=true");
                    filter_lines.push(format!(
                        "[{}]trim=start=0:end={:.6},setpts=PTS-STARTPTS[bgtrim]",
                        bg_label, bg_trim_end
                    ));
                } else {
                    // Background non normalisé (direct single pass ou fallback)
                    println!("[background] normalized=false (full filter chain)");
                    filter_lines.push(format!(
                        "[{}]setpts=PTS-STARTPTS,{},fps={},setsar=1,trim=end={:.6}[bgtrim]",
                        bg_label, background_fit_filter, fps, bg_trim_end
                    ));
                }
            } else {
                // Pas de background unique (ne devrait pas arriver)
                filter_lines.push(format!(
                    "[{}]trim=start=0:end={:.6},setpts=PTS-STARTPTS,{},setsar=1[bgtrim]",
                    bg_label, bg_trim_end, background_fit_filter
                ));
            }

            if total_bg_s + 1e-6 < duration_s {
                let tail_duration_s = duration_s - total_bg_s;
                filter_lines.push(format!(
                    "color=c=black:s={}x{}:r={}:d={:.6},setsar=1[bgtail]",
                    w, h, fps, tail_duration_s
                ));
                filter_lines.push("[bgtrim][bgtail]concat=n=2:v=1:a=0[bg_normalized]".to_string());
            } else {
                filter_lines.push("[bgtrim]setsar=1[bg_normalized]".to_string());
            }
        }

        filter_lines.push(
            "[bg_normalized][overlay]overlay=shortest=1:x=0:y=0:alpha=premultiplied,format=yuv420p[vcomposed]"
                .to_string(),
        );
        mapped_video_label = "vcomposed".to_string();
        if video_fade_in_enabled && export_fade_s > 0.0 {
            filter_lines.push(format!(
                "[{}]fade=t=in:st=0:d={:.6}[vfadein]",
                mapped_video_label, export_fade_s
            ));
            mapped_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled && export_fade_s > 0.0 {
            let fade_out_start = (duration_s - export_fade_s).max(0.0);
            filter_lines.push(format!(
                "[{}]fade=t=out:st={:.6}:d={:.6}[vfadeout]",
                mapped_video_label, fade_out_start, export_fade_s
            ));
            mapped_video_label = "vfadeout".to_string();
        }
    }

    let mut mapped_audio_label: Option<String> = None;
    if have_audio {
        if has_timed_audio {
            let mut inputs = "[asilence]".to_string();
            filter_lines.push(format!(
                "anullsrc=r=48000:cl=stereo,atrim=start=0:end={:.6}[asilence]",
                duration_s
            ));
            for (index, (_, source_start_s, timeline_offset_s, clip_duration_s, clip_gain)) in
                prepared_audio_clips.iter().enumerate()
            {
                let timeline_delay_ms = (timeline_offset_s * 1000.0).round().max(0.0) as i64;

                // amix recale les timestamps d'entrée : appliquer un délai réel préserve la position timeline.
                filter_lines.push(format!(
                    "[{}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,volume={:.6},adelay=delays={}:all=1[atrim{}]",
                    audio_start_idx + index,
                    source_start_s,
                    source_start_s + clip_duration_s,
                    clip_gain,
                    timeline_delay_ms,
                    index
                ));
                inputs.push_str(&format!("[atrim{}]", index));
            }
            filter_lines.push(format!(
                "{}amix=inputs={}:duration=longest:normalize=0:dropout_transition=0,atrim=start=0:end={:.6},asetpts=PTS-STARTPTS[aoutraw]",
                inputs,
                prepared_audio_clips.len() + 1,
                duration_s
            ));
        } else if audio_paths.len() == 1 {
            filter_lines.push(format!("[{}:a]aresample=48000[aa0]", audio_start_idx));
            filter_lines.push(format!(
                "[aa0]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, duration_s
            ));
        } else {
            let mut inputs = String::new();
            for i in 0..audio_paths.len() {
                filter_lines.push(format!(
                    "[{}:a]aresample=48000[aa{}]",
                    audio_start_idx + i,
                    i
                ));
                inputs.push_str(&format!("[aa{}]", i));
            }
            filter_lines.push(format!(
                "{}concat=n={}:v=0:a=1[aacat]",
                inputs,
                audio_paths.len()
            ));
            filter_lines.push(format!(
                "[aacat]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, duration_s
            ));
        }

        let mut current_audio_label = "aoutraw".to_string();
        if audio_fade_in_enabled && export_fade_s > 0.0 {
            filter_lines.push(format!(
                "[{}]afade=t=in:st=0:d={:.6}[afadein]",
                current_audio_label, export_fade_s
            ));
            current_audio_label = "afadein".to_string();
        }
        if audio_fade_out_enabled && export_fade_s > 0.0 {
            let fade_out_start = (duration_s - export_fade_s).max(0.0);
            filter_lines.push(format!(
                "[{}]afade=t=out:st={:.6}:d={:.6}[afadeout]",
                current_audio_label, fade_out_start, export_fade_s
            ));
            current_audio_label = "afadeout".to_string();
        }
        if (audio_gain - 1.0).abs() > 1e-6 {
            filter_lines.push(format!(
                "[{}]volume={:.6}[avolume]",
                current_audio_label, audio_gain
            ));
            current_audio_label = "avolume".to_string();
        }
        mapped_audio_label = Some(current_audio_label);
    }

    let filter_complex = filter_lines.join(";");
    let fg_path = temp_dir.path.join("fast-export.ffgraph");
    fs::write(&fg_path, filter_complex)?;
    println!("[fast_export] /filter_complex -> {:?}", fg_path);

    cmd.extend_from_slice(&[
        "-/filter_complex".to_string(),
        fg_path.to_string_lossy().to_string(),
        "-map".to_string(),
        format!("[{}]", mapped_video_label),
        "-r".to_string(),
        fps.to_string(),
    ]);

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
        let (vcodec, vparams, vextra) = if video_codec == ExportVideoCodec::H265 {
            codec::choose_h265_codec(prefer_hw, w, h, performance_profile)
        } else {
            codec::choose_best_codec(prefer_hw, w, h, CodecUsage::Final, performance_profile)
        };
        cmd.extend_from_slice(&["-c:v".to_string(), vcodec.clone()]);
        if let Some(Some(preset)) = vextra.get("preset") {
            cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
        }
        cmd.extend(vparams);
        append_seek_friendly_gop_args(&mut cmd, &vcodec, fps);
    }

    if let Some(audio_label) = mapped_audio_label {
        cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", audio_label)]);
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
    } else {
        cmd.push("-an".to_string());
    }

    cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", duration_s)]);
    let ext = Path::new(out_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }
    cmd.push(out_path.to_string());

    run_final_export_command(export_id, &cmd, duration_s, &app_handle)?;

    if !Path::new(out_path).exists() {
        return Err(export_error("Le fichier de sortie n'a pas ete cree"));
    }

    Ok(())
}
