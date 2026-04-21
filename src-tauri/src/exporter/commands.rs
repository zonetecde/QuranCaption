use crate::binaries;
use crate::path_utils;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;
use tokio::task;

// Expose la dernière durée d'export terminée (en secondes)
static LAST_EXPORT_TIME_S: Mutex<Option<f64>> = Mutex::new(None);

// Gestionnaire des processus actifs pour pouvoir les annuler
static ACTIVE_EXPORTS: LazyLock<Mutex<HashMap<String, Arc<Mutex<Option<std::process::Child>>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static CANCELLED_EXPORTS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

const MAX_FILTERGRAPH_IMAGES_HIGH_RES: usize = 6;
const MAX_FILTERGRAPH_IMAGES_STANDARD: usize = 12;
const DEFAULT_FILTERGRAPH_BATCH_SIZE: usize = 16;

#[derive(Clone, Copy)]
struct FfmpegProgressContext {
    base_time_s: f64,
    total_time_s: f64,
    local_duration_s: f64,
}

fn is_export_cancelled(export_id: &str) -> bool {
    CANCELLED_EXPORTS
        .lock()
        .map(|cancelled| cancelled.contains(export_id))
        .unwrap_or(false)
}

fn mark_export_cancelled(export_id: &str) {
    if let Ok(mut cancelled) = CANCELLED_EXPORTS.lock() {
        cancelled.insert(export_id.to_string());
    }
}

fn clear_export_cancelled(export_id: &str) {
    if let Ok(mut cancelled) = CANCELLED_EXPORTS.lock() {
        cancelled.remove(export_id);
    }
}

fn exit_status_details(status: &ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        let mut details = format!("Exit Code: {:?}", status.code());
        if let Some(signal) = status.signal() {
            details.push_str(&format!("\n             Termination Signal: {}", signal));
            if signal == 9 {
                details.push_str(
                    " (SIGKILL; process was likely killed by the OS, often memory pressure/OOM)",
                );
            }
        }

        details
    }

    #[cfg(not(unix))]
    {
        format!("Exit Code: {:?}", status.code())
    }
}

fn ensure_export_not_cancelled(
    export_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    if is_export_cancelled(export_id) {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            format!("Export {} was cancelled", export_id),
        )));
    }

    Ok(())
}

fn run_ffmpeg_command(
    export_id: &str,
    cmd: &[String],
    progress_context: Option<FfmpegProgressContext>,
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    ensure_export_not_cancelled(export_id)?;

    println!("[ffmpeg] Commande:");
    let preview = if cmd.len() > 14 {
        format!("{} ...", cmd[..14].join(" "))
    } else {
        cmd.join(" ")
    };
    println!("  {}", preview);

    let mut command = Command::new(&cmd[0]);
    command.args(&cmd[1..]);
    command.stderr(Stdio::piped());

    configure_command_no_window(&mut command);

    let child = command.spawn()?;
    let process_ref = Arc::new(Mutex::new(Some(child)));
    {
        let mut active_exports = ACTIVE_EXPORTS
            .lock()
            .map_err(|_| "Failed to lock active exports")?;
        active_exports.insert(export_id.to_string(), process_ref.clone());
    }

    let stderr = {
        let mut child_guard = process_ref
            .lock()
            .map_err(|_| "Failed to lock child process")?;
        if let Some(ref mut child) = child_guard.as_mut() {
            child.stderr.take().ok_or("Failed to capture stderr")?
        } else {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Process was cancelled",
            )));
        }
    };

    let reader = BufReader::new(stderr);
    let mut stderr_content = String::new();

    for line in reader.lines() {
        if let Ok(line) = line {
            println!("[ffmpeg] {}", line);

            stderr_content.push_str(&line);
            stderr_content.push('\n');

            if let Some(progress_context) = progress_context {
                if line.contains("time=") || line.contains("out_time_ms=") {
                    if let Some(time_str) = extract_time_from_ffmpeg_line(&line) {
                        let local_time_s =
                            parse_ffmpeg_time(&time_str).min(progress_context.local_duration_s);
                        let current_time_s = (progress_context.base_time_s + local_time_s)
                            .min(progress_context.total_time_s);
                        let progress = if progress_context.total_time_s > 0.0 {
                            (current_time_s / progress_context.total_time_s * 100.0).min(100.0)
                        } else {
                            0.0
                        };

                        println!(
                            "[progress] {}% ({:.1}s / {:.1}s)",
                            progress.round(),
                            current_time_s,
                            progress_context.total_time_s
                        );

                        let progress_data = serde_json::json!({
                            "export_id": export_id,
                            "progress": progress,
                            "current_time": current_time_s,
                            "total_time": progress_context.total_time_s
                        });

                        let _ = app_handle.emit("export-progress", progress_data);
                    }
                }
            }
        }
    }

    let status = {
        let mut child_guard = process_ref
            .lock()
            .map_err(|_| "Failed to lock child process")?;
        if let Some(mut child) = child_guard.take() {
            child.wait()?
        } else {
            let error_msg = format!("Export {} was cancelled", export_id);
            let error_data = serde_json::json!({
                "export_id": export_id,
                "error": error_msg
            });

            let _ = app_handle.emit("export-error", error_data);
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                error_msg,
            )));
        }
    };

    {
        let mut active_exports = ACTIVE_EXPORTS
            .lock()
            .map_err(|_| "Failed to lock active exports")?;
        active_exports.remove(export_id);
    }

    if !status.success() {
        let now = std::time::SystemTime::now();
        let timestamp = now
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let log_filename = format!("ffmpeg_failed_{}.txt", timestamp);
        let log_relative_path = PathBuf::from("logs").join(&log_filename);
        let status_details = exit_status_details(&status);

        let log_content = format!(
            "FFmpeg Export Failure Log\n\
             =========================\n\
             Timestamp: {}\n\
             Export ID: {}\n\
             {}\n\
             \n\
             FFmpeg Command:\n\
             {}\n\
             \n\
             Standard Error Output:\n\
             {}\n",
            timestamp,
            export_id,
            status_details,
            cmd.join(" "),
            if stderr_content.is_empty() {
                "No stderr output captured".to_string()
            } else {
                stderr_content
            }
        );

        let log_write_path = app_handle
            .path()
            .app_data_dir()
            .map(|dir| dir.join(&log_relative_path))
            .unwrap_or_else(|_| PathBuf::from(&log_filename));
        let log_write_path_display = log_write_path.to_string_lossy().replace('\\', "/");

        if let Some(parent) = log_write_path.parent() {
            if let Err(mkdir_err) = fs::create_dir_all(parent) {
                eprintln!("Failed to create log directory {:?}: {}", parent, mkdir_err);
            }
        }

        if let Err(log_err) = std::fs::write(&log_write_path, &log_content) {
            eprintln!("Failed to write log file {:?}: {}", log_write_path, log_err);
        } else {
            println!("FFmpeg error details saved to: {}", log_write_path_display);
        }

        let error_msg = format!(
            "ffmpeg failed during video exportation ({})\n\nSee the log file: {}\n\nLog details:\n{}",
            status_details,
            log_write_path_display,
            log_content
        );
        let error_data = serde_json::json!({
            "export_id": export_id,
            "error": error_msg
        });

        let _ = app_handle.emit("export-error", error_data);
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            error_msg,
        )));
    }

    ensure_export_not_cancelled(export_id)?;

    Ok(())
}

