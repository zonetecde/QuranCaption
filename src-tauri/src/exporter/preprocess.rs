use std::fs;
use std::path::Path;
use std::process::Command;

use super::codec;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::types::{CodecUsage, ExportPerformanceProfile, FfmpegProgressContext, VideoInput};

// ---------------------------------------------------------------------------
// Pré-traitement vidéo (scale + pad + blur + fps)
// ---------------------------------------------------------------------------

/// Prétraite une vidéo source : redimensionne (contain), applique un flou optionnel,
/// ajuste le fps et découpe la plage temporelle demandée.
///
/// # Paramètres
/// * `loop_video` - Si vrai, la vidéo source est bouclée indéfiniment.
/// * `start_ms` - Offset de début dans la source (seek rapide).
/// * `duration_ms` - Durée maximale à extraire.
pub fn ffmpeg_preprocess_video(
    src: &str,
    dst: &str,
    w: i32,
    h: i32,
    fps: i32,
    prefer_hw: bool,
    start_ms: Option<i32>,
    duration_ms: Option<i32>,
    blur: Option<f64>,
    loop_video: bool,
    performance_profile: ExportPerformanceProfile,
    export_id: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let (codec, params, extra) =
        codec::choose_best_codec(prefer_hw, w, h, CodecUsage::Intermediate);
    let exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let dst_path = Path::new(dst);
    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = ffmpeg_utils::build_temp_output_path(dst_path);
    let tmp_output = tmp_path.to_string_lossy().to_string();

    // Construction du filtre vidéo : scale → pad → blur optionnel → fps
    let mut vf_parts = vec![
        format!("scale=w={}:h={}:force_original_aspect_ratio=decrease", w, h),
        format!("pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black", w, h),
    ];

    // Ajouter le flou si spécifié et > 0
    if let Some(blur_value) = blur {
        if blur_value > 0.0 {
            vf_parts.push(format!("gblur=sigma={}", blur_value));
        }
    }

    vf_parts.push(format!("fps={}", fps));
    vf_parts.push("setsar=1".to_string());

    let vf = vf_parts.join(",");

    let mut cmd = vec![
        exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
    ];

    // Bouclage : répéter la source indéfiniment
    if loop_video {
        cmd.extend_from_slice(&["-stream_loop".to_string(), "-1".to_string()]);
    }

    // Seek rapide avant l'entrée (-ss avant -i)
    if let Some(sms) = start_ms {
        let s = format!("{:.3}", (sms as f64) / 1000.0);
        cmd.extend_from_slice(&["-ss".to_string(), s]);
    }

    cmd.extend_from_slice(&["-i".to_string(), src.to_string()]);

    // Durée maximale
    if let Some(dms) = duration_ms {
        let d = format!("{:.3}", (dms as f64) / 1000.0);
        cmd.extend_from_slice(&["-t".to_string(), d]);
    }

    // Limitation du nombre de threads
    if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }

    cmd.extend_from_slice(&[
        "-an".to_string(),
        "-vf".to_string(),
        vf,
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-c:v".to_string(),
        codec,
    ]);

    if let Some(Some(preset)) = extra.get("preset") {
        cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
    }

    cmd.extend(params);
    cmd.push(tmp_output);

    println!(
        "[preproc] ffmpeg scale+pad (contain) -> {}",
        Path::new(dst)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    );

    // Contexte de progression : toute la durée de cette étape
    let preproc_duration_s = duration_ms
        .map(|ms| ms as f64 / 1000.0)
        .unwrap_or(0.001)
        .max(0.001);
    let progress_context = Some(FfmpegProgressContext {
        base_time_s: 0.0,
        total_time_s: preproc_duration_s,
        local_duration_s: preproc_duration_s,
        suppress_error_event: false,
    });

    if let Err(e) = ffmpeg_runner::run_ffmpeg_command(
        export_id,
        &cmd,
        progress_context,
        Some("Processing Background"),
        None,
        app_handle,
    ) {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("FFmpeg preprocessing failed: {}", e),
        )));
    }

    // Validation du fichier produit
    let expected_duration_s = duration_ms
        .map(|ms| ms as f64 / 1000.0)
        .unwrap_or(0.001)
        .max(0.001);
    if !ffmpeg_utils::is_cached_video_valid(&tmp_path, expected_duration_s) {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "FFmpeg preprocessing produced an invalid output file",
        )));
    }

    ffmpeg_utils::replace_preproc_file(&tmp_path, dst_path)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Création de vidéo à partir d'une image fixe
// ---------------------------------------------------------------------------

