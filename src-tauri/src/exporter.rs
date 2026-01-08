use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;
use tauri::Emitter;
use tokio::task;
use crate::binaries;

// Expose la dernière durée d'export terminée (en secondes)
static LAST_EXPORT_TIME_S: Mutex<Option<f64>> = Mutex::new(None);

// CONFIG DE DEVELOPPEMENT
// Mettre à `true` pour tester l'export CPU même si une carte Nvidia est dispo
// En PROD (release), cette valeur est ignorée et on privilégie toujours le GPU.
#[cfg(debug_assertions)]
const DEV_FORCE_CPU_ENCODING: bool = true;

fn should_prefer_hw_encoding() -> bool {
    #[cfg(debug_assertions)]
    {
        if DEV_FORCE_CPU_ENCODING {
            println!("[DEV] Forçage de l'encodage CPU activé (DEV_FORCE_CPU_ENCODING = true)");
            return false;
        }
    }
    true
}

// Gestionnaire des processus actifs pour pouvoir les annuler
static ACTIVE_EXPORTS: LazyLock<Mutex<HashMap<String, Arc<Mutex<Option<std::process::Child>>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

// Fonction utilitaire pour configurer les commandes et cacher les fenêtres CMD sur Windows
fn configure_command_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;
        cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
}

fn resolve_ffmpeg_binary() -> Option<String> {
    if let Some(path) = binaries::resolve_binary("ffmpeg") {
        return Some(path);
    }

    // En dernier recours, utiliser ffmpeg du PATH système
    println!("[ffmpeg] Tentative d'utilisation de ffmpeg du système (PATH)");
    if let Ok(_) = std::process::Command::new("ffmpeg").arg("-version").output() {
        println!("[ffmpeg] ✓ FFmpeg trouvé dans le PATH système");
        return Some("ffmpeg".to_string());
    }

    // Aucun binaire FFmpeg trouvé
    None
}

fn resolve_ffprobe_binary() -> String {
    if let Some(path) = binaries::resolve_binary("ffprobe") {
        return path;
    }

    // En dernier recours, utiliser ffprobe du PATH système
    println!("[ffprobe] Tentative d'utilisation de ffprobe du système (PATH)");
    if let Ok(_) = std::process::Command::new("ffprobe").arg("-version").output() {
        println!("[ffprobe] ✓ FFprobe trouvé dans le PATH système");
        return "ffprobe".to_string();
    }

    // Fallback vers le binaire système
    "ffprobe".to_string()
}

/// Teste si NVENC est réellement disponible en essayant un encodage rapide
fn test_nvenc_availability(ffmpeg_path: Option<&str>) -> bool {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");
    
    println!("[nvenc_test] Test de disponibilité NVENC...");
    
    // Créer une entrée vidéo de test très courte (1 frame noir)
    // NVENC nécessite une résolution minimale (généralement 128x128 ou plus)
    let mut cmd = Command::new(exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=black:s=128x128:r=1:d=0.04", // Résolution minimum NVENC, très courte
        "-c:v", "h264_nvenc",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-frames:v", "1",
        "-f", "null", // Sortie nulle pour éviter d'écrire un fichier
        "-"
    ]);
    
    configure_command_no_window(&mut cmd);
    
    match cmd.output() {
        Ok(output) => {
            let success = output.status.success();
            let stderr = String::from_utf8_lossy(&output.stderr);
            
            if success {
                println!("[nvenc_test] ✓ NVENC disponible et fonctionnel");
                true
            } else {
                // Analyser les erreurs pour distinguer "pas disponible" vs "erreur de config"
                let stderr_lower = stderr.to_lowercase();
                
                if stderr_lower.contains("cannot load nvcuda.dll") || 
                   stderr_lower.contains("no nvidia devices") ||
                   stderr_lower.contains("cuda") ||
                   stderr_lower.contains("driver") {
                    println!("[nvenc_test] ✗ NVENC non disponible (pas de GPU NVIDIA ou drivers manquants)");
                    false
                } else if stderr_lower.contains("frame dimension") {
                    // Si c'est juste un problème de dimensions, essayer avec une plus grande résolution
                    println!("[nvenc_test] Retry avec résolution plus grande...");
                    test_nvenc_with_larger_resolution(ffmpeg_path)
                } else {
                    println!("[nvenc_test] ✗ NVENC erreur: {}", stderr.trim());
                    false
                }
            }
        }
        Err(e) => {
            println!("[nvenc_test] ✗ Erreur lors du test NVENC: {}", e);
            false
        }
    }
}

fn test_nvenc_with_larger_resolution(ffmpeg_path: Option<&str>) -> bool {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");
    
    let mut cmd = Command::new(exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=black:s=256x256:r=1:d=0.04", // Résolution encore plus grande
        "-c:v", "h264_nvenc",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-frames:v", "1",
        "-f", "null",
        "-"
    ]);
    
    configure_command_no_window(&mut cmd);
    
    match cmd.output() {
        Ok(output) => {
            let success = output.status.success();
            if success {
                println!("[nvenc_test] ✓ NVENC disponible avec résolution 256x256");
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("[nvenc_test] ✗ NVENC toujours non disponible: {}", stderr.trim());
            }
            success
        }
        Err(e) => {
            println!("[nvenc_test] ✗ Erreur test résolution plus grande: {}", e);
            false
        }
    }
}

fn probe_hw_encoders(ffmpeg_path: Option<&str>) -> Vec<String> {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");
    
    let output = match Command::new(exe)
        .args(&["-hide_banner", "-encoders"])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    
    let txt = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let mut found = Vec::new();
    
    if txt.contains("h264_nvenc") {
        found.push("h264_nvenc".to_string());
    }
    if txt.contains("h264_qsv") {
        found.push("h264_qsv".to_string());
    }
    if txt.contains("h264_amf") {
        found.push("h264_amf".to_string());
    }
    
    found
}

