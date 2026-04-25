use std::io::{BufRead, BufReader};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;
use tauri::Emitter;

/// Emet un evenement de progression du telechargement YouTube vers le frontend.
///
/// @param app_handle Gestionnaire Tauri utilise pour publier l'evenement.
/// @param download_request_id Identifiant de correlation du telechargement.
/// @param progress Pourcentage de progression entre 0 et 100.
/// @param status Etat textuel du telechargement courant.
fn emit_youtube_download_progress(
    app_handle: &tauri::AppHandle,
    download_request_id: &str,
    progress: f64,
    status: &str,
) {
    let payload = serde_json::json!({
        "downloadRequestId": download_request_id,
        "progress": progress,
        "status": status
    });

    let _ = app_handle.emit("youtube-download-progress", payload);
}

/// Emet un evenement d'erreur de telechargement YouTube vers le frontend.
///
/// @param app_handle Gestionnaire Tauri utilise pour publier l'evenement.
/// @param download_request_id Identifiant de correlation du telechargement.
/// @param error Message d'erreur a transmettre.
fn emit_youtube_download_error(
    app_handle: &tauri::AppHandle,
    download_request_id: &str,
    error: &str,
) {
    let payload = serde_json::json!({
        "downloadRequestId": download_request_id,
        "error": error
    });

    let _ = app_handle.emit("youtube-download-error", payload);
}

/// Extrait un pourcentage de progression depuis une ligne de sortie yt-dlp.
///
/// @param line Ligne brute lue depuis stderr.
/// @returns Le pourcentage trouve, ou `None` si la ligne ne contient pas d'avancement.
fn parse_ytdlp_progress_percent(line: &str) -> Option<f64> {
    let percent_index = line.find('%')?;
    let before_percent = line[..percent_index].trim_end();
    let number_start = before_percent
        .rfind(|c: char| !c.is_ascii_digit() && c != '.' && c != ',')
        .map(|idx| idx + 1)
        .unwrap_or(0);
    let percent_str = before_percent[number_start..].trim().replace(',', ".");

    if percent_str.is_empty() || percent_str.eq_ignore_ascii_case("n/a") {
        return None;
    }

    percent_str.parse::<f64>().ok()
}