/// Crée une vidéo à partir d'une image fixe, avec redimensionnement (cover/crop)
/// et flou optionnel.
pub fn create_video_from_image(
    image_path: &str,
    output_path: &str,
    w: i32,
    h: i32,
    fps: i32,
    duration_s: f64,
    prefer_hw: bool,
    blur: Option<f64>,
    performance_profile: ExportPerformanceProfile,
) -> Result<(), Box<dyn std::error::Error>> {
    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let dst_path = Path::new(output_path);
    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = ffmpeg_utils::build_temp_output_path(dst_path);
    let tmp_output = tmp_path.to_string_lossy().to_string();

    // Filtre : scale up → crop → blur optionnel
    let mut vf_parts = vec![
        format!("scale={}:{}:force_original_aspect_ratio=increase", w, h),
        format!("crop={}:{}:(in_w-{})/2:(in_h-{})/2", w, h, w, h),
    ];

    if let Some(blur_value) = blur {
        if blur_value > 0.0 {
            vf_parts.push(format!("gblur=sigma={}", blur_value));
        }
    }

    let video_filter = vf_parts.join(",");

    let (codec, codec_params, codec_extra) =
        codec::choose_best_codec(prefer_hw, w, h, CodecUsage::Intermediate);

    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-loop",
        "1",
        "-i",
        image_path,
        "-vf",
        &video_filter,
        "-c:v",
        &codec,
        "-r",
        &fps.to_string(),
        "-t",
        &format!("{:.6}", duration_s),
    ]);

    codec::append_thread_cap(&mut cmd, performance_profile);

    if let Some(Some(preset)) = codec_extra.get("preset") {
        cmd.arg("-preset").arg(preset);
    }

    for param in codec_params {
        cmd.arg(param);
    }

    if codec.contains("nvenc") {
        cmd.args(&["-cq", "23"]);
    }

    cmd.arg(&tmp_output);

    ffmpeg_utils::configure_command_no_window(&mut cmd);

    println!(
        "[preproc][IMG] Création vidéo depuis image: {} -> {}",
        image_path, output_path
    );
    println!("[preproc][IMG] Commande: {:?}", cmd);

    let status = cmd.status()?;
    if !status.success() {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "FFmpeg image-to-video failed",
        )));
    }

    if !ffmpeg_utils::is_cached_video_valid(&tmp_path, duration_s.max(0.001)) {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "FFmpeg image-to-video produced an invalid output file",
        )));
    }

    ffmpeg_utils::replace_preproc_file(&tmp_path, dst_path)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Pré-traitement des vidéos de fond (batch complet)
// ---------------------------------------------------------------------------