fn choose_best_codec(prefer_hw: bool) -> (String, Vec<String>, HashMap<String, Option<String>>) {
    let ffmpeg_exe = resolve_ffmpeg_binary();
    let hw = if prefer_hw {
        probe_hw_encoders(ffmpeg_exe.as_deref())
    } else {
        Vec::new()
    };
    
    if !hw.is_empty() {
        // Tester spécifiquement NVENC s'il est détecté
        if hw[0] == "h264_nvenc" {
            if test_nvenc_availability(ffmpeg_exe.as_deref()) {
                println!("[codec] Utilisation de NVENC (accélération GPU NVIDIA)");
                let codec = hw[0].clone();
                let params = vec![
                    "-pix_fmt".to_string(), "yuv420p".to_string(),
                    "-bf".to_string(), "0".to_string(),
                ];
                let mut extra = HashMap::new();
                extra.insert("preset".to_string(), Some("p4".to_string()));
                return (codec, params, extra);
            } else {
                println!("[codec] NVENC détecté mais non fonctionnel, fallback vers libx264");
            }
        } else {
            // Pour les autres encodeurs hardware (QSV, AMF), utiliser directement
            println!("[codec] Utilisation de l'encodeur hardware: {}", hw[0]);
            let codec = hw[0].clone();
            let params = vec!["-pix_fmt".to_string(), "yuv420p".to_string()];
            let mut extra = HashMap::new();
            extra.insert("preset".to_string(), None);
            return (codec, params, extra);
        }
    }
    
    // Fallback libx264
    println!("[codec] Utilisation de libx264 (encodage logiciel)");
    let codec = "libx264".to_string();
    let params = vec![
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-crf".to_string(), "22".to_string(),
        "-tune".to_string(), "zerolatency".to_string(),
        "-bf".to_string(), "0".to_string(),
    ];
    let mut extra = HashMap::new();
    extra.insert("preset".to_string(), Some("ultrafast".to_string()));
    
    (codec, params, extra)
}

fn ffmpeg_preprocess_video(src: &str, dst: &str, w: i32, h: i32, fps: i32, prefer_hw: bool, start_ms: Option<i32>, duration_ms: Option<i32>, blur: Option<f64>) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let (codec, params, extra) = choose_best_codec(prefer_hw);
    let exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());

    // Construire le filtre vidéo avec blur optionnel
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

    let mut cmd = Command::new(&exe);

    // Si un offset de début est fourni, l'ajouter avant -i pour seek rapide
    if let Some(sms) = start_ms {
        let s = format!("{:.3}", (sms as f64) / 1000.0);
        cmd.arg("-ss").arg(s);
    }

    cmd.arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel").arg("error")
        .arg("-fflags").arg("+genpts")
        .arg("-avoid_negative_ts").arg("make_zero")
        .arg("-vsync").arg("cfr")
        .arg("-i").arg(src);

    // Si une durée de découpe est fournie, la limiter
    if let Some(dms) = duration_ms {
        let d = format!("{:.3}", (dms as f64) / 1000.0);
        cmd.arg("-t").arg(d);
    }

    let gop = fps * 2;
    cmd.arg("-an")
        .arg("-vf").arg(&vf)
        .arg("-pix_fmt").arg("yuv420p")
        .arg("-c:v").arg(&codec)
        .arg("-g").arg(gop.to_string());

    if let Some(Some(preset)) = extra.get("preset") {
        cmd.arg("-preset").arg(preset);
    }

    for param in params {
        cmd.arg(param);
    }

    cmd.arg(dst);

    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);

    println!("[preproc] ffmpeg scale+pad -> {}", Path::new(dst).file_name().unwrap_or_default().to_string_lossy());

    let status = cmd.status()?;
    if !status.success() {
        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, "FFmpeg preprocessing failed")));
    }

    Ok(())
}

fn create_video_from_image(image_path: &str, output_path: &str, w: i32, h: i32, fps: i32, duration_s: f64, prefer_hw: bool, blur: Option<f64>) -> Result<(), Box<dyn std::error::Error>> {
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    
    // Construire le filtre vidéo avec blur optionnel
    let mut vf_parts = vec![
        format!("scale={}:{}:force_original_aspect_ratio=increase", w, h),
        format!("crop={}:{}:(in_w-{})/2:(in_h-{})/2", w, h, w, h),
    ];
    
    // Ajouter le flou si spécifié et > 0
    if let Some(blur_value) = blur {
        if blur_value > 0.0 {
            vf_parts.push(format!("gblur=sigma={}", blur_value));
        }
    }
    
    let video_filter = vf_parts.join(",");
    
    // Choisir le meilleur codec avec détection automatique
    let (codec, codec_params, codec_extra) = choose_best_codec(prefer_hw);
    
    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&[
        "-y",
        "-hide_banner", 
        "-loglevel", "info",
        "-fflags", "+genpts",
        "-avoid_negative_ts", "make_zero",
        "-vsync", "cfr",
        "-loop", "1",
        "-i", image_path,
        "-vf", &video_filter,
        "-c:v", &codec,
        "-r", &fps.to_string(),
        "-g", &(fps * 2).to_string(),
        "-t", &format!("{:.6}", duration_s),
    ]);
    
    // Ajouter le preset si disponible
    if let Some(Some(preset)) = codec_extra.get("preset") {
        cmd.arg("-preset").arg(preset);
    }
    
    // Ajouter les paramètres du codec
    for param in codec_params {
        cmd.arg(param);
    }
    
    // Ajouter des paramètres de qualité selon le codec
    if codec == "libx264" {
        cmd.args(&["-crf", "23"]);
    } else if codec.contains("nvenc") {
        cmd.args(&["-cq", "23"]);
    }
    
    cmd.arg(output_path);

    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);

    println!("[preproc][IMG] Création vidéo depuis image: {} -> {}", image_path, output_path);
    println!("[preproc][IMG] Commande: {:?}", cmd);

    let status = cmd.status()?;
    if !status.success() {
        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, "FFmpeg image-to-video failed")));
    }

    Ok(())
}

