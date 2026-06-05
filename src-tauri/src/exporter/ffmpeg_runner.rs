use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use super::constants;
use super::ffmpeg_utils::configure_command_no_window;
use super::memory;
use super::types::{
    FfmpegProgressContext, MemoryLimitExceededError, MemoryMonitorConfig, MemoryMonitorState,
};

// ---------------------------------------------------------------------------
// Gestion de l'annulation
// ---------------------------------------------------------------------------

/// Vérifie si l'export désigné par `export_id` a été marqué comme annulé.
pub fn is_export_cancelled(export_id: &str) -> bool {
    constants::CANCELLED_EXPORTS
        .lock()
        .map(|cancelled| cancelled.contains(export_id))
        .unwrap_or(false)
}

/// Marque un export comme annulé.
pub fn mark_export_cancelled(export_id: &str) {
    if let Ok(mut cancelled) = constants::CANCELLED_EXPORTS.lock() {
        cancelled.insert(export_id.to_string());
    }
}

/// Retire le marqueur d'annulation d'un export.
pub fn clear_export_cancelled(export_id: &str) {
    if let Ok(mut cancelled) = constants::CANCELLED_EXPORTS.lock() {
        cancelled.remove(export_id);
    }
}

// ---------------------------------------------------------------------------
// Vérification d'annulation en cours d'export
// ---------------------------------------------------------------------------