fn find_latest_downloaded_file(download_path: &Path, extension: &str) -> Result<PathBuf, String> {
    let mut latest_path: Option<PathBuf> = None;
    let mut latest_modified = std::time::SystemTime::UNIX_EPOCH;

    let entries =
        fs::read_dir(download_path).map_err(|e| format!("Error reading directory: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let has_extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case(extension))
            .unwrap_or(false);
        if !has_extension {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if latest_path.is_none() || modified >= latest_modified {
            latest_modified = modified;
            latest_path = Some(path);
        }
    }

    latest_path.ok_or_else(|| "Downloaded file not found".to_string())
}

fn find_downloaded_file_by_suffix(
    download_path: &Path,
    extension: &str,
    file_suffix: &str,
) -> Result<PathBuf, String> {
    let entries =
        fs::read_dir(download_path).map_err(|e| format!("Error reading directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let has_extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case(extension))
            .unwrap_or(false);
        if !has_extension {
            continue;
        }

        let file_name_matches = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.contains(file_suffix))
            .unwrap_or(false);
        if !file_name_matches {
            continue;
        }

        return Ok(path);
    }

    Err("Downloaded file not found".to_string())
}

fn transcode_to_web_compatible_mp4(file_path: &Path, ffmpeg_path: &str) -> Result<(), String> {
    let file_stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("video");
    let temp_path = file_path.with_file_name(format!("{}_webview.mp4", file_stem));

    let file_path_str = file_path.to_string_lossy().to_string();
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args([
        "-y",
        "-i",
        &file_path_str,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        &temp_path_str,
    ]);
    configure_command_no_window(&mut cmd);

    match cmd.output() {
        Ok(result) if result.status.success() => {
            fs::remove_file(file_path)
                .map_err(|e| format!("Failed to remove original downloaded video: {}", e))?;
            fs::rename(&temp_path, file_path)
                .map_err(|e| format!("Failed to replace downloaded video: {}", e))?;
            Ok(())
        }
        Ok(result) => {
            let _ = fs::remove_file(&temp_path);
            Err(format!(
                "ffmpeg compatibility transcode failed: {}",
                String::from_utf8_lossy(&result.stderr)
            ))
        }
        Err(e) => {
            let _ = fs::remove_file(&temp_path);
            Err(format!(
                "Unable to execute ffmpeg for compatibility transcode: {}",
                e
            ))
        }
    }
}

/// Télécharge un média YouTube (audio MP3 ou vidéo MP4) via yt-dlp.
/// Lance un telechargement YouTube et emet sa progression si un identifiant est fourni.
///
/// @param url URL publique a telecharger.
/// @param _type Type de telechargement demande (`audio` ou `video`).
/// @param download_path Dossier de destination.
/// @param download_request_id Identifiant optionnel pour relayer la progression au frontend.
/// @param app_handle Gestionnaire Tauri utilise pour emettre les evenements.
#[tauri::command]
pub async fn download_from_youtube(
    url: String,
    _type: String,
    download_path: String,
    download_request_id: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let download_path_buf = path_utils::normalize_input_path(&download_path);
    let download_path_str = download_path_buf.to_string_lossy().to_string();
    if let Err(e) = fs::create_dir_all(&download_path_buf) {
        return Err(format!("Unable to create directory: {}", e));
    }

    let yt_dlp_path =
        binaries::resolve_binary("yt-dlp").ok_or_else(|| "yt-dlp binary not found".to_string())?;
    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let ffmpeg_dir = Path::new(&ffmpeg_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string());

    // Construction des arguments selon le type de téléchargement demandé.
    let mut args: Vec<&str> = vec![
        "--restrict-filenames",
        "--trim-filenames",
        "120",
        "--js-runtimes",
        "node",
        "--js-runtimes",
        "bun",
        "--js-runtimes",
        "deno",
        "--no-colors",
    ];
    let ffmpeg_dir_str;
    if let Some(dir) = ffmpeg_dir {
        ffmpeg_dir_str = dir;
        args.push("--ffmpeg-location");
        args.push(&ffmpeg_dir_str);
    }
    let download_request_id = download_request_id.unwrap_or_else(|| {
        format!(
            "req-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or(0)
        )
    });
    let output_pattern = format!(
        "{}/%(title)s (%(uploader)s){}.%(ext)s",
        download_path_str, download_request_id
    );

    match _type.as_str() {
        "audio" => args.extend_from_slice(&[
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--postprocessor-args",
            "ffmpeg:-b:a 320k -ar 44100",
            "--newline",
            "-o",
            &output_pattern,
        ]),
        "video" => args.extend_from_slice(&[
            "--format",
            "bv*+ba/b",
            "--merge-output-format",
            "mp4",
            "--newline",
            "-o",
            &output_pattern,
        ]),
        _ => return Err("Invalid type: must be 'audio' or 'video'".to_string()),
    }
    args.push(&url);

    let mut cmd = Command::new(&yt_dlp_path);
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    configure_command_no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Unable to execute yt-dlp: {}", e))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture yt-dlp stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture yt-dlp stderr".to_string())?;
    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stdout_buffer_clone = Arc::clone(&stdout_buffer);
    let stderr_buffer_clone = Arc::clone(&stderr_buffer);
    let app_handle_for_progress = app_handle.clone();
    let download_request_id_for_progress = download_request_id.clone();

    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stdout_buffer_clone.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }

            if let Some(progress) = parse_ytdlp_progress_percent(&line) {
                emit_youtube_download_progress(
                    &app_handle_for_progress,
                    &download_request_id_for_progress,
                    progress.clamp(0.0, 100.0),
                    "downloading",
                );
            }
        }
    });

    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stderr_buffer_clone.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
    });

    let status = child
        .wait()
        .map_err(|e| format!("Unable to wait for yt-dlp: {}", e))?;

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if status.success() {
        emit_youtube_download_progress(
            &app_handle,
            &download_request_id,
            100.0,
            "finished",
        );

        let output_str = stdout_buffer
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default();
        if !output_str.trim().is_empty() {
            println!("yt-dlp output: {}", output_str);
        }

        let extension = if _type == "audio" { "mp3" } else { "mp4" };
        match find_downloaded_file_by_suffix(&download_path_buf, extension, &download_request_id)
            .or_else(|_| find_latest_downloaded_file(&download_path_buf, extension))
        {
            Ok(path) => {
                if _type == "video" {
                    // Je commente cette ligne car au final ça sert à rien
                    // transcode_to_web_compatible_mp4(&path, &ffmpeg_path)?;
                }
                Ok(path.to_string_lossy().to_string())
            }
            Err(error) => Err(error),
        }
    } else {
        let stderr = stderr_buffer
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default();
        let stdout = stdout_buffer
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default();
        let error = format!("yt-dlp error: {}\n{}", stderr, stdout);
        emit_youtube_download_error(&app_handle, &download_request_id, &error);
        Err(error)
    }
}