fn is_image_file(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg") || 
    path_lower.ends_with(".png") || path_lower.ends_with(".bmp") || 
    path_lower.ends_with(".gif") || path_lower.ends_with(".webp") ||
    path_lower.ends_with(".tiff") || path_lower.ends_with(".tif")
}

fn preprocess_background_videos(video_paths: &[String], w: i32, h: i32, fps: i32, prefer_hw: bool, start_time_ms: i32, duration_ms: Option<i32>, blur: Option<f64>) -> Vec<String> {
    let mut out_paths = Vec::new();
    let cache_dir = std::env::temp_dir().join("qurancaption-preproc");
    fs::create_dir_all(&cache_dir).ok();

    // Cas spécial : une seule image
    if video_paths.len() == 1 && is_image_file(&video_paths[0]) {
        let image_path = &video_paths[0];
        let duration_s = if let Some(dur_ms) = duration_ms { 
            dur_ms as f64 / 1000.0 
        } else { 
            30.0 // Durée par défaut si non spécifiée
        };

        // Construire un nom de cache unique pour l'image
        let blur_suffix = if let Some(b) = blur {
            if b > 0.0 { format!("-blur{}", b) } else { String::new() }
        } else { String::new() };
        let hash_input = format!("{}-{}x{}-{}-dur{}{}-hw{}", image_path, w, h, fps, duration_s, blur_suffix, prefer_hw);
        let stem_hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        let stem_hash = &stem_hash[..10.min(stem_hash.len())];
        let dst = cache_dir.join(format!("img-bg-{}-{}x{}-{}.mp4", stem_hash, w, h, fps));

        if !dst.exists() {
            match create_video_from_image(image_path, &dst.to_string_lossy(), w, h, fps, duration_s, prefer_hw, blur) {
                Ok(_) => {},
                Err(e) => {
                    println!("[preproc][ERREUR] Impossible de créer la vidéo à partir de l'image: {:?}", e);
                    return vec![];
                }
            }
        }

        out_paths.push(dst.to_string_lossy().to_string());
        return out_paths;
    }

    // Calculer les durées (ms) de chaque vidéo
    let mut video_durations_ms: Vec<i64> = Vec::new();
    for p in video_paths {
        let d = (ffprobe_duration_sec(p) * 1000.0).round() as i64;
        video_durations_ms.push(d);
    }

    // Limite de la plage demandée
    let limit_ms: i64 = if let Some(dur) = duration_ms { dur as i64 } else { i64::MAX };

    // Parcourir les vidéos et extraire uniquement les segments pertinents
    let mut cum_start: i64 = 0;
    for (idx, p) in video_paths.iter().enumerate() {
        let vid_len = video_durations_ms.get(idx).cloned().unwrap_or(0);
        let cum_end = cum_start + vid_len;

        // Si la vidéo se termine avant le début recherché, on l'ignore complètement
        if cum_end <= start_time_ms as i64 {
            cum_start = cum_end;
            continue;
        }

        // Si on a déjà dépassé la limite demandée, on arrête
        let elapsed_so_far = cum_start - (start_time_ms as i64);
        if elapsed_so_far >= limit_ms {
            break;
        }

        // Déterminer le début à l'intérieur de cette vidéo
        let start_within = if start_time_ms as i64 > cum_start { (start_time_ms as i64 - cum_start) } else { 0 };

        // Durée restante à prendre dans cette vidéo
        let elapsed_from_start = (cum_start + start_within) - (start_time_ms as i64);
        let remaining_needed = (limit_ms - elapsed_from_start).max(0);
        let take_ms = remaining_needed.min(vid_len - start_within);

        if take_ms <= 0 {
            cum_start = cum_end;
            continue;
        }

        // Construire un nom de cache unique qui inclut les offsets et le blur
        let blur_suffix = if let Some(b) = blur {
            if b > 0.0 { format!("-blur{}", b) } else { String::new() }
        } else { String::new() };
        let hash_input = format!("{}-{}x{}-{}-start{}-len{}{}-hw{}", p, w, h, fps, start_within, take_ms, blur_suffix, prefer_hw);
        let stem_hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        let stem_hash = &stem_hash[..10.min(stem_hash.len())];
        let dst = cache_dir.join(format!("bg-{}-{}x{}-{}.mp4", stem_hash, w, h, fps));

        if !dst.exists() {
            // Appeler ffmpeg_preprocess_video avec les offsets locaux
            match ffmpeg_preprocess_video(p, &dst.to_string_lossy(), w, h, fps, prefer_hw, Some(start_within as i32), Some(take_ms as i32), blur) {
                Ok(_) => {},
                Err(e) => {
                    println!("[preproc][ERREUR] {:?}", e);
                    // En cas d'échec, utiliser la vidéo originale (et laisser ffmpeg final gérer le trim)
                    out_paths.push(p.clone());
                    cum_start = cum_end;
                    continue;
                }
            }
        }

        out_paths.push(dst.to_string_lossy().to_string());

        // Si on a atteint la limite, on arrête
        let elapsed_total = (cum_start + start_within + take_ms) - (start_time_ms as i64);
        if elapsed_total >= limit_ms {
            break;
        }

        cum_start = cum_end;
    }

    out_paths
}