/// Prétraite toutes les vidéos de fond pour un export.
///
/// Parcourt les `video_inputs`, calcule les segments pertinents selon `start_time_ms`
/// et `duration_ms`, puis appelle `ffmpeg_preprocess_video` (ou `create_video_from_image`
/// pour une image seule). Les résultats sont mis en cache dans `%TEMP%/qurancaption-preproc`.
///
/// # Retourne
/// La liste des chemins vers les vidéos prétraitées, dans l'ordre.
pub fn preprocess_background_videos(
    video_inputs: &[VideoInput],
    w: i32,
    h: i32,
    fps: i32,
    prefer_hw: bool,
    start_time_ms: i32,
    duration_ms: Option<i32>,
    blur: Option<f64>,
    performance_profile: ExportPerformanceProfile,
    export_id: &str,
    total_duration_s: f64,
    app_handle: &tauri::AppHandle,
) -> Vec<String> {
    let mut out_paths = Vec::new();
    let cache_dir = std::env::temp_dir().join("qurancaption-preproc");
    let preproc_cache_version = "fit-v7";
    fs::create_dir_all(&cache_dir).ok();
    let total_inputs = video_inputs.len().max(1);
    let clamped_total_s = total_duration_s.max(0.001);

    // Closure d'émission de progression pour le pré-traitement du fond
    let emit_bg_progress = |processed_inputs: usize| {
        let progress = ((processed_inputs as f64 / total_inputs as f64) * 100.0).clamp(0.0, 100.0);
        let current_time_s = (progress / 100.0) * clamped_total_s;
        ffmpeg_runner::emit_export_progress(
            app_handle,
            export_id,
            progress,
            current_time_s,
            clamped_total_s,
            Some("Processing Background"),
        );
    };

    emit_bg_progress(0);

    // Cas spécial : une seule image → créer une vidéo à partir de l'image
    if video_inputs.len() == 1 && ffmpeg_utils::is_image_file(&video_inputs[0].path) {
        let image_path = &video_inputs[0].path;
        let duration_s = if let Some(dur_ms) = duration_ms {
            dur_ms as f64 / 1000.0
        } else {
            30.0 // Durée par défaut si non spécifiée
        };

        // Construction d'un nom de cache unique
        let blur_suffix = if let Some(b) = blur {
            if b > 0.0 {
                format!("-blur{}", b)
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        let hash_input = format!(
            "{}-{}-{}x{}-{}-dur{}{}",
            preproc_cache_version, image_path, w, h, fps, duration_s, blur_suffix
        );
        let stem_hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        let stem_hash = &stem_hash[..10.min(stem_hash.len())];
        let dst = cache_dir.join(format!("img-bg-{}-{}x{}-{}.mp4", stem_hash, w, h, fps));
        let expected_duration_s = duration_s.max(0.001);

        let must_regenerate = !ffmpeg_utils::is_cached_video_valid(&dst, expected_duration_s);
        if must_regenerate {
            if dst.exists() {
                println!(
                    "[preproc][cache] Fichier invalide détecté, régénération: {}",
                    dst.display()
                );
                fs::remove_file(&dst).ok();
            }
            match create_video_from_image(
                image_path,
                &dst.to_string_lossy(),
                w,
                h,
                fps,
                duration_s,
                prefer_hw,
                blur,
                performance_profile,
            ) {
                Ok(_) => {}
                Err(e) => {
                    println!(
                        "[preproc][ERREUR] Impossible de créer la vidéo à partir de l'image: {:?}",
                        e
                    );
                    return vec![];
                }
            }
        }

        out_paths.push(dst.to_string_lossy().to_string());
        emit_bg_progress(total_inputs);
        return out_paths;
    }

    // Sonder les durées de chaque vidéo source
    let mut video_durations_ms: Vec<i64> = Vec::new();
    for input in video_inputs {
        let d = (ffmpeg_utils::ffprobe_duration_sec(&input.path) * 1000.0).round() as i64;
        video_durations_ms.push(d);
    }

    let limit_ms: i64 = if let Some(dur) = duration_ms {
        dur as i64
    } else {
        i64::MAX
    };

    // Parcourir les vidéos et extraire uniquement les segments pertinents
    let mut cum_start: i64 = 0;
    for (idx, input) in video_inputs.iter().enumerate() {
        let vid_path = &input.path;
        let real_vid_len = video_durations_ms.get(idx).cloned().unwrap_or(0);
        let mut vid_len = real_vid_len;
        let is_loop = input.loop_until_audio_end.unwrap_or(false);

        // Si la vidéo boucle, elle peut couvrir tout le reste de la plage
        if is_loop {
            vid_len = limit_ms;
        }

        let cum_end = cum_start + vid_len;

        // La vidéo se termine avant le début recherché → on l'ignore
        if !is_loop && cum_end <= start_time_ms as i64 {
            cum_start = cum_end;
            emit_bg_progress(idx + 1);
            continue;
        }

        // On a déjà dépassé la limite demandée
        let elapsed_so_far = cum_start - (start_time_ms as i64);
        if elapsed_so_far >= limit_ms {
            emit_bg_progress(total_inputs);
            break;
        }

        // Déterminer l'offset à l'intérieur de cette vidéo
        let mut start_within = if start_time_ms as i64 > cum_start {
            start_time_ms as i64 - cum_start
        } else {
            0
        };

        // Pour un clip loopé, replier l'offset dans la durée réelle du média
        if is_loop && real_vid_len > 0 {
            start_within %= real_vid_len;
        }

        let elapsed_from_start = (cum_start + start_within) - (start_time_ms as i64);
        let remaining_needed = (limit_ms - elapsed_from_start).max(0);
        let available_in_this_clip = if is_loop {
            remaining_needed
        } else {
            (vid_len - start_within).max(0)
        };
        let take_ms = remaining_needed.min(available_in_this_clip);

        if take_ms <= 0 {
            cum_start = cum_end;
            emit_bg_progress(idx + 1);
            continue;
        }

        // Nom de cache unique (inclut offsets, blur, flag loop)
        let blur_suffix = if let Some(b) = blur {
            if b > 0.0 {
                format!("-blur{}", b)
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        let loop_suffix = if is_loop { "-loop" } else { "" };

        let hash_input = format!(
            "{}-{}-{}x{}-{}-start{}-len{}{}{}",
            preproc_cache_version,
            vid_path,
            w,
            h,
            fps,
            start_within,
            take_ms,
            blur_suffix,
            loop_suffix
        );
        let stem_hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        let stem_hash = &stem_hash[..10.min(stem_hash.len())];
        let dst = cache_dir.join(format!("bg-{}-{}x{}-{}.mp4", stem_hash, w, h, fps));
        let expected_duration_s = (take_ms as f64 / 1000.0).max(0.001);

        let must_regenerate = !ffmpeg_utils::is_cached_video_valid(&dst, expected_duration_s);
        if must_regenerate {
            if dst.exists() {
                println!(
                    "[preproc][cache] Fichier invalide détecté, régénération: {}",
                    dst.display()
                );
                fs::remove_file(&dst).ok();
            }
            match ffmpeg_preprocess_video(
                vid_path,
                &dst.to_string_lossy(),
                w,
                h,
                fps,
                prefer_hw,
                Some(start_within as i32),
                Some(take_ms as i32),
                blur,
                is_loop,
                performance_profile,
                export_id,
                app_handle,
            ) {
                Ok(_) => {}
                Err(e) => {
                    println!("[preproc][ERREUR] {:?}", e);
                    // En cas d'échec, utiliser la vidéo originale comme fallback
                    out_paths.push(vid_path.clone());
                    cum_start = cum_end;
                    emit_bg_progress(idx + 1);
                    continue;
                }
            }
        }

        out_paths.push(dst.to_string_lossy().to_string());
        emit_bg_progress(idx + 1);

        // Si on a atteint la limite, on arrête
        let elapsed_total = (cum_start + start_within + take_ms) - (start_time_ms as i64);
        if elapsed_total >= limit_ms {
            break;
        }

        cum_start = cum_end;
    }

    emit_bg_progress(total_inputs);
    out_paths
}
