use crate::path_utils;

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use tauri::Emitter;

use super::codec;
use super::concat;
use super::constants;
use super::fast_export::run_fast_export;
use super::ffmpeg_runner;
use super::types::{
    AudioInput, ExportPerformanceProfile, ExportVideoCodec, VideoClipTransitionMode, VideoInput,
};

// ---------------------------------------------------------------------------
// Commande Tauri : export_video
// ---------------------------------------------------------------------------

/// Commande principale d'export vidéo.
///
/// Parcourt un dossier d'images PNG nommées par timestamp, construit la timeline,
/// et lance le rendu FFmpeg rapide sans batching.
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
/// * `audio_clips` - Clips audio détaillés envoyés si la timeline contient un trim, un espace ou un volume individuel.
/// * `audio_volume` - Volume audio en pourcentage, entre 0 et 200.
/// * `videos` - Liste des vidéos de fond.
/// * `media_fill` - Recadre les vidéos et images afin de remplir le cadre.
/// * `media_scale` - Zoom du média de fond en pourcentage.
/// * `media_position_x` - Position horizontale relative au centre, entre -100 et 100.
/// * `media_position_y` - Position verticale relative au centre, entre -100 et 100.
/// * `blur` - Intensité du flou de fond.
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
    audio_clips: Option<Vec<AudioInput>>,
    audio_volume: Option<f64>,
    videos: Option<Vec<VideoInput>>,
    media_fill: Option<bool>,
    media_scale: Option<f64>,
    media_position_x: Option<f64>,
    media_position_y: Option<f64>,
    blur: Option<f64>,
    video_fade_in_enabled: Option<bool>,
    video_fade_out_enabled: Option<bool>,
    audio_fade_in_enabled: Option<bool>,
    audio_fade_out_enabled: Option<bool>,
    export_fade_duration_ms: Option<i32>,
    export_without_background: Option<bool>,
    transparent_export_format: Option<String>,
    video_codec: Option<ExportVideoCodec>,
    video_clip_transition_mode: Option<VideoClipTransitionMode>,
    video_clip_transition_duration_ms: Option<i32>,
    promotion_enabled: Option<bool>,
    promotion_position: Option<String>,
    video_width: Option<i32>,
    video_height: Option<i32>,
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
        "[timeline] blank timings fournis={}",
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
                .ok_or_else(|| format!("Nom de frame invalide: {}", p.display()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if ts.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err("Les timestamps des frames doivent etre strictement croissants.".to_string());
    }

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
    let total_duration_ms = duration.unwrap_or_else(|| ts[ts.len() - 1] + tail_ms);
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
    let audio_clips_vec = audio_clips.map(|clips| {
        clips
            .into_iter()
            .filter_map(|mut clip| {
                let normalized = path_utils::normalize_existing_path(&clip.path);
                if normalized.as_os_str().is_empty() || !normalized.exists() {
                    println!(
                        "[audio][warn] Clip audio introuvable, ignoré: {}",
                        clip.path
                    );
                    return None;
                }
                clip.path = normalized.to_string_lossy().to_string();
                Some(clip)
            })
            .collect::<Vec<_>>()
    });

    // ---- Normalisation des vidéos ----
    let mut videos_vec = videos.unwrap_or_default();
    for v in &mut videos_vec {
        v.path = path_utils::normalize_existing_path(&v.path)
            .to_string_lossy()
            .to_string();
    }
    let app_handle = app.clone();
    let export_id_clone = export_id.clone();
    let transparent_export_format_for_task = transparent_export_format.clone();
    let audio_gain = (audio_volume.unwrap_or(100.0) / 100.0).clamp(0.0, 2.0);
    let media_fill = media_fill.unwrap_or(false);
    let media_scale = media_scale.unwrap_or(100.0).clamp(100.0, 300.0);
    let media_position_x = media_position_x.unwrap_or(0.0).clamp(-100.0, 100.0);
    let media_position_y = media_position_y.unwrap_or(0.0).clamp(-100.0, 100.0);

    // Lancement du rendu dans un thread bloquant (tokio::task::spawn_blocking)
    tokio::task::spawn_blocking(move || {
        run_fast_export(
            &export_id_clone,
            &out_path_str_for_task,
            &path_strs,
            &ts,
            target_size,
            fps,
            fade_ms,
            start_time,
            &audios_vec,
            audio_clips_vec.as_deref(),
            audio_gain,
            &videos_vec,
            media_fill,
            media_scale,
            media_position_x,
            media_position_y,
            true, // prefer_hw
            duration,
            blur,
            video_fade_in_enabled.unwrap_or(false),
            video_fade_out_enabled.unwrap_or(false),
            audio_fade_in_enabled.unwrap_or(false),
            audio_fade_out_enabled.unwrap_or(false),
            export_fade_duration_ms.unwrap_or(0),
            export_without_background.unwrap_or(false),
            transparent_export_format_for_task.as_deref(),
            video_codec.unwrap_or(ExportVideoCodec::H264),
            video_clip_transition_mode.unwrap_or(VideoClipTransitionMode::None),
            video_clip_transition_duration_ms.unwrap_or(0),
            performance_profile,
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("Erreur tâche: {}", e))?
    .map_err(|e| format!("Erreur ffmpeg: {}", e))?;

    if promotion_enabled.unwrap_or(false) {
        concat::apply_promotion_to_video(
            &export_id,
            &out_path_str,
            promotion_position.as_deref().unwrap_or("end"),
            video_width.unwrap_or(0),
            video_height.unwrap_or(0),
            fps,
            export_without_background.unwrap_or(false),
            transparent_export_format.as_deref(),
            video_codec.unwrap_or(ExportVideoCodec::H264),
            performance_profile,
            &app,
        )
        .map_err(|error| format!("Erreur ajout de la promotion Quran Caption: {}", error))?;
    }

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