// Fonction utilitaire pour configurer les commandes et cacher les fenêtres CMD sur Windows
/// Fonction du module export.
fn configure_command_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Construit un chemin temporaire dans le même dossier que la destination finale.
/// Le fichier conserve la même extension pour laisser FFmpeg choisir le bon conteneur.
fn build_temp_output_path(dst: &Path) -> PathBuf {
    let stem = dst
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("preproc");
    let ext = dst.extension().and_then(|s| s.to_str()).unwrap_or("mp4");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let filename = format!("{}-tmp-{}-{}.{}", stem, std::process::id(), nonce, ext);
    dst.with_file_name(filename)
}

/// Remplace la destination finale par le fichier temporaire généré.
fn replace_preproc_file(tmp: &Path, dst: &Path) -> std::io::Result<()> {
    if dst.exists() {
        fs::remove_file(dst).ok();
    }
    fs::rename(tmp, dst)
}

/// Vérifie qu'une vidéo de cache est lisible et respecte une durée minimale attendue.
fn is_cached_video_valid(path: &Path, min_duration_s: f64) -> bool {
    let metadata = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return false,
    };

    if metadata.len() < 2048 {
        return false;
    }

    let path_str = path.to_string_lossy();
    let duration = ffprobe_duration_sec(path_str.as_ref());
    if !duration.is_finite() || duration <= 0.0 {
        return false;
    }

    let tolerance_s = 0.15;
    duration + tolerance_s >= min_duration_s.max(0.0)
}

/// Fonction du module export.
fn resolve_ffmpeg_binary() -> Option<String> {
    if let Some(path) = binaries::resolve_binary("ffmpeg") {
        return Some(path);
    }

    // En dernier recours, utiliser ffmpeg du PATH système
    println!("[ffmpeg] Tentative d'utilisation de ffmpeg du système (PATH)");
    if let Ok(_) = std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
    {
        println!("[ffmpeg] ✓ FFmpeg trouvé dans le PATH système");
        return Some("ffmpeg".to_string());
    }

    // Aucun binaire FFmpeg trouvé
    None
}

