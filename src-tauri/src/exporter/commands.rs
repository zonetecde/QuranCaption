use crate::path_utils;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use tauri::Emitter;

use super::batching;
use super::codec;
use super::concat;
use super::constants;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::filter_graph;
use super::types::{ExportPerformanceProfile, FfmpegProgressContext, VideoInput};

// ---------------------------------------------------------------------------
// Commande Tauri : export_video
// ---------------------------------------------------------------------------

/// Commande principale d'export vidéo.
///
/// Parcourt un dossier d'images PNG nommées par timestamp, construit la timeline,
/// et lance le rendu FFmpeg avec batching automatique.
///
/// # Paramètres (envoyés depuis le frontend)
/// * `export_id` - Identifiant unique pour suivre et annuler l'export.
/// * `imgs_folder` - Dossier contenant les PNG (ex: `0.png`, `1500.png`, ...).
/// * `final_file_path` - Chemin du fichier vidéo de sortie.
/// * `fps` - Images par seconde.
/// * `fade_duration` - Durée du fondu entre chaque sous-titre (ms).
/// * `start_time` - Début de la plage d'export (ms).
/// * `duration` - Durée de l'export (ms). `None` = toute la timeline.
/// * `audios` - Liste des fichiers audio à superposer.
/// * `videos` - Liste des vidéos de fond.
/// * `blur` - Intensité du flou de fond.
/// * `batch_size` / `batch_size_mode` - Configuration du batching.
/// * `blank_timings` - Timestamps sans sous-titres (fond uniquement).
#[tauri::command]
pub async fn export_video(
    export_id: String,
    imgs_folder: String,
    final_file_path: String,
    fps: i32,
    fade_duration: i32,
    start_time: i32,
    duration: Option<i32>,
    audios: Option<Vec<String>>,
    videos: Option<Vec<VideoInput>>,
    blur: Option<f64>,
    video_fade_in_enabled: Option<bool>,
    video_fade_out_enabled: Option<bool>,
    audio_fade_in_enabled: Option<bool>,
    audio_fade_out_enabled: Option<bool>,
    export_fade_duration_ms: Option<i32>,
    export_without_background: Option<bool>,
    transparent_export_format: Option<String>,
    batch_size: Option<i32>,
    batch_size_mode: Option<String>,
    blank_timings: Option<Vec<i32>>,
    performance_profile: ExportPerformanceProfile,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let t0 = Instant::now();
    ffmpeg_runner::clear_export_cancelled(&export_id);

    // ---- Logs de démarrage ----
    println!("[start_export] export_id={}", export_id);
    println!("[start_export] imgs_folder={}", imgs_folder);
    println!("[start_export] final_file_path={}", final_file_path);
    println!(
        "[start_export] fps={}, fade_duration(ms)={}",
        fps, fade_duration
    );
    println!(
        "[start_export] export_fade: video(in={}, out={}) audio(in={}, out={}) duration(ms)={}",
        video_fade_in_enabled.unwrap_or(false),
        video_fade_out_enabled.unwrap_or(false),
        audio_fade_in_enabled.unwrap_or(false),
        audio_fade_out_enabled.unwrap_or(false),
        export_fade_duration_ms.unwrap_or(0)
    );
    println!(
        "[start_export] export_without_background={}",
        export_without_background.unwrap_or(false)
    );
    println!(
        "[start_export] transparent_export_format={}",
        transparent_export_format
            .as_deref()
            .unwrap_or("mov_prores_4444")
    );
    println!(
        "[env] CPU cores: {:?}",
        std::thread::available_parallelism().map(|n| n.get())
    );
    println!("[perf] profile={:?}", performance_profile);
    println!(
        "[perf] thread_cap={:?}",
        codec::compute_ffmpeg_thread_cap(performance_profile)
    );
    println!(
        "[perf] batch_size={}",
        batching::normalize_filtergraph_batch_size(batch_size)
    );
    let batch_mode = batching::normalize_filtergraph_batch_mode(batch_size_mode.as_deref());
    println!("[perf] batch_size_mode={:?}", batch_mode);
    println!(
        "[batching] blank timings fournis={}",
        blank_timings.as_ref().map_or(0, Vec::len)
    );

    if let Some(ref audios) = audios {
        println!("[audio] {} fichier(s) audio fourni(s)", audios.len());
    } else {
        println!("[audio] aucun fichier audio fourni");
    }

    if let Some(ref videos) = videos {
        println!("[video] {} fichier(s) vidéo fourni(s)", videos.len());
    } else {
        println!("[video] aucune vidéo de fond fournie");
    }

    // ---- Scan des PNG ----
    let folder = path_utils::normalize_existing_path(&imgs_folder);
    println!(
        "[scan] Parcours du dossier: {:?}",
        folder.canonicalize().unwrap_or_else(|_| folder.clone())
    );

    let mut files: Vec<_> = fs::read_dir(&folder)
        .map_err(|e| format!("Erreur lecture dossier: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()?.to_lowercase() == "png" {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // Tri par timestamp (nom de fichier sans extension)
    files.sort_by_key(|p| {
        p.file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0)
    });
    let files: Vec<PathBuf> = files
        .into_iter()
        .map(|p| p.canonicalize().unwrap_or(p))
        .collect();

    println!("[scan] {} image(s) trouvée(s)", files.len());

    if files.is_empty() {
        return Err("Aucune image .png trouvée dans imgs_folder".to_string());
    }

    // Vérification : la première image doit être 0.png
    let first_stem = files[0]
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(-1);

    if first_stem != 0 {
        return Err("La première image doit être '0.png' (timestamp 0 ms).".to_string());
    }

    // ---- Construction de la timeline ----
    let ts: Vec<i32> = files
        .iter()
        .map(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0)
        })
        .collect();
    let blank_timestamps: HashSet<i32> = blank_timings
        .unwrap_or_default()
        .iter()
        .copied()
        .filter(|timing| ts.binary_search(timing).is_ok())
        .collect();

    let path_strs: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let ts_preview: Vec<i32> = ts.iter().take(10).cloned().collect();
    println!(
        "[timeline] Premiers timestamps: {:?}{}",
        ts_preview,
        if ts.len() > 10 { " ..." } else { "" }
    );
    println!("[timeline] Nombre d'images: {}", ts.len());

    // ---- Taille cible (dimensions de 0.png) ----
    println!("[image] Ouverture de la première image pour taille cible...");
    let target_size = {
        let img_data = fs::read(&files[0]).map_err(|e| format!("Erreur lecture image: {}", e))?;
        let img = image::load_from_memory(&img_data)
            .map_err(|e| format!("Erreur décodage image: {}", e))?;
        // Forcer des dimensions paires pour compatibilité YUV420P
        ((img.width() as i32 / 2) * 2, (img.height() as i32 / 2) * 2)
    };

    println!("[image] Taille cible: {}x{}", target_size.0, target_size.1);

    // ---- Durée totale ----
    let fade_ms = fade_duration;
    let tail_ms = fade_ms.max(1000);
    let total_duration_ms = ts[ts.len() - 1] + tail_ms;
    let duration_s = total_duration_ms as f64 / 1000.0;
    println!(
        "[timeline] Durée totale: {} ms ({:.3} s)",
        total_duration_ms, duration_s
    );
    println!(
        "[perf] Préparation terminée en {:.0} ms",
        t0.elapsed().as_millis()
    );

    // ---- Préparation du dossier de sortie ----
    let out_path = path_utils::normalize_output_path(&final_file_path);
    if let Some(parent) = out_path.parent() {
        println!("[fs] Création du dossier de sortie si besoin: {:?}", parent);
        fs::create_dir_all(parent).map_err(|e| format!("Erreur création dossier: {}", e))?;
    }

    let imgs_folder_resolved = folder
        .canonicalize()
        .unwrap_or_else(|_| folder.clone())
        .to_string_lossy()
        .to_string();

    let out_path_str = out_path.to_string_lossy().to_string();
    let out_path_str_for_task = out_path_str.clone();

    // ---- Normalisation des fichiers audio ----
    let mut audios_vec: Vec<String> = Vec::new();
    for raw_audio_path in audios.unwrap_or_default() {
        let normalized = path_utils::normalize_existing_path(&raw_audio_path);
        if normalized.as_os_str().is_empty() || !normalized.exists() {
            println!(
                "[audio][warn] Fichier audio introuvable, export sans ce fichier: {}",
                raw_audio_path
            );
            continue;
        }

        audios_vec.push(normalized.to_string_lossy().to_string());
    }
    if audios_vec.is_empty() {
        println!("[audio] Aucun fichier audio valide, export sans audio");
    } else {
        println!(
            "[audio] {} fichier(s) audio valide(s) après vérification",
            audios_vec.len()
        );
    }

    // ---- Normalisation des vidéos ----
    let mut videos_vec = videos.unwrap_or_default();
    for v in &mut videos_vec {
        v.path = path_utils::normalize_existing_path(&v.path)
            .to_string_lossy()
            .to_string();
    }
    let app_handle = app.clone();
    let export_id_clone = export_id.clone();

    // Lancement du rendu dans un thread bloquant (tokio::task::spawn_blocking)
    tokio::task::spawn_blocking(move || {
        filter_graph::build_and_run_ffmpeg_filter_complex(
            &export_id_clone,
            &out_path_str_for_task,
            &path_strs,
            &ts,
            &blank_timestamps,
            target_size,
            fps,
            fade_ms,
            start_time,
            &audios_vec,
            &videos_vec,
            true, // prefer_hw
            Some(&imgs_folder_resolved),
            duration,
            blur,
            video_fade_in_enabled.unwrap_or(false),
            video_fade_out_enabled.unwrap_or(false),
            audio_fade_in_enabled.unwrap_or(false),
            audio_fade_out_enabled.unwrap_or(false),
            export_fade_duration_ms.unwrap_or(0),
            export_without_background.unwrap_or(false),
            transparent_export_format.as_deref(),
            batch_size,
            batch_mode,
            performance_profile,
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("Erreur tâche: {}", e))?
    .map_err(|e| format!("Erreur ffmpeg: {}", e))?;

    // ---- Finalisation ----
    let export_time_s = t0.elapsed().as_secs_f64();
    *constants::LAST_EXPORT_TIME_S.lock().unwrap() = Some(export_time_s);
    ffmpeg_runner::clear_export_cancelled(&export_id);
    println!("[done] Export terminé en {:.2}s", export_time_s);
    println!("[metric] export_time_seconds={:.3}", export_time_s);

    let output_file_name = out_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let completion_data = serde_json::json!({
        "filename": output_file_name,
        "exportId": export_id,
        "fullPath": out_path_str
    });

    let _ = app.emit("export-complete", completion_data);

    Ok(out_path_str)
}

// ---------------------------------------------------------------------------
// Commande Tauri : cancel_export
// ---------------------------------------------------------------------------

/// Annule un export en cours.
///
/// Marque l'export comme annulé (vérifié par `ensure_export_not_cancelled`)
/// et tue le processus FFmpeg associé s'il est encore actif.
#[tauri::command]
pub fn cancel_export(export_id: String) -> Result<String, String> {
    println!(
        "[cancel_export] Demande d'annulation pour export_id: {}",
        export_id
    );
    ffmpeg_runner::mark_export_cancelled(&export_id);

    let mut active_exports = constants::ACTIVE_EXPORTS
        .lock()
        .map_err(|_| "Failed to lock active exports")?;

    if let Some(process_ref) = active_exports.remove(&export_id) {
        if let Ok(mut process_guard) = process_ref.lock() {
            if let Some(mut child) = process_guard.take() {
                match child.kill() {
                    Ok(_) => {
                        println!(
                            "[cancel_export] Processus FFmpeg tué avec succès pour export_id: {}",
                            export_id
                        );
                        let _ = child.wait(); // Nettoyer le processus zombie
                        Ok(format!("Export {} annulé avec succès", export_id))
                    }
                    Err(e) => {
                        println!(
                            "[cancel_export] Erreur lors de l'arrêt du processus: {:?}",
                            e
                        );
                        Err(format!("Erreur lors de l'annulation: {}", e))
                    }
                }
            } else {
                println!(
                    "[cancel_export] Aucun processus actif trouvé pour export_id: {}",
                    export_id
                );
                Err(format!("Aucun processus actif pour l'export {}", export_id))
            }
        } else {
            Err("Failed to lock process".to_string())
        }
    } else {
        println!(
            "[cancel_export] Export_id non trouvé dans les exports actifs: {}",
            export_id
        );
        Ok(format!("Annulation demandée pour l'export {}", export_id))
    }
}

// ---------------------------------------------------------------------------
// Commande Tauri : concat_videos
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
    performance_profile: ExportPerformanceProfile,
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

    if !Path::new(&output_path_str).exists() {
        return Err("Le fichier de sortie n'a pas été créé".to_string());
    }

    println!(
        "[concat_videos] ✅ Concaténation réussie: {}",
        output_path_str
    );
    Ok(output_path_str)
}