/// Lève une erreur si l'export a été annulé.
/// À appeler régulièrement dans les boucles longues pour permettre l'interruption.
pub fn ensure_export_not_cancelled(
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

// ---------------------------------------------------------------------------
// Émission de progression vers le frontend
// ---------------------------------------------------------------------------

/// Émet un événement `export-progress` vers l'interface Tauri.
pub fn emit_export_progress(
    app_handle: &tauri::AppHandle,
    export_id: &str,
    progress: f64,
    current_time_s: f64,
    total_time_s: f64,
    current_state: Option<&str>,
) {
    let progress_data = serde_json::json!({
        "export_id": export_id,
        "progress": progress,
        "current_time": current_time_s,
        "total_time": total_time_s,
        "current_state": current_state
    });

    let _ = app_handle.emit("export-progress", progress_data);
}

// ---------------------------------------------------------------------------
// Détails de statut de sortie
// ---------------------------------------------------------------------------

/// Retourne une description lisible du statut de sortie d'un processus.
/// Sur Unix, inclut le signal de terminaison s'il est disponible.
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

/// Indique si une ligne vient du flux machine `-progress` de FFmpeg.
///
/// # Parametres
/// * `line` - Ligne stderr emise par FFmpeg.
///
/// # Retourne
/// `true` si la ligne est une metrique de progression brute.
fn is_ffmpeg_progress_line(line: &str) -> bool {
    const PROGRESS_KEYS: &[&str] = &[
        "frame=",
        "fps=",
        "stream_",
        "bitrate=",
        "total_size=",
        "out_time_us=",
        "out_time_ms=",
        "out_time=",
        "dup_frames=",
        "drop_frames=",
        "speed=",
        "progress=",
    ];

    PROGRESS_KEYS.iter().any(|key| line.starts_with(key))
}

// ---------------------------------------------------------------------------
// Exécution principale de FFmpeg
// ---------------------------------------------------------------------------

/// Exécute une commande FFmpeg avec suivi de progression, surveillance mémoire,
/// journalisation des erreurs et gestion de l'annulation.
///
/// # Paramètres
/// * `export_id` - Identifiant unique de l'export (pour annulation et suivi).
/// * `cmd` - Commande FFmpeg complète (exécutable + arguments).
/// * `progress_context` - Contexte pour le calcul de la progression (optionnel).
/// * `progress_state` - Libellé de l'étape en cours (ex: "Processing Background").
/// * `memory_monitor` - Configuration du watcher RAM (optionnel).
/// * `app_handle` - Handle Tauri pour émettre les événements de progression.
pub fn run_ffmpeg_command(
    export_id: &str,
    cmd: &[String],
    progress_context: Option<FfmpegProgressContext>,
    progress_state: Option<&str>,
    memory_monitor: Option<MemoryMonitorConfig>,
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    ensure_export_not_cancelled(export_id)?;

    // Affichage de la commande (tronquée si trop longue)
    println!("[ffmpeg] Commande:");
    let preview = if cmd.len() > 14 {
        format!("{} ...", cmd[..14].join(" "))
    } else {
        cmd.join(" ")
    };
    println!("  {}", preview);

    // Construction et lancement du processus
    let mut command = Command::new(&cmd[0]);
    command.args(&cmd[1..]);
    command.stderr(Stdio::piped());

    configure_command_no_window(&mut command);

    let child = command.spawn()?;
    let process_ref = Arc::new(Mutex::new(Some(child)));
    {
        let mut active_exports = constants::ACTIVE_EXPORTS
            .lock()
            .map_err(|_| "Failed to lock active exports")?;
        active_exports.insert(export_id.to_string(), process_ref.clone());
    }

    // État mémoire partagé (utilisé même sans watcher pour éviter des branches)
    let memory_state = memory_monitor
        .as_ref()
        .and_then(|config| config.state.clone())
        .unwrap_or_else(|| {
            Arc::new(Mutex::new(MemoryMonitorState {
                exceeded: false,
                peak_percent: 0.0,
            }))
        });
    let memory_monitor_handle = memory_monitor.clone().map(|config| {
        memory::spawn_memory_monitor(process_ref.clone(), config, memory_state.clone())
    });

    // Capture de stderr
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

    // Lecture de stderr ligne par ligne + parsing progression
    for line in reader.lines() {
        if let Ok(line) = line {
            if !is_ffmpeg_progress_line(&line) {
                println!("[ffmpeg] {}", line);
            }

            stderr_content.push_str(&line);
            stderr_content.push('\n');

            if let Some(progress_context) = progress_context {
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

                    emit_export_progress(
                        app_handle,
                        export_id,
                        progress,
                        current_time_s,
                        progress_context.total_time_s,
                        progress_state,
                    );
                }
            }
        }
    }

    // Attendre la fin du processus
    let status = {
        let mut child_guard = process_ref
            .lock()
            .map_err(|_| "Failed to lock child process")?;
        if let Some(mut child) = child_guard.take() {
            child.wait()?
        } else {
            // Processus annulé avant la fin de stderr
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

    // Nettoyage des ressources
    {
        let mut active_exports = constants::ACTIVE_EXPORTS
            .lock()
            .map_err(|_| "Failed to lock active exports")?;
        active_exports.remove(export_id);
    }
    if let Some(handle) = memory_monitor_handle {
        let _ = handle.join();
    }

    // Vérifier si le moniteur mémoire a déclenché
    let (memory_exceeded, memory_peak_percent) = memory_state
        .lock()
        .map(|state| (state.exceeded, state.peak_percent))
        .unwrap_or((false, 0.0));
    if memory_exceeded {
        return Err(Box::new(MemoryLimitExceededError {
            peak_percent: memory_peak_percent,
            limit_percent: memory_monitor
                .as_ref()
                .map(|config| config.max_used_percent)
                .unwrap_or(constants::AUTO_MEMORY_LIMIT_PERCENT),
        }));
    }

    // Journalisation en cas d'échec
    if !status.success() {
        let suppress_error_event = progress_context
            .map(|context| context.suppress_error_event)
            .unwrap_or(false);
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

        if !suppress_error_event {
            let _ = app_handle.emit("export-error", error_data);
        }
        return Err(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            error_msg,
        )));
    }

    ensure_export_not_cancelled(export_id)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Parsing de la progression FFmpeg
// ---------------------------------------------------------------------------

/// Extrait la valeur `time=` ou `out_time_ms=` d'une ligne de sortie FFmpeg.
///
/// FFmpeg émet deux formats de progression :
/// - `time=HH:MM:SS.mmm` dans la sortie standard
/// - `out_time_ms=µs` via l'option `-progress pipe:2`
fn extract_time_from_ffmpeg_line(line: &str) -> Option<String> {
    // Format "time=HH:MM:SS.mmm"
    if let Some(start) = line.find("time=") {
        let start = start + 5;
        if let Some(end) = line[start..].find(char::is_whitespace) {
            return Some(line[start..start + end].to_string());
        } else {
            return Some(line[start..].to_string());
        }
    }

    // Format "out_time_ms=µs" (progress pipe, microsecondes)
    if let Some(start) = line.find("out_time_ms=") {
        let start = start + 12;
        if let Some(end) = line[start..].find(char::is_whitespace) {
            if let Ok(ms) = line[start..start + end].parse::<i64>() {
                let seconds = ms as f64 / 1_000_000.0;
                return Some(format!("{:.3}", seconds));
            }
        }
    }

    None
}

/// Parse une chaîne de temps FFmpeg (format `HH:MM:SS.mmm` ou secondes décimales).
fn parse_ffmpeg_time(time_str: &str) -> f64 {
    // Format décimal simple (secondes)
    if let Ok(seconds) = time_str.parse::<f64>() {
        return seconds;
    }

    // Format FFmpeg standard : HH:MM:SS.mmm
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