fn ffprobe_duration_sec(path: &str) -> f64 {
    let exe = resolve_ffprobe_binary();
    
    let mut cmd = Command::new(&exe);
    cmd.args(&[
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=nokey=1:noprint_wrappers=1",
        path,
    ]);
    
    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);
    
    let output = match cmd.output() {
        Ok(output) => output,
        Err(_) => return 0.0,
    };
    
    let txt = String::from_utf8_lossy(&output.stdout).trim().to_string();
    txt.parse::<f64>().unwrap_or(0.0)
}

fn video_has_audio(path: &str) -> bool {
    let exe = resolve_ffprobe_binary();

    let output = Command::new(&exe)
        .args(&[
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=index",
            "-of", "csv=p=0",
            path,
        ])
        .output();

    match output {
        Ok(out) => !out.stdout.is_empty(),
        Err(_) => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_and_run_ffmpeg_filter_complex(
    export_id: &str,
    out_path: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
    target_size: (i32, i32),
    fps: i32,
    fade_duration_ms: i32,
    start_time_ms: i32,
    audio_paths: &[String],
    bg_videos: &[String],
    prefer_hw: bool,
    imgs_cwd: Option<&str>,
    duration_ms: Option<i32>,
    chunk_index: Option<i32>,
    blur: Option<f64>,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let (w, h) = target_size;
    let fade_s = (fade_duration_ms as f64 / 1000.0).max(0.0);
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);
    
    let n = image_paths.len();
    if n == 0 {
        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Aucune image fournie")));
    }
    if n != timestamps_ms.len() {
        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Le nombre d'images ne correspond pas au nombre de timestamps")));
    }
    
    let tail_ms = fade_duration_ms.max(1000);
    let mut durations_s = Vec::new();
    
    for i in 0..n {
        if i < n - 1 {
            durations_s.push(((timestamps_ms[i + 1] - timestamps_ms[i]) as f64 / 1000.0).max(0.001));
        } else {
            durations_s.push((tail_ms as f64 / 1000.0).max(0.001));
        }
    }
    
    let total_by_ts = (timestamps_ms[n - 1] + tail_ms) as f64 / 1000.0;
    let duration_s = if let Some(dur_ms) = duration_ms {
        dur_ms as f64 / 1000.0
    } else {
        total_by_ts
    };
    
    let mut starts_s = Vec::new();
    let mut acc = 0.0;
    for &d in &durations_s {
        starts_s.push(acc);
        acc += d;
    }
    
    let (vcodec, vparams, vextra) = choose_best_codec(prefer_hw);
    
    let mut pre_videos = Vec::new();
    if !bg_videos.is_empty() {
        pre_videos = preprocess_background_videos(bg_videos, w, h, fps, prefer_hw, start_time_ms, duration_ms, blur);
    }
    
    let mut total_bg_s = 0.0;
    for p in &pre_videos {
        total_bg_s += ffprobe_duration_sec(p);
    }
    
    let mut total_audio_s = 0.0;
    for p in audio_paths {
        total_audio_s += ffprobe_duration_sec(p);
    }
    let have_audio = !audio_paths.is_empty() && start_s < total_audio_s - 1e-6;
    
    // Préparer le fichier concat
    let base_dir = if let Some(cwd) = imgs_cwd {
        PathBuf::from(cwd)
    } else {
        std::env::temp_dir()
    };
    fs::create_dir_all(&base_dir).ok();
    
    let concat_content = image_paths.join("|");
    let concat_hash = format!("{:x}", md5::compute(concat_content.as_bytes()));
    let concat_path = base_dir.join(format!("images-{}.ffconcat", &concat_hash[..8]));
    
    let mut concat_file = fs::File::create(&concat_path)?;
    writeln!(concat_file, "ffconcat version 1.0")?;
    for (i, p) in image_paths.iter().enumerate() {
        writeln!(concat_file, "file '{}'", p)?;
        writeln!(concat_file, "duration {:.6}", durations_s[i])?;
    }
    writeln!(concat_file, "file '{}'", image_paths[n - 1])?;
    
    println!("[concat] Fichier ffconcat -> {:?}", concat_path);
    
    let mut cmd = Vec::new();
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    cmd.extend_from_slice(&[
        ffmpeg_exe.clone(),
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(), "info".to_string(),
        "-fflags".to_string(), "+genpts".to_string(),
        "-avoid_negative_ts".to_string(), "make_zero".to_string(),
        "-vsync".to_string(), "cfr".to_string(),
        "-stats".to_string(),
        "-progress".to_string(), "pipe:2".to_string(),
    ]);
    
    let mut current_idx = 0;
    
    // Entrée unique: concat demuxer
    let concat_name = if imgs_cwd.is_some() {
        concat_path.file_name().unwrap().to_string_lossy().to_string()
    } else {
        concat_path.to_string_lossy().to_string()
    };
    
    cmd.extend_from_slice(&[
        "-safe".to_string(), "0".to_string(),
        "-f".to_string(), "concat".to_string(),
        "-i".to_string(), concat_name,
    ]);
    current_idx = 1;
    
    // Entrées vidéos de fond
    let bg_start_idx = current_idx;
    for p in &pre_videos {
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
    
    // Base: préparer le flux vidéo unique [0:v]
    let mut split_outputs = String::new();
    for i in 0..n {
        split_outputs.push_str(&format!("[b{}]", i));
    }
    
    filter_lines.push(format!(
        "[0:v]format=rgba,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps={},setpts=PTS-STARTPTS,setsar=1,format=yuva444p,split={}{}",
        w, h, w, h, fps, n, split_outputs
    ));
    
    // Pour chaque segment, extraire la fenêtre temporelle et séparer couleur/alpha
    for i in 0..n {
        let s = starts_s[i];
        let e = s + durations_s[i];
        filter_lines.push(format!(
            "[b{}]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS,fps={},split=2[s{}witha][s{}foralpha]",
            i, s, e, fps, i, i
        ));
        filter_lines.push(format!("[s{}foralpha]extractplanes=a[s{}a]", i, i));
        filter_lines.push(format!("[s{}witha]format=yuv444p[s{}c]", i, i));
    }
    
    // Chaîne xfade pour couleur et alpha séparément
    let mut curr_c = "s0c".to_string();
    let mut curr_a = "s0a".to_string();
    let mut curr_duration = durations_s[0];
    
    for i in 0..(n - 1) {
        let fade_i = durations_s[i].min(fade_s);
        if fade_i <= 1e-6 {
            let out_c = format!("cc{}", i);
            let out_a = format!("ca{}", i);
            filter_lines.push(format!("[{}][s{}c]concat=n=2:v=1:a=0[{}]", curr_c, i + 1, out_c));
            filter_lines.push(format!("[{}][s{}a]concat=n=2:v=1:a=0[{}]", curr_a, i + 1, out_a));
            curr_c = out_c;
            curr_a = out_a;
            curr_duration += durations_s[i + 1];
        } else {
            let out_c = format!("xc{}", i);
            let out_a = format!("xa{}", i);
            let offset = (curr_duration - fade_i).max(0.0);
            filter_lines.push(format!(
                "[{}][s{}c]xfade=transition=fade:duration={:.6}:offset={:.6}[{}]",
                curr_c, i + 1, fade_i, offset, out_c
            ));
            filter_lines.push(format!(
                "[{}][s{}a]xfade=transition=fade:duration={:.6}:offset={:.6}[{}]",
                curr_a, i + 1, fade_i, offset, out_a
            ));
            curr_c = out_c;
            curr_a = out_a;
            curr_duration = curr_duration + durations_s[i + 1] - fade_i;
        }
    }
    
    // Reconstituer RGBA pour l'overlay final
    filter_lines.push(format!("[{}][{}]alphamerge,format=yuva444p[overlay]", curr_c, curr_a));
    
    // Construction de la vidéo de fond [bg]
    let avail_bg_after = total_bg_s;
    let need_black_full = pre_videos.is_empty() || avail_bg_after <= 1e-6;
    
    let bg_label = if need_black_full {
        let color_full_idx = current_idx;
        cmd.extend_from_slice(&[
            "-f".to_string(), "lavfi".to_string(),
            "-i".to_string(), format!("color=c=black:s={}x{}:r={}:d={:.6}", w, h, fps, duration_s),
        ]);
        current_idx += 1;
        format!("{}:v", color_full_idx)
    } else {
        let prev = if pre_videos.len() > 1 {
            let mut ins = String::new();
            for i in 0..pre_videos.len() {
                ins.push_str(&format!("[{}:v]", bg_start_idx + i));
            }
            filter_lines.push(format!("{}concat=n={}:v=1:a=0[bgcat]", ins, pre_videos.len()));
            "bgcat".to_string()
        } else {
            format!("{}:v", bg_start_idx)
        };
        
        filter_lines.push(format!("[{}]setpts=PTS-STARTPTS,setsar=1[bgtrim]", prev));
        let mut bg_label = "bgtrim".to_string();
        
        if avail_bg_after + 1e-6 < duration_s {
            let remain = duration_s - avail_bg_after;
            let color_pad_idx = current_idx;
            cmd.extend_from_slice(&[
                "-f".to_string(), "lavfi".to_string(),
                "-i".to_string(), format!("color=c=black:s={}x{}:r={}:d={:.6}", w, h, fps, remain),
            ]);
            current_idx += 1;
            filter_lines.push(format!("[{}:v]setsar=1[colorpad]", color_pad_idx));
            filter_lines.push(format!("[bgtrim][colorpad]concat=n=2:v=1:a=0[bg]"));
            bg_label = "bg".to_string();
        }
        
        bg_label
    };
    
    // Superposition de l'overlay (avec alpha) sur le fond
    filter_lines.push(format!("[{}]setsar=1[bg_normalized]", bg_label));
    filter_lines.push(format!("[bg_normalized][overlay]overlay=shortest=1:x=0:y=0,format=yuv420p[vout]"));
    
    // Audio: concat, skip start_s, clamp à duration_s
    if have_audio {
        let a = audio_paths.len();
        if a == 1 {
            let a0 = format!("{}:a", audio_start_idx);
            filter_lines.push(format!("[{}]aresample=48000[aa0]", a0));
            filter_lines.push(format!("[aa0]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aout]", start_s, duration_s));
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
            filter_lines.push(format!("[aacat]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aout]", start_s, duration_s));
        }
    }
    
    let filter_complex = filter_lines.join(";");
    
    // Écrit le filtergraph dans un fichier temporaire
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
    
    let fg_name = if imgs_cwd.is_some() {
        fg_path.file_name().unwrap().to_string_lossy().to_string()
    } else {
        fg_path.to_string_lossy().to_string()
    };
    
    cmd.extend_from_slice(&["-filter_complex_script".to_string(), fg_name]);
    
    // Mapping
    cmd.extend_from_slice(&["-map".to_string(), "[vout]".to_string()]);
    if have_audio {
        cmd.extend_from_slice(&["-map".to_string(), "[aout]".to_string()]);
    }
    
    // Codec vidéo + audio
    let gop = fps * 2;
    cmd.extend_from_slice(&[
        "-r".to_string(), fps.to_string(), 
        "-g".to_string(), gop.to_string(),
        "-c:v".to_string(), vcodec
    ]);
    if let Some(Some(preset)) = vextra.get("preset") {
        cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
    }
    cmd.extend(vparams);
    
    if have_audio {
        cmd.extend_from_slice(&["-c:a".to_string(), "aac".to_string(), "-b:a".to_string(), "192k".to_string()]);
    }
    
    // Assure la durée exacte
    cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", duration_s)]);
    
    // Faststart pour formats MP4/MOV
    let ext = Path::new(out_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }
    
    // Fichier de sortie
    cmd.push(out_path.to_string());
    
    println!("[ffmpeg] Commande:");
    let preview = if cmd.len() > 14 {
        format!("{} ...", cmd[..14].join(" "))
    } else {
        cmd.join(" ")
    };
    println!("  {}", preview);
    
    // Exécution avec capture de la progression
    let mut command = Command::new(&cmd[0]);
    command.args(&cmd[1..]);
    command.stderr(Stdio::piped());
    
    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut command);
    
    if let Some(cwd) = imgs_cwd {
        command.current_dir(cwd);
    }
    
    let mut child = command.spawn()?;
    
    // Enregistrer le processus dans les exports actifs
    let process_ref = Arc::new(Mutex::new(Some(child)));
    {
        let mut active_exports = ACTIVE_EXPORTS.lock().map_err(|_| "Failed to lock active exports")?;
        active_exports.insert(export_id.to_string(), process_ref.clone());
    }
    
    let stderr = {
        let mut child_guard = process_ref.lock().map_err(|_| "Failed to lock child process")?;
        if let Some(ref mut child) = child_guard.as_mut() {
            child.stderr.take().ok_or("Failed to capture stderr")?
        } else {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, "Process was cancelled")));
        }
    };
    
    // Lire la sortie stderr pour capturer la progression
    let reader = BufReader::new(stderr);
    let mut stderr_content = String::new();
    
    for line in reader.lines() {
        if let Ok(line) = line {
            println!("[ffmpeg] {}", line); // Debug: afficher toutes les lignes
            
            // Sauvegarder toutes les lignes stderr pour le debugging
            stderr_content.push_str(&line);
            stderr_content.push('\n');
            
            // Chercher les lignes de progression FFmpeg qui contiennent "time=" ou "out_time_ms="
            if line.contains("time=") || line.contains("out_time_ms=") {
                if let Some(time_str) = extract_time_from_ffmpeg_line(&line) {
                    let current_time_s = parse_ffmpeg_time(&time_str);
                    let progress = if duration_s > 0.0 {
                        (current_time_s / duration_s * 100.0).min(100.0)
                    } else {
                        0.0
                    };
                    
                    println!("[progress] {}% ({:.1}s / {:.1}s)", progress.round(), current_time_s, duration_s);
                    
                    // Préparer les données de progression
                    let mut progress_data = serde_json::json!({
                        "export_id": export_id,
                        "progress": progress,
                        "current_time": current_time_s,
                        "total_time": duration_s
                    });
                    
                    // Ajouter chunk_index si fourni
                    if let Some(chunk_idx) = chunk_index {
                        progress_data["chunk_index"] = serde_json::Value::Number(serde_json::Number::from(chunk_idx));
                    }
                    
                    // Émettre l'événement de progression vers le frontend
                    let _ = app_handle.emit("export-progress", progress_data);
                }
            }
        }
    }
    
    // Attendre la fin du processus
    let status = {
        let mut child_guard = process_ref.lock().map_err(|_| "Failed to lock child process")?;
        if let Some(mut child) = child_guard.take() {
            child.wait()?
        } else {
            // Le processus a été annulé
            let error_msg = format!("Export {} was cancelled", export_id);
            let mut error_data = serde_json::json!({
                "export_id": export_id,
                "error": error_msg
            });
            
            // Ajouter chunk_index si fourni
            if let Some(chunk_idx) = chunk_index {
                error_data["chunk_index"] = serde_json::Value::Number(serde_json::Number::from(chunk_idx));
            }
            
            let _ = app_handle.emit("export-error", error_data);
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Interrupted, error_msg)));
        }
    };
    
    // Nettoyer les exports actifs
    {
        let mut active_exports = ACTIVE_EXPORTS.lock().map_err(|_| "Failed to lock active exports")?;
        active_exports.remove(export_id);
    }
    
    if !status.success() {
        // Créer un fichier de log avec la date d'aujourd'hui
        let now = std::time::SystemTime::now();
        let timestamp = now.duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let log_filename = format!("ffmpeg_failed_{}.txt", timestamp);
        
        let log_content = format!(
            "FFmpeg Export Failure Log\n\
             =========================\n\
             Timestamp: {}\n\
             Export ID: {}\n\
             Exit Code: {:?}\n\
             \n\
             FFmpeg Command:\n\
             {}\n\
             \n\
             Standard Error Output:\n\
             {}\n",
            timestamp,
            export_id,
            status.code(),
            cmd.join(" "),
            if stderr_content.is_empty() {
                "No stderr output captured".to_string()
            } else {
                stderr_content
            }
        );
        
        // Écrire le fichier de log
        if let Err(log_err) = std::fs::write(&log_filename, &log_content) {
            eprintln!("Failed to write log file {}: {}", log_filename, log_err);
        } else {
            println!("FFmpeg error details saved to: {}", log_filename);
        }
        
        let error_msg = format!(
            "ffmpeg failed during video exportation (exit code: {:?})\n\nSee the log file: {}\n\nLog details:\n{}", 
            status.code(), 
            log_filename,
            log_content
        );
        let mut error_data = serde_json::json!({
            "export_id": export_id,
            "error": error_msg
        });
        
        // Ajouter chunk_index si fourni
        if let Some(chunk_idx) = chunk_index {
            error_data["chunk_index"] = serde_json::Value::Number(serde_json::Number::from(chunk_idx));
        }
        
        let _ = app_handle.emit("export-error", error_data);
        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, error_msg)));
    }
    
    Ok(())
}

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
    videos: Option<Vec<String>>,
    chunk_index: Option<i32>,
    blur: Option<f64>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let t0 = Instant::now();
    
    // Logs init
    println!("[start_export] export_id={}", export_id);
    println!("[start_export] imgs_folder={}", imgs_folder);
    println!("[start_export] final_file_path={}", final_file_path);
    println!("[start_export] fps={}, fade_duration(ms)={}", fps, fade_duration);
    println!("[env] CPU cores: {:?}", std::thread::available_parallelism().map(|n| n.get()));
    
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
    
    // Liste des PNG triés par timestamp
    let folder = Path::new(&imgs_folder);
    println!("[scan] Parcours du dossier: {:?}", folder.canonicalize().unwrap_or_else(|_| folder.to_path_buf()));
    
    let mut files: Vec<_> = fs::read_dir(folder)
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
    
    files.sort_by_key(|p| {
        p.file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0)
    });
    
    println!("[scan] {} image(s) trouvée(s)", files.len());
    
    if files.is_empty() {
        return Err("Aucune image .png trouvée dans imgs_folder".to_string());
    }
    
    let first_stem = files[0]
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(-1);
    
    if first_stem != 0 {
        return Err("La première image doit être '0.png' (timestamp 0 ms).".to_string());
    }
    
    // Timeline et chemins
    let ts: Vec<i32> = files
        .iter()
        .map(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0)
        })
        .collect();
    
    let path_strs: Vec<String> = files
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect();
    
    let ts_preview: Vec<i32> = ts.iter().take(10).cloned().collect();
    println!("[timeline] Premiers timestamps: {:?}{}", ts_preview, if ts.len() > 10 { " ..." } else { "" });
    println!("[timeline] Nombre d'images: {}", ts.len());
    
    // Taille cible = taille de 0.png
    println!("[image] Ouverture de la première image pour taille cible...");
    let target_size = {
        let img_data = fs::read(&files[0]).map_err(|e| format!("Erreur lecture image: {}", e))?;
        let img = image::load_from_memory(&img_data).map_err(|e| format!("Erreur décodage image: {}", e))?;
        (img.width() as i32, img.height() as i32)
    };
    
    println!("[image] Taille cible: {}x{}", target_size.0, target_size.1);
    
    // Durée totale
    let fade_ms = fade_duration;
    let tail_ms = fade_ms.max(1000);
    let total_duration_ms = ts[ts.len() - 1] + tail_ms;
    let duration_s = total_duration_ms as f64 / 1000.0;
    println!("[timeline] Durée totale: {} ms ({:.3} s)", total_duration_ms, duration_s);
    println!("[perf] Préparation terminée en {:.0} ms", t0.elapsed().as_millis());
    
    let out_path = Path::new(&final_file_path);
    if let Some(parent) = out_path.parent() {
        println!("[fs] Création du dossier de sortie si besoin: {:?}", parent);
        fs::create_dir_all(parent).map_err(|e| format!("Erreur création dossier: {}", e))?;
    }
    
    let imgs_folder_resolved = folder.canonicalize()
        .map_err(|e| format!("Erreur résolution chemin: {}", e))?
        .to_string_lossy()
        .to_string();
    
    let out_path_str = out_path.to_string_lossy().to_string();
    let audios_vec = audios.unwrap_or_default();
    let videos_vec = videos.unwrap_or_default();
    let app_handle = app.clone();
    let export_id_clone = export_id.clone();
    
    task::spawn_blocking(move || {
        build_and_run_ffmpeg_filter_complex(
            &export_id_clone,
            &out_path_str,
            &path_strs,
            &ts,
            target_size,
            fps,
            fade_ms,
            start_time,
            &audios_vec,
            &videos_vec,
            should_prefer_hw_encoding(),
            Some(&imgs_folder_resolved),
            duration,
            chunk_index,
            blur,
            app_handle,
        )
    }).await
    .map_err(|e| format!("Erreur tâche: {}", e))?
    .map_err(|e| format!("Erreur ffmpeg: {}", e))?;
    
    let export_time_s = t0.elapsed().as_secs_f64();
    *LAST_EXPORT_TIME_S.lock().unwrap() = Some(export_time_s);
    println!("[done] Export terminé en {:.2}s", export_time_s);
    println!("[metric] export_time_seconds={:.3}", export_time_s);
    
    // Extraire le nom de fichier de sortie
    let output_file_name = Path::new(&final_file_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    
    // Préparer les données de completion
    let mut completion_data = serde_json::json!({
        "filename": output_file_name,
        "exportId": export_id,
        "fullPath": final_file_path
    });
    
    // Ajouter chunk_index si fourni
    if let Some(chunk_idx) = chunk_index {
        completion_data["chunkIndex"] = serde_json::Value::Number(serde_json::Number::from(chunk_idx));
    }
    
    // Émettre l'événement de succès
    let _ = app.emit("export-complete", completion_data);
    
    Ok(final_file_path)
}

