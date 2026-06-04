use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::batching;
use super::codec;
use super::concat;
use super::constants;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::preprocess;
use super::types::{
    CodecUsage, ExportPerformanceProfile, FfmpegProgressContext, FiltergraphBatchMode,
    MemoryMonitorConfig, MemoryMonitorState, VideoInput,
};

// ---------------------------------------------------------------------------
// Construction et exécution du filtre complexe FFmpeg (avec batching)
// ---------------------------------------------------------------------------

/// Point d'entrée principal pour le rendu vidéo avec filtre complexe FFmpeg.
///
/// Gère le découpage en batchs (pour limiter la RAM) puis assemble les batchs
/// en une vidéo finale avec `concat_internal_batch_videos`.
///
/// # Paramètres
/// * `image_paths` - Chemins des images PNG (triés par timestamp).
/// * `timestamps_ms` - Timestamps correspondants en ms.
/// * `blank_timestamps` - Timestamps marqués "blank" (pas de sous-titres).
/// * `target_size` - Dimensions cibles de la vidéo (w, h).
/// * `fade_duration_ms` - Durée du fade entre chaque image.
/// * `start_time_ms` - Début de la plage d'export.
/// * `duration_ms` - Durée totale de l'export (None = toute la timeline).
#[allow(clippy::too_many_arguments)]
pub fn build_and_run_ffmpeg_filter_complex(
    export_id: &str,
    out_path: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
    blank_timestamps: &HashSet<i32>,
    target_size: (i32, i32),
    fps: i32,
    fade_duration_ms: i32,
    start_time_ms: i32,
    audio_paths: &[String],
    video_inputs: &[VideoInput],
    prefer_hw: bool,
    imgs_cwd: Option<&str>,
    duration_ms: Option<i32>,
    blur: Option<f64>,
    video_fade_in_enabled: bool,
    video_fade_out_enabled: bool,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    export_without_background: bool,
    transparent_export_format: Option<&str>,
    batch_size: Option<i32>,
    batch_mode: FiltergraphBatchMode,
    performance_profile: ExportPerformanceProfile,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let n = image_paths.len();
    if n == 0 {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Aucune image fournie",
        )));
    }
    if n != timestamps_ms.len() {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Le nombre d'images ne correspond pas au nombre de timestamps",
        )));
    }

    let tail_ms = fade_duration_ms.max(1000);
    let full_duration_ms = duration_ms.unwrap_or_else(|| timestamps_ms[n - 1] + tail_ms);
    let full_duration_s = (full_duration_ms as f64 / 1000.0).max(0.001);
    let fixed_batch_limit = batching::filtergraph_batch_limit(target_size, batch_size);
    let mut auto_batch_limit = batching::filtergraph_batch_limit(target_size, None);
    let batch_limit = if batch_mode == FiltergraphBatchMode::Fixed {
        fixed_batch_limit
    } else {
        auto_batch_limit
    };
    let (w, h) = target_size;

    // Prétraiter le fond une seule fois pour toute la plage exportée.
    // Les batchs réutilisent ensuite ce fond via un trim local.
    let preprocessed_background_videos = if !export_without_background && !video_inputs.is_empty() {
        preprocess::preprocess_background_videos(
            video_inputs,
            w,
            h,
            fps,
            prefer_hw,
            start_time_ms,
            Some(full_duration_ms),
            blur,
            performance_profile,
            export_id,
            full_duration_s,
            &app_handle,
        )
    } else {
        Vec::new()
    };

    // Cas simple : tout tient dans un seul batch en mode Fixed
    if batch_mode == FiltergraphBatchMode::Fixed && n <= batch_limit {
        return render_ffmpeg_filter_complex_single(
            export_id,
            out_path,
            image_paths,
            timestamps_ms,
            target_size,
            fps,
            fade_duration_ms,
            start_time_ms,
            audio_paths,
            &preprocessed_background_videos,
            0,
            prefer_hw,
            imgs_cwd,
            duration_ms.map(|d| d as f64 / 1000.0),
            video_fade_in_enabled,
            video_fade_out_enabled,
            audio_fade_in_enabled,
            audio_fade_out_enabled,
            export_fade_duration_ms,
            export_without_background,
            transparent_export_format,
            performance_profile,
            0.0,
            full_duration_s,
            None,
            app_handle,
        );
    }

    println!(
        "[batching] {} image(s), mode {:?}, limite initiale {}, rendu interne en batchs",
        n, batch_mode, batch_limit
    );
    println!(
        "[batching] {} timing(s) blank disponibles pour le rendu",
        blank_timestamps.len()
    );

    let base_dir = if let Some(cwd) = imgs_cwd {
        PathBuf::from(cwd)
    } else {
        Path::new(out_path)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(std::env::temp_dir)
    };
    fs::create_dir_all(&base_dir).ok();

    // Boucle de rendu par batchs
    let mut batch_paths: Vec<String> = Vec::new();
    let mut batch_durations_s: Vec<f64> = Vec::new();
    let mut batch_start_idx = 0usize;
    let mut batch_index = 0usize;
    let mut intended_batch_base_ms = 0i64;
    let mut encoded_batch_base_frames = 0i64;
    let mut batch_start_completed_fade_ms = 0i32;

    while batch_start_idx < n {
        ffmpeg_runner::ensure_export_not_cancelled(export_id)?;

        let effective_batch_limit = if batch_mode == FiltergraphBatchMode::Auto {
            auto_batch_limit = batching::adjust_auto_batch_limit_for_memory(auto_batch_limit);
            auto_batch_limit
        } else {
            batch_limit
        };
        let batch_end_idx =
            batching::choose_shared_batch_end_idx(n, batch_start_idx, effective_batch_limit);
        let is_last_batch = batch_end_idx >= n;
        let batch_start_adjusted_ts = timestamps_ms[batch_start_idx];
        let batch_slice = &timestamps_ms[batch_start_idx..batch_end_idx];
        let batch_start_is_blank = blank_timestamps.contains(&timestamps_ms[batch_start_idx]);
        let batch_end_is_blank = blank_timestamps.contains(&timestamps_ms[batch_end_idx - 1]);
        let boundary_fade_ms = if is_last_batch {
            0
        } else {
            batching::transition_fade_duration_ms(batch_slice, fade_duration_ms)
        };
        let batch_timestamps: Vec<i32> = batch_slice
            .iter()
            .enumerate()
            .map(|(idx, timestamp)| {
                let local_ts = timestamp - batch_start_adjusted_ts;
                if idx == 0 {
                    0
                } else {
                    (local_ts - batch_start_completed_fade_ms).max(1)
                }
            })
            .collect();
        let last_tail_ms = if is_last_batch {
            fade_duration_ms.max(1000)
        } else {
            1
        };
        let graph_duration_ms = batching::compute_render_output_duration_ms(
            &batch_timestamps,
            fade_duration_ms,
            last_tail_ms,
        )
        .saturating_add(boundary_fade_ms);
        let batch_source_start_ms = batching::capture_timeline_ms(
            timestamps_ms[batch_start_idx],
            batch_start_idx,
            fade_duration_ms,
        )
        .max(0);
        let intended_batch_end_ms = if is_last_batch {
            full_duration_ms as i64
        } else {
            batching::capture_timeline_ms(
                timestamps_ms[batch_end_idx - 1],
                batch_end_idx - 1,
                fade_duration_ms,
            )
            .max(batch_source_start_ms + 1)
            .min(full_duration_ms as i64)
        };
        let target_end_frames = batching::cumulative_frames_for_time_ms(intended_batch_end_ms, fps)
            .max(encoded_batch_base_frames + 1);
        let batch_duration_frames = target_end_frames - encoded_batch_base_frames;
        let batch_duration_s = batching::frames_to_seconds(batch_duration_frames, fps);
        let batch_base_s = encoded_batch_base_frames as f64 / fps.max(1) as f64;
        let batch_output_path = batching::make_internal_batch_path(
            &base_dir,
            export_id,
            batch_index,
            export_without_background,
            batching::transparent_export_uses_mov(
                export_without_background,
                transparent_export_format,
            ),
        );
        let batch_output = batch_output_path.to_string_lossy().to_string();

        println!(
            "[batching] batch {}: images {}..{} adjusted_start={}ms source_start={}ms intended_start={}ms encoded_start={:.6}s start_blank={} end_blank={} start_fade={}ms end_fade={}ms tail={}ms graph_duration={}ms intended_end={}ms encoded_duration={:.6}s output={}",
            batch_index,
            batch_start_idx,
            batch_end_idx - 1,
            batch_start_adjusted_ts,
            batch_source_start_ms,
            intended_batch_base_ms,
            batch_base_s,
            batch_start_is_blank,
            batch_end_is_blank,
            batch_start_completed_fade_ms,
            boundary_fade_ms,
            last_tail_ms,
            graph_duration_ms,
            intended_batch_end_ms,
            batch_duration_s,
            batch_output
        );

        // Configuration du moniteur mémoire pour le mode Auto
        let memory_state = Arc::new(Mutex::new(MemoryMonitorState {
            exceeded: false,
            peak_percent: 0.0,
        }));
        let memory_monitor = if batch_mode == FiltergraphBatchMode::Auto {
            Some(MemoryMonitorConfig {
                max_used_percent: constants::AUTO_MEMORY_LIMIT_PERCENT,
                kill_on_limit: effective_batch_limit > constants::FILTERGRAPH_BATCH_MIN,
                state: Some(memory_state.clone()),
            })
        } else {
            None
        };

        let render_result = render_ffmpeg_filter_complex_single(
            export_id,
            &batch_output,
            &image_paths[batch_start_idx..batch_end_idx],
            &batch_timestamps,
            target_size,
            fps,
            fade_duration_ms,
            start_time_ms + (batch_base_s * 1000.0).round() as i32,
            &[],
            &preprocessed_background_videos,
            (batch_base_s * 1000.0).round() as i32,
            prefer_hw,
            imgs_cwd,
            Some(batch_duration_s),
            false,
            false,
            false,
            false,
            0,
            export_without_background,
            transparent_export_format,
            performance_profile,
            batch_base_s,
            full_duration_s,
            memory_monitor,
            app_handle.clone(),
        );

        // Gestion des erreurs : retry avec batch plus petit en mode Auto
        if let Err(error) = render_result {
            let memory_error = error
                .downcast_ref::<super::types::MemoryLimitExceededError>()
                .map(|e| e.to_string());
            if batch_mode == FiltergraphBatchMode::Auto {
                if let Some(message) = memory_error {
                    fs::remove_file(&batch_output).ok();
                    if effective_batch_limit <= constants::FILTERGRAPH_BATCH_MIN {
                        return Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            format!(
                                "{} Minimum auto batch size ({}) still exceeds the RAM limit.",
                                message,
                                constants::FILTERGRAPH_BATCH_MIN
                            ),
                        )));
                    }

                    auto_batch_limit =
                        (effective_batch_limit / 2).max(constants::FILTERGRAPH_BATCH_MIN);
                    println!(
                        "[memory][auto-batch] retry batch {} with limit {} after RAM limit",
                        batch_index, auto_batch_limit
                    );
                    continue;
                }
            }

            return Err(error);
        }

        // Ajustement de la taille du batch suivant en mode Auto
        if batch_mode == FiltergraphBatchMode::Auto {
            let peak_percent = memory_state
                .lock()
                .map(|state| state.peak_percent)
                .unwrap_or(0.0);
            let next_limit =
                batching::next_auto_batch_limit_after_success(effective_batch_limit, peak_percent);
            if next_limit != effective_batch_limit {
                println!(
                    "[memory][auto-batch] batch {} peak {:.1}%, next limit {} -> {}",
                    batch_index, peak_percent, effective_batch_limit, next_limit
                );
            } else {
                println!(
                    "[memory][auto-batch] batch {} peak {:.1}%, keeping limit {}",
                    batch_index, peak_percent, effective_batch_limit
                );
            }
            auto_batch_limit = next_limit;
        }

        batch_paths.push(batch_output);
        batch_durations_s.push(batch_duration_s);

        if is_last_batch {
            break;
        }

        intended_batch_base_ms = intended_batch_end_ms;
        encoded_batch_base_frames = target_end_frames;
        batch_start_completed_fade_ms = boundary_fade_ms;
        batch_start_idx = batch_end_idx - 1;
        batch_index += 1;
    }

    // Assemblage final de tous les batchs
    concat::concat_internal_batch_videos(
        export_id,
        &batch_paths,
        &batch_durations_s,
        out_path,
        full_duration_s,
        start_time_ms,
        audio_paths,
        video_fade_in_enabled,
        video_fade_out_enabled,
        audio_fade_in_enabled,
        audio_fade_out_enabled,
        export_fade_duration_ms,
        export_without_background,
        transparent_export_format,
        performance_profile,
        app_handle,
    )?;

    println!(
        "[batching] Keeping {} internal batch file(s) for debugging",
        batch_paths.len()
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Rendu d'un seul batch avec filtre complexe FFmpeg
// ---------------------------------------------------------------------------

/// Rend un batch d'images en utilisant le filtre complexe FFmpeg.
///
/// Construit un graphe de filtres avec :
/// - Une entree PNG loopee par segment pour eviter le `split` d'un flux complet
/// - xfade pour les transitions entre images
/// - Overlay des sous-titres sur le fond vidéo (avec prémultiplication alpha)
/// - Fades vidéo/audio optionnels
///
/// Le filtre complexe est écrit dans un fichier temporaire `.ffgraph` pour
/// éviter les limites de longueur de ligne de commande.
#[allow(clippy::too_many_arguments)]
pub fn render_ffmpeg_filter_complex_single(
    export_id: &str,
    out_path: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
    target_size: (i32, i32),
    fps: i32,
    fade_duration_ms: i32,
    start_time_ms: i32,
    audio_paths: &[String],
    preprocessed_background_videos: &[String],
    background_offset_ms: i32,
    prefer_hw: bool,
    imgs_cwd: Option<&str>,
    duration_s_override: Option<f64>,
    video_fade_in_enabled: bool,
    video_fade_out_enabled: bool,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    export_without_background: bool,
    transparent_export_format: Option<&str>,
    performance_profile: ExportPerformanceProfile,
    progress_base_s: f64,
    progress_total_s: f64,
    memory_monitor: Option<MemoryMonitorConfig>,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    // Constante de test : force l'échec FFmpeg pour tester la gestion d'erreur UI.
    const FORCE_EXPORT_CRASH_FOR_TEST: bool = false;

    let (w, h) = target_size;
    let fade_s = (fade_duration_ms as f64 / 1000.0).max(0.0);
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);
    let use_mov_alpha =
        batching::transparent_export_uses_mov(export_without_background, transparent_export_format);

    let n = image_paths.len();
    if n == 0 {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Aucune image fournie",
        )));
    }
    if n != timestamps_ms.len() {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Le nombre d'images ne correspond pas au nombre de timestamps",
        )));
    }

    // Calcul des durées de chaque segment
    let tail_ms = fade_duration_ms.max(1000);
    let mut durations_s = Vec::new();

    for i in 0..n {
        if i < n - 1 {
            durations_s
                .push(((timestamps_ms[i + 1] - timestamps_ms[i]) as f64 / 1000.0).max(0.001));
        } else {
            durations_s.push((tail_ms as f64 / 1000.0).max(0.001));
        }
    }

    let total_by_ts = (timestamps_ms[n - 1] + tail_ms) as f64 / 1000.0;
    let duration_s = if let Some(dur) = duration_s_override {
        dur.max(0.001)
    } else {
        total_by_ts
    };
    let forced_video_frame_count = if duration_s_override.is_some() && audio_paths.is_empty() {
        Some(((duration_s * fps.max(1) as f64).round() as i64).max(1))
    } else {
        None
    };
    let export_fade_s = (export_fade_duration_ms as f64 / 1000.0)
        .max(0.0)
        .min(duration_s.max(0.0));

    // Choix du codec vidéo selon le type d'export
    let (vcodec, vparams, vextra) = if export_without_background && use_mov_alpha {
        (
            "qtrle".to_string(),
            vec!["-pix_fmt".to_string(), "argb".to_string()],
            HashMap::new(),
        )
    } else if export_without_background {
        (
            "libvpx-vp9".to_string(),
            vec![
                "-pix_fmt".to_string(),
                "yuva420p".to_string(),
                "-b:v".to_string(),
                "0".to_string(),
                "-crf".to_string(),
                "28".to_string(),
                "-row-mt".to_string(),
                "1".to_string(),
                "-cpu-used".to_string(),
                "2".to_string(),
            ],
            HashMap::new(),
        )
    } else {
        codec::choose_best_codec(prefer_hw, w, h, CodecUsage::Final)
    };

    // Durée totale du fond disponible
    let mut total_bg_s = 0.0;
    for p in preprocessed_background_videos {
        total_bg_s += ffmpeg_utils::ffprobe_duration_sec(p);
    }
    let background_offset_s = (background_offset_ms as f64 / 1000.0).max(0.0);
    let avail_bg_after = (total_bg_s - background_offset_s).max(0.0);

    // Durée audio totale
    let mut total_audio_s = 0.0;
    for p in audio_paths {
        total_audio_s += ffmpeg_utils::ffprobe_duration_sec(p);
    }
    let have_audio = !audio_paths.is_empty() && start_s < total_audio_s - 1e-6;

    // Construction de la commande FFmpeg
    let mut cmd = Vec::new();
    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    cmd.extend_from_slice(&[
        ffmpeg_exe.clone(),
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
    ]);

    // Une entree par PNG evite de dupliquer un flux deja converti en frames brutes.
    for (i, image_path) in image_paths.iter().enumerate() {
        cmd.extend_from_slice(&[
            "-loop".to_string(),
            "1".to_string(),
            "-framerate".to_string(),
            fps.max(1).to_string(),
            "-t".to_string(),
            format!("{:.6}", durations_s[i]),
            "-i".to_string(),
            image_path.clone(),
        ]);
    }
    println!("[ffmpeg] {} entree(s) PNG loopee(s) pour le batch", n);

    if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }
    let mut current_idx = n;

    // Entrées vidéo de fond
    let bg_start_idx = current_idx;
    for p in preprocessed_background_videos {
        cmd.extend_from_slice(&["-i".to_string(), p.clone()]);
        current_idx += 1;
    }

    // Entrées audio
    let audio_start_idx = current_idx;
    if have_audio {
        for p in audio_paths {
            cmd.extend_from_slice(&["-i".to_string(), p.clone()]);
            current_idx += 1;
        }
    }

    let mut filter_lines = Vec::new();

    // ---- Flux video principal : une branche courte par image ----
    for i in 0..n {
        filter_lines.push(format!(
            "[{}:v]format=rgba,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps={},trim=start=0:end={:.6},setpts=PTS-STARTPTS,setsar=1,format=rgba,premultiply=inplace=1[s{}p]",
            i, w, h, w, h, fps, durations_s[i], i
        ));
    }

    // ---- Chaîne xfade pour les transitions entre segments ----
    let mut curr_p = "s0p".to_string();
    let mut curr_duration = durations_s[0];

    for i in 0..(n - 1) {
        let fade_i = durations_s[i].min(fade_s);
        if fade_i <= 1e-6 {
            // Pas de fade : simple concaténation
            let out_p = format!("pc{}", i);
            filter_lines.push(format!(
                "[{}][s{}p]concat=n=2:v=1:a=0[{}]",
                curr_p,
                i + 1,
                out_p
            ));
            curr_p = out_p;
            curr_duration += durations_s[i + 1];
        } else {
            // Fade : transition xfade
            let out_p = format!("xp{}", i);
            let offset = (curr_duration - fade_i).max(0.0);
            filter_lines.push(format!(
                "[{}][s{}p]xfade=transition=fade:duration={:.6}:offset={:.6}[{}]",
                curr_p,
                i + 1,
                fade_i,
                offset,
                out_p
            ));
            curr_p = out_p;
            curr_duration = curr_duration + durations_s[i + 1] - fade_i;
        }
    }

    // Format de sortie de l'overlay (prémultiplié)
    filter_lines.push(format!("[{}]format=yuva444p[overlay]", curr_p));

    // ---- Gestion du fond ----
    if export_without_background {
        // Sortie alpha : revenir en straight alpha pour éviter l'assombrissement au fade
        filter_lines.push(if use_mov_alpha {
            "[overlay]unpremultiply=inplace=1,format=argb[vout]".to_string()
        } else {
            "[overlay]unpremultiply=inplace=1,format=yuva420p[vout]".to_string()
        });
    } else {
        // Construction de la vidéo de fond [bg]
        let need_black_full = preprocessed_background_videos.is_empty() || avail_bg_after <= 1e-6;

        let bg_label = if need_black_full {
            // Fond noir plein (aucune vidéo de fond disponible)
            let color_full_idx = current_idx;
            cmd.extend_from_slice(&[
                "-f".to_string(),
                "lavfi".to_string(),
                "-i".to_string(),
                format!("color=c=black:s={}x{}:r={}:d={:.6}", w, h, fps, duration_s),
            ]);
            format!("{}:v", color_full_idx)
        } else {
            // Concaténation des vidéos de fond prétraitées
            let prev = if preprocessed_background_videos.len() > 1 {
                let mut ins = String::new();
                for i in 0..preprocessed_background_videos.len() {
                    ins.push_str(&format!("[{}:v]", bg_start_idx + i));
                }
                filter_lines.push(format!(
                    "{}concat=n={}:v=1:a=0[bgcat]",
                    ins,
                    preprocessed_background_videos.len()
                ));
                "bgcat".to_string()
            } else {
                format!("{}:v", bg_start_idx)
            };

            // Trim du fond selon l'offset et la durée
            let bg_trim_start_s = background_offset_s;
            let bg_trim_end_s = (bg_trim_start_s + duration_s).min(total_bg_s);
            filter_lines.push(format!(
                "[{}]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[bgtrim]",
                prev, bg_trim_start_s, bg_trim_end_s, w, h, w, h
            ));
            let mut bg_label = "bgtrim".to_string();

            // Prolonger le fond si la durée est insuffisante (clone la dernière frame)
            if avail_bg_after + 1e-6 < duration_s {
                let remain = duration_s - avail_bg_after;
                filter_lines.push(format!(
                    "[bgtrim]tpad=stop_mode=clone:stop_duration={:.6}[bg]",
                    remain
                ));
                bg_label = "bg".to_string();
            }

            bg_label
        };

        // Superposition de l'overlay sur le fond
        filter_lines.push(format!("[{}]setsar=1[bg_normalized]", bg_label));
        filter_lines.push(
            "[bg_normalized][overlay]overlay=shortest=1:x=0:y=0:alpha=premultiplied,format=yuv420p[vout]"
                .to_string(),
        );
    }

    // ---- Fades vidéo ----
    let mut mapped_video_label = "vout".to_string();
    if video_fade_in_enabled && export_fade_s > 0.0 {
        let fade_expr = if export_without_background {
            format!("fade=t=in:st=0:d={:.6}:alpha=1", export_fade_s)
        } else {
            format!("fade=t=in:st=0:d={:.6}", export_fade_s)
        };
        filter_lines.push(format!("[{}]{}[vfadein]", mapped_video_label, fade_expr));
        mapped_video_label = "vfadein".to_string();
    }
    if video_fade_out_enabled && export_fade_s > 0.0 {
        let fade_out_start = (duration_s - export_fade_s).max(0.0);
        let fade_expr = if export_without_background {
            format!(
                "fade=t=out:st={:.6}:d={:.6}:alpha=1",
                fade_out_start, export_fade_s
            )
        } else {
            format!("fade=t=out:st={:.6}:d={:.6}", fade_out_start, export_fade_s)
        };
        filter_lines.push(format!("[{}]{}[vfadeout]", mapped_video_label, fade_expr));
        mapped_video_label = "vfadeout".to_string();
    }

    // ---- Audio : concaténation, trim, fades ----
    let mut mapped_audio_label: Option<String> = None;
    if have_audio {
        let a = audio_paths.len();
        if a == 1 {
            let a0 = format!("{}:a", audio_start_idx);
            filter_lines.push(format!("[{}]aresample=48000[aa0]", a0));
            filter_lines.push(format!(
                "[aa0]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, duration_s
            ));
        } else {
            for j in 0..a {
                let idx = audio_start_idx + j;
                filter_lines.push(format!("[{}:a]aresample=48000[aa{}]", idx, j));
            }
            let mut ins = String::new();
            for j in 0..a {
                ins.push_str(&format!("[aa{}]", j));
            }
            filter_lines.push(format!("{}concat=n={}:v=0:a=1[aacat]", ins, a));
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
        mapped_audio_label = Some(current_audio_label);
    }

    let filter_complex = filter_lines.join(";");

    // Écriture du filtre complexe dans un fichier .ffgraph (évite les limites shell)
    let tmp_dir = if let Some(cwd) = imgs_cwd {
        PathBuf::from(cwd)
    } else {
        std::env::temp_dir()
    };
    fs::create_dir_all(&tmp_dir).ok();

    let fg_hash = format!("{:x}", md5::compute(filter_complex.as_bytes()));
    let fg_path = tmp_dir.join(format!("filter-{}.ffgraph", &fg_hash[..8]));

    fs::write(&fg_path, &filter_complex)?;
    println!("[ffmpeg] filter_complex_script -> {:?}", fg_path);

    let fg_name = fg_path.to_string_lossy().to_string();

    cmd.extend_from_slice(&["-filter_complex_script".to_string(), fg_name]);

    // Mapping final
    cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", mapped_video_label)]);
    if have_audio {
        let audio_label = mapped_audio_label.unwrap_or_else(|| "aoutraw".to_string());
        cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", audio_label)]);
    }

    // ---- Codec vidéo ----
    cmd.extend_from_slice(&[
        "-r".to_string(),
        fps.to_string(),
        "-c:v".to_string(),
        vcodec,
    ]);
    if let Some(Some(preset)) = vextra.get("preset") {
        cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
    }
    cmd.extend(vparams);

    // ---- Codec audio ----
    if have_audio {
        if export_without_background && use_mov_alpha {
            cmd.extend_from_slice(&[
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        } else if export_without_background {
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

    // Nombre de frames forcé (pour les batchs internes)
    if let Some(frame_count) = forced_video_frame_count {
        cmd.extend_from_slice(&["-frames:v".to_string(), frame_count.to_string()]);
    }

    // Durée exacte
    cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", duration_s)]);

    // Faststart pour MP4/MOV
    let ext = Path::new(out_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }

    // Option de test : force un crash FFmpeg pour valider la gestion d'erreur
    if FORCE_EXPORT_CRASH_FOR_TEST {
        cmd.extend_from_slice(&[
            "-qurancaption_force_export_crash".to_string(),
            "1".to_string(),
        ]);
    }

    cmd.push(out_path.to_string());

    ffmpeg_runner::run_ffmpeg_command(
        export_id,
        &cmd,
        Some(FfmpegProgressContext {
            base_time_s: progress_base_s,
            total_time_s: progress_total_s,
            local_duration_s: duration_s,
        }),
        Some("Adding Subtitles"),
        memory_monitor,
        &app_handle,
    )
}