/// Fonction du module export.
fn resolve_ffprobe_binary() -> String {
    if let Some(path) = binaries::resolve_binary("ffprobe") {
        return path;
    }

    // En dernier recours, utiliser ffprobe du PATH système
    println!("[ffprobe] Tentative d'utilisation de ffprobe du système (PATH)");
    if let Ok(_) = std::process::Command::new("ffprobe")
        .arg("-version")
        .output()
    {
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
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=128x128:r=1:d=0.04", // Résolution minimum NVENC, très courte
        "-c:v",
        "h264_nvenc",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-frames:v",
        "1",
        "-f",
        "null", // Sortie nulle pour éviter d'écrire un fichier
        "-",
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

                if stderr_lower.contains("cannot load nvcuda.dll")
                    || stderr_lower.contains("no nvidia devices")
                    || stderr_lower.contains("cuda")
                    || stderr_lower.contains("driver")
                {
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

/// Fonction du module export.
fn test_nvenc_with_larger_resolution(ffmpeg_path: Option<&str>) -> bool {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");

    let mut cmd = Command::new(exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=1:d=0.04", // Résolution encore plus grande
        "-c:v",
        "h264_nvenc",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
    ]);

    configure_command_no_window(&mut cmd);

    match cmd.output() {
        Ok(output) => {
            let success = output.status.success();
            if success {
                println!("[nvenc_test] ✓ NVENC disponible avec résolution 256x256");
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!(
                    "[nvenc_test] ✗ NVENC toujours non disponible: {}",
                    stderr.trim()
                );
            }
            success
        }
        Err(e) => {
            println!("[nvenc_test] ✗ Erreur test résolution plus grande: {}", e);
            false
        }
    }
}

/// Fonction du module export.
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

#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ExportPerformanceProfile {
    Fastest,
    Balanced,
    LowCpu,
}

fn compute_ffmpeg_thread_cap(profile: ExportPerformanceProfile) -> Option<usize> {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    match profile {
        ExportPerformanceProfile::Fastest => None,
        ExportPerformanceProfile::Balanced => Some((((cores * 3) + 3) / 4).max(2)),
        ExportPerformanceProfile::LowCpu => Some(cores.div_ceil(2).max(1)),
    }
}

fn append_thread_cap(cmd: &mut Command, profile: ExportPerformanceProfile) {
    if let Some(thread_cap) = compute_ffmpeg_thread_cap(profile) {
        cmd.arg("-threads").arg(thread_cap.to_string());
    }
}

/// Fonction du module export.
fn is_high_resolution_export(width: i32, height: i32) -> bool {
    width >= 2560 || height >= 1440
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CodecUsage {
    Intermediate,
    Final,
}

/// Fonction du module export.
fn choose_best_codec(
    prefer_hw: bool,
    width: i32,
    height: i32,
    usage: CodecUsage,
) -> (String, Vec<String>, HashMap<String, Option<String>>) {
    let high_resolution = is_high_resolution_export(width, height);

    if high_resolution {
        println!(
            "[codec] Export haute résolution détecté ({}x{}), forçage libx264 haute qualité",
            width, height
        );

        let codec = "libx264".to_string();
        let mut extra = HashMap::new();
        let (preset, crf) = match usage {
            CodecUsage::Intermediate => ("slow", "14"),
            CodecUsage::Final => ("slow", "16"),
        };
        extra.insert("preset".to_string(), Some(preset.to_string()));

        return (
            codec,
            vec![
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-crf".to_string(),
                crf.to_string(),
            ],
            extra,
        );
    }

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
                let params = vec!["-pix_fmt".to_string(), "yuv420p".to_string()];
                let mut extra = HashMap::new();
                extra.insert("preset".to_string(), Some("fast".to_string()));
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
    let mut extra = HashMap::new();
    let params = {
        extra.insert("preset".to_string(), Some("ultrafast".to_string()));
        vec![
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-crf".to_string(),
            "22".to_string(),
            "-tune".to_string(),
            "zerolatency".to_string(),
            "-bf".to_string(),
            "0".to_string(),
        ]
    };

    (codec, params, extra)
}

/// Fonction du module export.
fn ffmpeg_preprocess_video(
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
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let (codec, params, extra) = choose_best_codec(prefer_hw, w, h, CodecUsage::Intermediate);
    let exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let dst_path = Path::new(dst);
    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = build_temp_output_path(dst_path);
    let tmp_output = tmp_path.to_string_lossy().to_string();

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

    // Si le bouclage est activé, l'ajouter avant l'entrée
    if loop_video {
        cmd.arg("-stream_loop").arg("-1");
    }

    // Si un offset de début est fourni, l'ajouter avant -i pour seek rapide
    if let Some(sms) = start_ms {
        let s = format!("{:.3}", (sms as f64) / 1000.0);
        cmd.arg("-ss").arg(s);
    }

    cmd.arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(src);

    // Si une durée de découpe est fournie, la limiter
    if let Some(dms) = duration_ms {
        let d = format!("{:.3}", (dms as f64) / 1000.0);
        cmd.arg("-t").arg(d);
    }

    append_thread_cap(&mut cmd, performance_profile);

    cmd.arg("-an")
        .arg("-vf")
        .arg(&vf)
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:v")
        .arg(&codec);

    if let Some(Some(preset)) = extra.get("preset") {
        cmd.arg("-preset").arg(preset);
    }

    for param in params {
        cmd.arg(param);
    }

    cmd.arg(&tmp_output);

    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);

    println!(
        "[preproc] ffmpeg scale+pad (contain) -> {}",
        Path::new(dst)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    );

    let status = cmd.status()?;
    if !status.success() {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "FFmpeg preprocessing failed",
        )));
    }

    let expected_duration_s = duration_ms
        .map(|ms| ms as f64 / 1000.0)
        .unwrap_or(0.001)
        .max(0.001);
    if !is_cached_video_valid(&tmp_path, expected_duration_s) {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "FFmpeg preprocessing produced an invalid output file",
        )));
    }

    replace_preproc_file(&tmp_path, dst_path)?;

    Ok(())
}

/// Fonction du module export.
fn create_video_from_image(
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
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let dst_path = Path::new(output_path);
    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = build_temp_output_path(dst_path);
    let tmp_output = tmp_path.to_string_lossy().to_string();

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
    let (codec, codec_params, codec_extra) =
        choose_best_codec(prefer_hw, w, h, CodecUsage::Intermediate);

    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "info",
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

    append_thread_cap(&mut cmd, performance_profile);

    // Ajouter le preset si disponible
    if let Some(Some(preset)) = codec_extra.get("preset") {
        cmd.arg("-preset").arg(preset);
    }

    // Ajouter les paramètres du codec
    for param in codec_params {
        cmd.arg(param);
    }

    // Ajouter des paramètres de qualité selon le codec
    if codec.contains("nvenc") {
        cmd.args(&["-cq", "23"]);
    }

    cmd.arg(&tmp_output);

    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);

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

    if !is_cached_video_valid(&tmp_path, duration_s.max(0.001)) {
        fs::remove_file(&tmp_path).ok();
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            "FFmpeg image-to-video produced an invalid output file",
        )));
    }

    replace_preproc_file(&tmp_path, dst_path)?;

    Ok(())
}

/// Fonction du module export.
fn is_image_file(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    path_lower.ends_with(".jpg")
        || path_lower.ends_with(".jpeg")
        || path_lower.ends_with(".png")
        || path_lower.ends_with(".bmp")
        || path_lower.ends_with(".gif")
        || path_lower.ends_with(".webp")
        || path_lower.ends_with(".tiff")
        || path_lower.ends_with(".tif")
}