// Fonctions utilitaires pour parser la progression FFmpeg
fn extract_time_from_ffmpeg_line(line: &str) -> Option<String> {
    // Chercher "time=" dans la ligne et extraire la valeur
    if let Some(start) = line.find("time=") {
        let start = start + 5; // Longueur de "time="
        if let Some(end) = line[start..].find(char::is_whitespace) {
            return Some(line[start..start + end].to_string());
        } else {
            // Si pas d'espace trouvé, prendre jusqu'à la fin
            return Some(line[start..].to_string());
        }
    }
    
    // Aussi chercher le format "out_time_ms=" pour -progress pipe
    if let Some(start) = line.find("out_time_ms=") {
        let start = start + 12; // Longueur de "out_time_ms="
        if let Some(end) = line[start..].find(char::is_whitespace) {
            if let Ok(ms) = line[start..start + end].parse::<i64>() {
                let seconds = ms as f64 / 1_000_000.0; // microseconds to seconds
                return Some(format!("{:.3}", seconds));
            }
        }
    }
    
    None
}

fn parse_ffmpeg_time(time_str: &str) -> f64 {
    // Si c'est déjà en secondes (format décimal)
    if let Ok(seconds) = time_str.parse::<f64>() {
        return seconds;
    }
    
    // Format FFmpeg : HH:MM:SS.mmm
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        if let (Ok(hours), Ok(minutes), Ok(seconds)) = 
            (parts[0].parse::<f64>(), parts[1].parse::<f64>(), parts[2].parse::<f64>()) {
            return hours * 3600.0 + minutes * 60.0 + seconds;
        }
    }
    0.0
}

#[tauri::command]
pub fn cancel_export(export_id: String) -> Result<String, String> {
    println!("[cancel_export] Demande d'annulation pour export_id: {}", export_id);
    
    let mut active_exports = ACTIVE_EXPORTS.lock().map_err(|_| "Failed to lock active exports")?;
    
    if let Some(process_ref) = active_exports.remove(&export_id) {
        if let Ok(mut process_guard) = process_ref.lock() {
            if let Some(mut child) = process_guard.take() {
                match child.kill() {
                    Ok(_) => {
                        println!("[cancel_export] Processus FFmpeg tué avec succès pour export_id: {}", export_id);
                        let _ = child.wait(); // Nettoyer le processus zombie
                        Ok(format!("Export {} annulé avec succès", export_id))
                    },
                    Err(e) => {
                        println!("[cancel_export] Erreur lors de l'arrêt du processus: {:?}", e);
                        Err(format!("Erreur lors de l'annulation: {}", e))
                    }
                }
            } else {
                println!("[cancel_export] Aucun processus actif trouvé pour export_id: {}", export_id);
                Err(format!("Aucun processus actif pour l'export {}", export_id))
            }
        } else {
            Err("Failed to lock process".to_string())
        }
    } else {
        println!("[cancel_export] Export_id non trouvé dans les exports actifs: {}", export_id);
        Err(format!("Export {} non trouvé ou déjà terminé", export_id))
    }
}