/// Fonction du module export.
fn preprocess_background_videos(
    video_inputs: &[VideoInput],
    w: i32,
    h: i32,
    fps: i32,
    prefer_hw: bool,
    start_time_ms: i32,
    duration_ms: Option<i32>,
    blur: Option<f64>,
    performance_profile: ExportPerformanceProfile,
) -> Vec<String> {
    let mut out_paths = Vec::new();
    let cache_dir = std::env::temp_dir().join("qurancaption-preproc");
    let preproc_cache_version = "fit-v7";
    fs::create_dir_all(&cache_dir).ok();

    // Cas spécial : une seule image
    if video_inputs.len() == 1 && is_image_file(&video_inputs[0].path) {
        let image_path = &video_inputs[0].path;
        let duration_s = if let Some(dur_ms) = duration_ms {
            dur_ms as f64 / 1000.0
        } else {
            30.0 // Durée par défaut si non spécifiée
        };

        // Construire un nom de cache unique pour l'image
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

        let must_regenerate = !is_cached_video_valid(&dst, expected_duration_s);
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
        return out_paths;
    }

    // Calculer les durées (ms) de chaque vidéo
    let mut video_durations_ms: Vec<i64> = Vec::new();
    for input in video_inputs {
        let d = (ffprobe_duration_sec(&input.path) * 1000.0).round() as i64;
        video_durations_ms.push(d);
    }

    // Limite de la plage demandée
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

        // Si le bouclage est activé, la vidéo peut couvrir tout le reste de la plage
        if is_loop {
            vid_len = limit_ms;
        }

        let cum_end = cum_start + vid_len;

        // Si la vidéo se termine avant le début recherché, on l'ignore complètement
        if !is_loop && cum_end <= start_time_ms as i64 {
            cum_start = cum_end;
            continue;
        }

        // Si on a déjà dépassé la limite demandée, on arrête
        let elapsed_so_far = cum_start - (start_time_ms as i64);
        if elapsed_so_far >= limit_ms {
            break;
        }

        // Déterminer le début à l'intérieur de cette vidéo
        let mut start_within = if start_time_ms as i64 > cum_start {
            start_time_ms as i64 - cum_start
        } else {
            0
        };

        // Pour un clip loopé, on replie l'offset dans la durée réelle du média.
        // Cela permet d'exporter correctement un segment long avec répétitions
        // (y compris la dernière itération partielle) sans retomber sur du pad noir.
        if is_loop && real_vid_len > 0 {
            start_within %= real_vid_len;
        }

        // Durée restante à prendre dans cette vidéo
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
            continue;
        }

        // Construire un nom de cache unique qui inclut les offsets, le blur et le flag loop
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

        let must_regenerate = !is_cached_video_valid(&dst, expected_duration_s);
        if must_regenerate {
            if dst.exists() {
                println!(
                    "[preproc][cache] Fichier invalide détecté, régénération: {}",
                    dst.display()
                );
                fs::remove_file(&dst).ok();
            }
            // Appeler ffmpeg_preprocess_video avec les offsets locaux et le flag loop
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
            ) {
                Ok(_) => {}
                Err(e) => {
                    println!("[preproc][ERREUR] {:?}", e);
                    // En cas d'échec, utiliser la vidéo originale
                    out_paths.push(vid_path.clone());
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

/// Fonction du module export.
fn ffprobe_duration_sec(path: &str) -> f64 {
    let exe = resolve_ffprobe_binary();

    let mut cmd = Command::new(&exe);
    cmd.args(&[
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
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

/// Fonction du module export.
fn video_has_audio(path: &str) -> bool {
    let exe = resolve_ffprobe_binary();

    let output = Command::new(&exe)
        .args(&[
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            path,
        ])
        .output();

    match output {
        Ok(out) => !out.stdout.is_empty(),
        Err(_) => false,
    }
}

fn normalize_filtergraph_batch_size(batch_size: Option<i32>) -> usize {
    let requested = batch_size.unwrap_or(DEFAULT_FILTERGRAPH_BATCH_SIZE as i32);
    requested.clamp(2, 64) as usize
}

fn filtergraph_batch_limit(target_size: (i32, i32), batch_size: Option<i32>) -> usize {
    if let Some(batch_size) = batch_size {
        return normalize_filtergraph_batch_size(Some(batch_size));
    }

    if is_high_resolution_export(target_size.0, target_size.1) {
        MAX_FILTERGRAPH_IMAGES_HIGH_RES
    } else {
        MAX_FILTERGRAPH_IMAGES_STANDARD
    }
}

fn make_internal_batch_path(base_dir: &Path, export_id: &str, batch_index: usize) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    base_dir.join(format!(
        "internal_batch_{}_{}_{}.mp4",
        export_id, batch_index, nonce
    ))
}

fn transition_fade_duration_ms(timestamps_ms: &[i32], fade_duration_ms: i32) -> i32 {
    if timestamps_ms.len() < 2 {
        return 0;
    }

    let last = timestamps_ms.len() - 1;
    (timestamps_ms[last] - timestamps_ms[last - 1])
        .max(0)
        .min(fade_duration_ms.max(0))
}

fn compute_render_output_duration_ms(
    local_timestamps_ms: &[i32],
    fade_duration_ms: i32,
    last_tail_ms: i32,
) -> i32 {
    if local_timestamps_ms.is_empty() {
        return 1;
    }

    let fade_duration_ms = fade_duration_ms.max(0);
    let mut total = last_tail_ms.max(1);

    for pair in local_timestamps_ms.windows(2) {
        let delta = (pair[1] - pair[0]).max(1);
        total += delta - delta.min(fade_duration_ms);
    }

    total.max(1)
}

#[allow(clippy::too_many_arguments)]
fn concat_internal_batch_videos(
    export_id: &str,
    batch_paths: &[String],
    output_path: &str,
    total_duration_s: f64,
    start_time_ms: i32,
    audio_paths: &[String],
    video_fade_in_enabled: bool,
    video_fade_out_enabled: bool,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    performance_profile: ExportPerformanceProfile,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    if batch_paths.is_empty() {
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Aucune vidéo de batch à concaténer",
        )));
    }

    ensure_export_not_cancelled(export_id)?;

    let apply_video_fade = video_fade_in_enabled || video_fade_out_enabled;
    let apply_audio_fade = audio_fade_in_enabled || audio_fade_out_enabled;
    let apply_any_fade = apply_video_fade || apply_audio_fade;
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);
    let total_audio_s: f64 = audio_paths.iter().map(|p| ffprobe_duration_sec(p)).sum();
    let have_audio = !audio_paths.is_empty() && start_s < total_audio_s - 1e-6;

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

    let base_dir = output_path_buf
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let list_file_path = base_dir.join(format!(
        "internal_batch_concat_{}_{}.txt",
        export_id,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));

    let mut list_content = String::new();
    for batch_path in batch_paths {
        let escaped = path_utils::escape_ffconcat_path(batch_path);
        list_content.push_str(&format!("file '{}'\n", escaped));
    }
    fs::write(&list_file_path, list_content)?;

    let fade_s = (export_fade_duration_ms as f64 / 1000.0)
        .max(0.0)
        .min(total_duration_s.max(0.0));
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let mut cmd = vec![
        ffmpeg_exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "info".to_string(),
        "-stats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        list_file_path.to_string_lossy().to_string(),
    ];

    for audio_path in audio_paths {
        cmd.extend_from_slice(&["-i".to_string(), audio_path.clone()]);
    }

    cmd.extend_from_slice(&[
        "-avoid_negative_ts".to_string(),
        "make_zero".to_string(),
        "-map".to_string(),
        "0:v".to_string(),
    ]);

    if apply_video_fade && fade_s > 0.0 {
        let mut video_filters: Vec<String> = Vec::new();
        if video_fade_in_enabled {
            video_filters.push(format!("fade=t=in:st=0:d={:.6}", fade_s));
        }
        if video_fade_out_enabled {
            let fade_out_start = (total_duration_s - fade_s).max(0.0);
            video_filters.push(format!(
                "fade=t=out:st={:.6}:d={:.6}",
                fade_out_start, fade_s
            ));
        }
        if !video_filters.is_empty() {
            cmd.extend_from_slice(&["-vf".to_string(), video_filters.join(",")]);
        }
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
    } else {
        cmd.extend_from_slice(&["-c:v".to_string(), "copy".to_string()]);
    }

    if let Some(thread_cap) = compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }

    if have_audio {
        let mut filter_lines: Vec<String> = Vec::new();
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

        cmd.extend_from_slice(&["-filter_complex".to_string(), filter_lines.join(";")]);
        cmd.extend_from_slice(&[
            "-map".to_string(),
            format!("[{}]", current_audio_label),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
        ]);
    } else {
        cmd.push("-an".to_string());
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

    let run_result = run_ffmpeg_command(export_id, &cmd, None, &app_handle);
    fs::remove_file(&list_file_path).ok();
    run_result
}