#[tauri::command]
pub async fn concat_videos(
    video_paths: Vec<String>,
    output_path: String,
) -> Result<String, String> {
    println!("[concat_videos] Début de la concaténation de {} vidéos", video_paths.len());
    println!("[concat_videos] Fichier de sortie: {}", output_path);
    
    if video_paths.is_empty() {
        return Err("Aucune vidéo fournie pour la concaténation".to_string());
    }
    
    if video_paths.len() == 1 {
        // Si une seule vidéo, on peut simplement la copier ou la renommer
        println!("[concat_videos] Une seule vidéo, copie vers le fichier final");
        std::fs::copy(&video_paths[0], &output_path)
            .map_err(|e| format!("Erreur lors de la copie: {}", e))?;
        return Ok(output_path);
    }
    
    // Créer le dossier de sortie si nécessaire
    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Erreur création dossier de sortie: {}", e))?;
    }
    
    // Créer un fichier de liste temporaire pour FFmpeg
    let temp_dir = std::env::temp_dir();
    let list_file_path = temp_dir.join(format!("concat_list_{}.txt", 
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()));
    
    // Écrire la liste des fichiers à concaténer
    let mut list_content = String::new();
    for video_path in &video_paths {
        // Vérifier que le fichier existe
        if !Path::new(video_path).exists() {
            return Err(format!("Fichier vidéo non trouvé: {}", video_path));
        }
        list_content.push_str(&format!("file '{}'\n", video_path));
    }
    
    fs::write(&list_file_path, list_content)
        .map_err(|e| format!("Erreur écriture fichier liste: {}", e))?;
    
    println!("[concat_videos] Fichier liste créé: {:?}", list_file_path);
    
    // Préparer la commande FFmpeg
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    
    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&[
        "-y",                           // Écraser le fichier de sortie
        "-hide_banner",                 // Masquer le banner FFmpeg
        "-loglevel", "info",            // Niveau de log
        "-fflags", "+genpts",           // Régénère les pts pour éviter les gaps
        "-f", "concat",                 // Format d'entrée concat
        "-safe", "0",                   // Permettre les chemins absolus
        "-i", &list_file_path.to_string_lossy(), // Fichier de liste
        "-avoid_negative_ts", "make_zero", // Normalise les timestamps
        "-map", "0:v",                  // Vidéo
        "-c:v", "copy",                 // Pas de ré-encodage vidéo
    ]);

    // Ré-encoder l'audio pour lisser les timestamps et éviter les micro-cuts
    if video_paths.iter().any(|p| video_has_audio(p)) {
        cmd.args(&[
            "-map", "0:a?",                          // Map audio si présent (sans échouer si absent)
            "-af", "aresample=async=1:first_pts=0",  // Corrige les horloges audio
            "-c:a", "aac",
            "-b:a", "192k",
        ]);
    } else {
        cmd.arg("-an"); // Aucun audio trouvé, on désactive l'audio
    }

    cmd.arg(&output_path);                  // Fichier de sortie
    
    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);
    
    println!("[concat_videos] Exécution de FFmpeg...");
    
    let output = cmd.output()
        .map_err(|e| format!("Erreur exécution FFmpeg: {}", e))?;
    
    // Nettoyer le fichier temporaire
    let _ = fs::remove_file(&list_file_path);
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        
        println!("[concat_videos] Erreur FFmpeg:");
        println!("STDOUT: {}", stdout);
        println!("STDERR: {}", stderr);
        
        return Err(format!(
            "FFmpeg a échoué lors de la concaténation (code: {:?})\nSTDERR: {}",
            output.status.code(),
            stderr
        ));
    }
    
    // Vérifier que le fichier de sortie a été créé
    if !Path::new(&output_path).exists() {
        return Err("Le fichier de sortie n'a pas été créé".to_string());
    }
    
    println!("[concat_videos] ✅ Concaténation réussie: {}", output_path);
    Ok(output_path)
}