#[allow(clippy::too_many_arguments)]
/// Fonction du module export.
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
    batch_size: Option<i32>,
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
    let batch_limit = filtergraph_batch_limit(target_size, batch_size);

    if n <= batch_limit {
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
            video_inputs,
            prefer_hw,
            imgs_cwd,
            duration_ms,
            blur,
            video_fade_in_enabled,
            video_fade_out_enabled,
            audio_fade_in_enabled,
            audio_fade_out_enabled,
            export_fade_duration_ms,
            performance_profile,
            0.0,
            full_duration_s,
            app_handle,
        );
    }

    println!(
        "[batching] {} image(s), limite {}, rendu interne en batchs",
        n, batch_limit
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

    let mut batch_paths: Vec<String> = Vec::new();
    let mut batch_start_idx = 0usize;
    let mut batch_index = 0usize;
    let mut batch_base_ms = 0i32;
    let mut batch_start_completed_fade_ms = 0i32;

    while batch_start_idx < n {
        ensure_export_not_cancelled(export_id)?;

        let batch_end_idx = (batch_start_idx + batch_limit).min(n);
        let is_last_batch = batch_end_idx >= n;
        let batch_start_adjusted_ts = timestamps_ms[batch_start_idx];
        let batch_slice = &timestamps_ms[batch_start_idx..batch_end_idx];
        let boundary_fade_ms = if is_last_batch {
            0
        } else {
            transition_fade_duration_ms(batch_slice, fade_duration_ms)
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
        let mut batch_duration_ms = compute_render_output_duration_ms(
            &batch_timestamps,
            fade_duration_ms,
            last_tail_ms,
        )
        .saturating_add(boundary_fade_ms);
        batch_duration_ms = batch_duration_ms.min((full_duration_ms - batch_base_ms).max(1));
        let batch_output_path = make_internal_batch_path(&base_dir, export_id, batch_index);
        let batch_output = batch_output_path.to_string_lossy().to_string();

        println!(
            "[batching] batch {}: images {}..{} adjusted_start={}ms real_start={}ms start_fade={}ms end_fade={}ms tail={}ms duration={}ms output={}",
            batch_index,
            batch_start_idx,
            batch_end_idx - 1,
            batch_start_adjusted_ts,
            batch_base_ms,
            batch_start_completed_fade_ms,
            boundary_fade_ms,
            last_tail_ms,
            batch_duration_ms,
            batch_output
        );

        render_ffmpeg_filter_complex_single(
            export_id,
            &batch_output,
            &image_paths[batch_start_idx..batch_end_idx],
            &batch_timestamps,
            target_size,
            fps,
            fade_duration_ms,
            start_time_ms + batch_base_ms,
            &[],
            video_inputs,
            prefer_hw,
            imgs_cwd,
            Some(batch_duration_ms),
            blur,
            false,
            false,
            false,
            false,
            0,
            performance_profile,
            batch_base_ms as f64 / 1000.0,
            full_duration_s,
            app_handle.clone(),
        )?;

        batch_paths.push(batch_output);

        if is_last_batch {
            break;
        }

        batch_base_ms += batch_duration_ms;
        batch_start_completed_fade_ms = boundary_fade_ms;
        batch_start_idx = batch_end_idx - 1;
        batch_index += 1;
    }

    concat_internal_batch_videos(
        export_id,
        &batch_paths,
        out_path,
        full_duration_s,
        start_time_ms,
        audio_paths,
        video_fade_in_enabled,
        video_fade_out_enabled,
        audio_fade_in_enabled,
        audio_fade_out_enabled,
        export_fade_duration_ms,
        performance_profile,
        app_handle,
    )?;

    println!(
        "[batching] Keeping {} internal batch file(s) for debugging",
        batch_paths.len()
    );

    Ok(())
}

#[allow(clippy::too_many_arguments)]
/// Fonction du module export.
fn render_ffmpeg_filter_complex_single(
    export_id: &str,
    out_path: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
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
    performance_profile: ExportPerformanceProfile,
    progress_base_s: f64,
    progress_total_s: f64,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    // TEMP TEST: force FFmpeg failure on every export to test error handling UI.
    const FORCE_EXPORT_CRASH_FOR_TEST: bool = false;

    let (w, h) = target_size;
    let fade_s = (fade_duration_ms as f64 / 1000.0).max(0.0);
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);

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
    let duration_s = if let Some(dur_ms) = duration_ms {
        dur_ms as f64 / 1000.0
    } else {
        total_by_ts
    };
    let export_fade_s = (export_fade_duration_ms as f64 / 1000.0)
        .max(0.0)
        .min(duration_s.max(0.0));

    let mut starts_s = Vec::new();
    let mut acc = 0.0;
    for &d in &durations_s {
        starts_s.push(acc);
        acc += d;
    }

    let (vcodec, vparams, vextra) = choose_best_codec(prefer_hw, w, h, CodecUsage::Final);

    let mut pre_videos = Vec::new();
    if !video_inputs.is_empty() {
        pre_videos = preprocess_background_videos(
            video_inputs,
            w,
            h,
            fps,
            prefer_hw,
            start_time_ms,
            duration_ms,
            blur,
            performance_profile,
        );
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
        let escaped = path_utils::escape_ffconcat_path(p);
        writeln!(concat_file, "file '{}'", escaped)?;
        writeln!(concat_file, "duration {:.6}", durations_s[i])?;
    }
    let escaped_last = path_utils::escape_ffconcat_path(&image_paths[n - 1]);
    writeln!(concat_file, "file '{}'", escaped_last)?;

    println!("[concat] Fichier ffconcat -> {:?}", concat_path);

    let mut cmd = Vec::new();
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    cmd.extend_from_slice(&[
        ffmpeg_exe.clone(),
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "info".to_string(),
        "-stats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
    ]);

    // Entrée unique: concat demuxer
    let concat_name = concat_path.to_string_lossy().to_string();

    cmd.extend_from_slice(&[
        "-safe".to_string(),
        "0".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-i".to_string(),
        concat_name,
    ]);
    if let Some(thread_cap) = compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }
    let mut current_idx = 1;

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
        "[0:v]format=rgba,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps={},setpts=PTS-STARTPTS,setsar=1,format=rgba,split={}{}",
        w, h, w, h, fps, n, split_outputs
    ));

    // Pour chaque segment, extraire la fenêtre temporelle et prémultiplier le RGB par l'alpha.
    for i in 0..n {
        let s = starts_s[i];
        let e = s + durations_s[i];
        filter_lines.push(format!(
            "[b{}]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS,fps={},format=rgba,premultiply=inplace=1[s{}p]",
            i, s, e, fps, i
        ));
    }

    // Chaine xfade pour overlay RGBA prémultiplié.
    let mut curr_p = "s0p".to_string();
    let mut curr_duration = durations_s[0];

    for i in 0..(n - 1) {
        let fade_i = durations_s[i].min(fade_s);
        if fade_i <= 1e-6 {
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

    // Conserver l'overlay prémultiplié jusqu'à la superposition finale.
    filter_lines.push(format!("[{}]format=yuva444p[overlay]", curr_p));

    // Construction de la vidéo de fond [bg]
    let avail_bg_after = total_bg_s;
    let need_black_full = pre_videos.is_empty() || avail_bg_after <= 1e-6;

    let bg_label = if need_black_full {
        let color_full_idx = current_idx;
        cmd.extend_from_slice(&[
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            format!("color=c=black:s={}x{}:r={}:d={:.6}", w, h, fps, duration_s),
        ]);
        format!("{}:v", color_full_idx)
    } else {
        let prev = if pre_videos.len() > 1 {
            let mut ins = String::new();
            for i in 0..pre_videos.len() {
                ins.push_str(&format!("[{}:v]", bg_start_idx + i));
            }
            filter_lines.push(format!(
                "{}concat=n={}:v=1:a=0[bgcat]",
                ins,
                pre_videos.len()
            ));
            "bgcat".to_string()
        } else {
            format!("{}:v", bg_start_idx)
        };

        filter_lines.push(format!(
            "[{}]setpts=PTS-STARTPTS,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[bgtrim]",
            prev, w, h, w, h
        ));
        let mut bg_label = "bgtrim".to_string();

        if avail_bg_after + 1e-6 < duration_s {
            let remain = duration_s - avail_bg_after;
            // Évite un flash noir à la fin des batchs quand la durée réelle du fond
            // est légèrement plus courte que la durée demandée: on prolonge la dernière
            // frame du fond au lieu de concaténer du noir.
            filter_lines.push(format!(
                "[bgtrim]tpad=stop_mode=clone:stop_duration={:.6}[bg]",
                remain
            ));
            bg_label = "bg".to_string();
        }

        bg_label
    };

    // Superposition de l'overlay (avec alpha) sur le fond
    filter_lines.push(format!("[{}]setsar=1[bg_normalized]", bg_label));
    filter_lines.push(format!(
        "[bg_normalized][overlay]overlay=shortest=1:x=0:y=0:alpha=premultiplied,format=yuv420p[vout]"
    ));

    let mut mapped_video_label = "vout".to_string();
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

    // Audio: concat, skip start_s, clamp à duration_s
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

    let fg_name = fg_path.to_string_lossy().to_string();

    cmd.extend_from_slice(&["-filter_complex_script".to_string(), fg_name]);

    // Mapping
    cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", mapped_video_label)]);
    if have_audio {
        let audio_label = mapped_audio_label.unwrap_or_else(|| "aoutraw".to_string());
        cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", audio_label)]);
    }

    // Codec vidéo + audio
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

    if have_audio {
        cmd.extend_from_slice(&[
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
        ]);
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
    if FORCE_EXPORT_CRASH_FOR_TEST {
        // Unknown option -> FFmpeg exits with error, which triggers the existing failure/log pipeline.
        cmd.extend_from_slice(&[
            "-qurancaption_force_export_crash".to_string(),
            "1".to_string(),
        ]);
    }

    cmd.push(out_path.to_string());

    run_ffmpeg_command(
        export_id,
        &cmd,
        Some(FfmpegProgressContext {
            base_time_s: progress_base_s,
            total_time_s: progress_total_s,
            local_duration_s: duration_s,
        }),
        &app_handle,
    )
}

#[derive(serde::Deserialize, Debug)]
pub struct VideoInput {
    pub path: String,
    pub loop_until_audio_end: Option<bool>,
}

#[tauri::command]
/// Fonction du module export.
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
    batch_size: Option<i32>,
    performance_profile: ExportPerformanceProfile,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let t0 = Instant::now();
    clear_export_cancelled(&export_id);

    // Logs init
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
        "[env] CPU cores: {:?}",
        std::thread::available_parallelism().map(|n| n.get())
    );
    println!("[perf] profile={:?}", performance_profile);
    println!(
        "[perf] thread_cap={:?}",
        compute_ffmpeg_thread_cap(performance_profile)
    );
    println!(
        "[perf] batch_size={}",
        normalize_filtergraph_batch_size(batch_size)
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

    // Liste des PNG triés par timestamp
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
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let ts_preview: Vec<i32> = ts.iter().take(10).cloned().collect();
    println!(
        "[timeline] Premiers timestamps: {:?}{}",
        ts_preview,
        if ts.len() > 10 { " ..." } else { "" }
    );
    println!("[timeline] Nombre d'images: {}", ts.len());

    // Taille cible = taille de 0.png
    println!("[image] Ouverture de la première image pour taille cible...");
    let target_size = {
        let img_data = fs::read(&files[0]).map_err(|e| format!("Erreur lecture image: {}", e))?;
        let img = image::load_from_memory(&img_data)
            .map_err(|e| format!("Erreur décodage image: {}", e))?;
        // Forcer des dimensions paires pour la compatibilité YUV420P
        ((img.width() as i32 / 2) * 2, (img.height() as i32 / 2) * 2)
    };

    println!("[image] Taille cible: {}x{}", target_size.0, target_size.1);

    // Durée totale
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
    let mut videos_vec = videos.unwrap_or_default();
    for v in &mut videos_vec {
        v.path = path_utils::normalize_existing_path(&v.path)
            .to_string_lossy()
            .to_string();
    }
    let app_handle = app.clone();
    let export_id_clone = export_id.clone();

    task::spawn_blocking(move || {
        build_and_run_ffmpeg_filter_complex(
            &export_id_clone,
            &out_path_str_for_task,
            &path_strs,
            &ts,
            target_size,
            fps,
            fade_ms,
            start_time,
            &audios_vec,
            &videos_vec, // Now it's Vec<VideoInput>
            true,
            Some(&imgs_folder_resolved),
            duration,
            blur,
            video_fade_in_enabled.unwrap_or(false),
            video_fade_out_enabled.unwrap_or(false),
            audio_fade_in_enabled.unwrap_or(false),
            audio_fade_out_enabled.unwrap_or(false),
            export_fade_duration_ms.unwrap_or(0),
            batch_size,
            performance_profile,
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("Erreur tâche: {}", e))?
    .map_err(|e| format!("Erreur ffmpeg: {}", e))?;

    let export_time_s = t0.elapsed().as_secs_f64();
    *LAST_EXPORT_TIME_S.lock().unwrap() = Some(export_time_s);
    clear_export_cancelled(&export_id);
    println!("[done] Export terminé en {:.2}s", export_time_s);
    println!("[metric] export_time_seconds={:.3}", export_time_s);

    // Extraire le nom de fichier de sortie
    let output_file_name = out_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Préparer les données de completion
    let completion_data = serde_json::json!({
        "filename": output_file_name,
        "exportId": export_id,
        "fullPath": out_path_str
    });

    // Émettre l'événement de succès
    let _ = app.emit("export-complete", completion_data);

    Ok(out_path_str)
}

// Fonctions utilitaires pour parser la progression FFmpeg
/// Fonction du module export.
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

/// Fonction du module export.
fn parse_ffmpeg_time(time_str: &str) -> f64 {
    // Si c'est déjà en secondes (format décimal)
    if let Ok(seconds) = time_str.parse::<f64>() {
        return seconds;
    }

    // Format FFmpeg : HH:MM:SS.mmm
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        if let (Ok(hours), Ok(minutes), Ok(seconds)) = (
            parts[0].parse::<f64>(),
            parts[1].parse::<f64>(),
            parts[2].parse::<f64>(),
        ) {
            return hours * 3600.0 + minutes * 60.0 + seconds;
        }
    }
    0.0
}

#[tauri::command]
/// Fonction du module export.
pub fn cancel_export(export_id: String) -> Result<String, String> {
    println!(
        "[cancel_export] Demande d'annulation pour export_id: {}",
        export_id
    );
    mark_export_cancelled(&export_id);

    let mut active_exports = ACTIVE_EXPORTS
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

#[tauri::command]
/// Fonction du module export.
pub async fn concat_videos(
    video_paths: Vec<String>,
    output_path: String,
    video_fade_in_enabled: Option<bool>,
    video_fade_out_enabled: Option<bool>,
    audio_fade_in_enabled: Option<bool>,
    audio_fade_out_enabled: Option<bool>,
    export_fade_duration_ms: Option<i32>,
    performance_profile: ExportPerformanceProfile,
) -> Result<String, String> {
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

    let apply_video_fade =
        video_fade_in_enabled.unwrap_or(false) || video_fade_out_enabled.unwrap_or(false);
    let apply_audio_fade =
        audio_fade_in_enabled.unwrap_or(false) || audio_fade_out_enabled.unwrap_or(false);
    let apply_any_fade = apply_video_fade || apply_audio_fade;
    let total_duration_s: f64 = normalized_video_paths
        .iter()
        .map(|p| ffprobe_duration_sec(p))
        .sum();
    let fade_s = (export_fade_duration_ms.unwrap_or(0) as f64 / 1000.0)
        .max(0.0)
        .min(total_duration_s.max(0.0));

    if normalized_video_paths.is_empty() {
        return Err("Aucune vidéo fournie pour la concaténation".to_string());
    }

    if normalized_video_paths.len() == 1 && !apply_any_fade {
        // Si une seule vidéo, on peut simplement la copier ou la renommer
        println!("[concat_videos] Une seule vidéo, copie vers le fichier final");
        std::fs::copy(&normalized_video_paths[0], &output_path_str)
            .map_err(|e| format!("Erreur lors de la copie: {}", e))?;
        return Ok(output_path_str);
    }

    // Créer le dossier de sortie si nécessaire
    if let Some(parent) = output_path_buf.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Erreur création dossier de sortie: {}", e))?;
    }

    // Créer un fichier de liste temporaire pour FFmpeg
    let temp_dir = std::env::temp_dir();
    let list_file_path = temp_dir.join(format!(
        "concat_list_{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    ));

    // Écrire la liste des fichiers à concaténer
    let mut list_content = String::new();
    for video_path in &normalized_video_paths {
        // Vérifier que le fichier existe
        if !Path::new(video_path).exists() {
            return Err(format!("Fichier vidéo non trouvé: {}", video_path));
        }
        let escaped = path_utils::escape_ffconcat_path(video_path);
        list_content.push_str(&format!("file '{}'\n", escaped));
    }

    fs::write(&list_file_path, list_content)
        .map_err(|e| format!("Erreur écriture fichier liste: {}", e))?;

    println!("[concat_videos] Fichier liste créé: {:?}", list_file_path);

    // Préparer la commande FFmpeg
    let ffmpeg_exe = resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());

    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&[
        "-y",           // Écraser le fichier de sortie
        "-hide_banner", // Masquer le banner FFmpeg
        "-loglevel",
        "info", // Niveau de log
        "-fflags",
        "+genpts", // Régénère les pts pour éviter les gaps
        "-f",
        "concat", // Format d'entrée concat
        "-safe",
        "0", // Permettre les chemins absolus
        "-i",
        &list_file_path.to_string_lossy(), // Fichier de liste
        "-avoid_negative_ts",
        "make_zero", // Normalise les timestamps
        "-map",
        "0:v", // Vidéo
    ]);

    append_thread_cap(&mut cmd, performance_profile);

    let mut video_filters: Vec<String> = vec!["setpts=PTS-STARTPTS".to_string()];
    if apply_video_fade && fade_s > 0.0 {
        if video_fade_in_enabled.unwrap_or(false) {
            video_filters.push(format!("fade=t=in:st=0:d={:.6}", fade_s));
        }
        if video_fade_out_enabled.unwrap_or(false) {
            let fade_out_start = (total_duration_s - fade_s).max(0.0);
            video_filters.push(format!(
                "fade=t=out:st={:.6}:d={:.6}",
                fade_out_start, fade_s
            ));
        }
    }
    cmd.args(&["-vf", &video_filters.join(",")]);
    cmd.args(&[
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    ]);

    // Ré-encoder l'audio pour lisser les timestamps et éviter les micro-cuts
    let has_audio_stream = normalized_video_paths.iter().any(|p| video_has_audio(p));
    if has_audio_stream {
        cmd.args(&[
            "-map",
            "0:a?", // Map audio si présent (sans échouer si absent)
            "-af",
            "aresample=async=1:first_pts=0", // Corrige les horloges audio
            "-c:a",
            "aac",
            "-b:a",
            "192k",
        ]);
    } else {
        cmd.arg("-an"); // Aucun audio trouvé, on désactive l'audio
    }

    if has_audio_stream && apply_audio_fade && fade_s > 0.0 {
        let mut audio_filters: Vec<String> = vec!["aresample=async=1:first_pts=0".to_string()];
        if audio_fade_in_enabled.unwrap_or(false) {
            audio_filters.push(format!("afade=t=in:st=0:d={:.6}", fade_s));
        }
        if audio_fade_out_enabled.unwrap_or(false) {
            let fade_out_start = (total_duration_s - fade_s).max(0.0);
            audio_filters.push(format!(
                "afade=t=out:st={:.6}:d={:.6}",
                fade_out_start, fade_s
            ));
        }
        cmd.args(&["-af", &audio_filters.join(",")]);
    }

    cmd.arg(&output_path_str); // Fichier de sortie

    // Configurer la commande pour cacher les fenêtres CMD sur Windows
    configure_command_no_window(&mut cmd);

    println!("[concat_videos] Exécution de FFmpeg...");

    let output = cmd
        .output()
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
    if !Path::new(&output_path_str).exists() {
        return Err("Le fichier de sortie n'a pas été créé".to_string());
    }

    println!(
        "[concat_videos] ✅ Concaténation réussie: {}",
        output_path_str
    );
    Ok(output_path_str)
}
