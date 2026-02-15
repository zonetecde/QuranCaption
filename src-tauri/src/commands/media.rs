use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use font_kit::source::SystemSource;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;

use super::diagnostics::{format_ffprobe_exec_failed, map_ffprobe_resolve_error};

/// Retourne la durée d'un média en millisecondes via ffprobe.
#[tauri::command]
pub fn get_duration(file_path: &str) -> Result<i64, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    if !file_path.exists() {
        return Ok(-1);
    }

    let ffprobe_path = match binaries::resolve_binary_detailed("ffprobe") {
        Ok(p) => p,
        Err(err) => return Err(map_ffprobe_resolve_error(err)),
    };

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                let duration_line = output_str.trim();
                if let Ok(duration_seconds) = duration_line.parse::<f64>() {
                    Ok((duration_seconds * 1000.0).round() as i64)
                } else {
                    Err("Unable to parse duration from ffprobe output".to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format_ffprobe_exec_failed(&stderr))
            }
        }
        Err(e) => Err(format_ffprobe_exec_failed(&format!(
            "Unable to execute ffprobe: {}",
            e
        ))),
    }
}

/// Retourne la liste des polices système disponibles (noms de familles uniques).
#[tauri::command]
pub fn get_system_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let fonts = source.all_fonts().map_err(|e| e.to_string())?;
    let mut font_names = Vec::new();
    let mut seen_names = HashSet::new();

    for font in fonts {
        let handle = font.load().map_err(|e| e.to_string())?;
        let family = handle.family_name();
        if seen_names.insert(family.clone()) {
            font_names.push(family);
        }
    }

    font_names.sort();
    Ok(font_names)
}

/// Ouvre l'explorateur de fichiers en sélectionnant le fichier donné.
#[tauri::command]
pub fn open_explorer_with_file_selected(file_path: String) -> Result<(), String> {
    let path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = path.to_string_lossy().to_string();
    if !path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    // Branchements OS pour ouvrir le gestionnaire de fichiers natif.
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        cmd.args(["/select,", &file_path_str]);
        configure_command_no_window(&mut cmd);
        return cmd
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to execute explorer command: {}", e));
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open").args(["-R", &file_path_str]).output();
        return match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else if let Some(parent) = path.parent() {
                    let fallback_output = Command::new("open").arg(parent).output();
                    match fallback_output {
                        Ok(fallback_result) if fallback_result.status.success() => Ok(()),
                        Ok(_) => Err("Failed to open Finder".to_string()),
                        Err(e) => Err(format!("Failed to execute open command: {}", e)),
                    }
                } else {
                    Err("Failed to open Finder and no parent directory found".to_string())
                }
            }
            Err(e) => Err(format!("Failed to execute open command: {}", e)),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let file_managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja"];
        let parent_dir = path.parent().ok_or("No parent directory found")?;

        for manager in &file_managers {
            if Command::new(manager)
                .arg(parent_dir)
                .output()
                .map(|result| result.status.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }

        let output = Command::new("xdg-open").arg(parent_dir).output();
        return match output {
            Ok(result) if result.status.success() => Ok(()),
            Ok(_) => Err("Failed to open file manager".to_string()),
            Err(e) => Err(format!("Failed to execute xdg-open command: {}", e)),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported operating system".to_string())
    }
}

/// Retourne les dimensions vidéo (width/height) du premier stream vidéo.
#[tauri::command]
pub fn get_video_dimensions(file_path: &str) -> Result<serde_json::Value, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    let ffprobe_path =
        binaries::resolve_binary_detailed("ffprobe").map_err(map_ffprobe_resolve_error)?;
    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "v:0",
        &file_path_str,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                let json_value: serde_json::Value = serde_json::from_str(&output_str)
                    .map_err(|e| format!("Failed to parse ffprobe JSON output: {}", e))?;
                if let Some(stream) = json_value.get("streams").and_then(|s| s.get(0)) {
                    let width = stream.get("width").and_then(|w| w.as_i64()).unwrap_or(0);
                    let height = stream.get("height").and_then(|h| h.as_i64()).unwrap_or(0);
                    Ok(serde_json::json!({ "width": width, "height": height }))
                } else {
                    Err("No video stream found in file".to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format_ffprobe_exec_failed(&stderr))
            }
        }
        Err(e) => Err(format_ffprobe_exec_failed(&format!(
            "Unable to execute ffprobe: {}",
            e
        ))),
    }
}

/// Coupe une portion audio sans ré-encodage (copie de flux).
#[tauri::command]
pub fn cut_audio(
    source_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<(), String> {
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;
    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-ss",
        &start_secs.to_string(),
        "-t",
        &duration_secs.to_string(),
        "-i",
        &source_path,
        "-c",
        "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&result.stderr)
        )),
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

/// Coupe une portion vidéo sans ré-encodage (copie de flux).
#[tauri::command]
pub fn cut_video(
    source_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<(), String> {
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;
    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-ss",
        &start_secs.to_string(),
        "-t",
        &duration_secs.to_string(),
        "-i",
        &source_path,
        "-map",
        "0",
        "-c",
        "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&result.stderr)
        )),
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

/// Concatène plusieurs fichiers audio à l'aide du demuxer concat de ffmpeg.
#[tauri::command]
pub fn concat_audio(source_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if source_paths.is_empty() {
        return Err("No source files provided".to_string());
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let temp_dir = std::env::temp_dir();
    let list_file_path = temp_dir.join(format!(
        "concat_audio_{}.txt",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    ));

    let mut list_content = String::new();
    for path in &source_paths {
        let escaped_path = path.replace("'", "'\\''");
        list_content.push_str(&format!("file '{}'\n", escaped_path));
    }
    fs::write(&list_file_path, list_content)
        .map_err(|e| format!("Failed to write concat list: {}", e))?;

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        &list_file_path.to_string_lossy(),
        "-c",
        "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();
    let _ = fs::remove_file(&list_file_path);

    match output {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&result.stderr)
        )),
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

/// Convertit un média en débit constant (CBR) en remplaçant le fichier original.
#[tauri::command]
pub fn convert_audio_to_cbr(file_path: String) -> Result<(), String> {
    let file_path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4");
    let file_stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("temp");
    let temp_path = if let Some(parent_dir) = file_path.parent() {
        parent_dir.join(format!("{}_temp.{}", file_stem, extension))
    } else {
        PathBuf::from(format!("{}_temp.{}", file_stem, extension))
    };

    // Paramètres ffmpeg distincts pour flux audio pur vs conteneur vidéo.
    let mut cmd = Command::new(&ffmpeg_path);
    let is_audio_only = matches!(
        extension.to_lowercase().as_str(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a"
    );
    if is_audio_only {
        cmd.args([
            "-i",
            &file_path_str,
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-cbr",
            "1",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-f",
            "mp3",
            "-y",
            temp_path.to_string_lossy().as_ref(),
        ]);
    } else {
        cmd.args([
            "-i",
            &file_path_str,
            "-b:v",
            "1200k",
            "-minrate",
            "1200k",
            "-maxrate",
            "1200k",
            "-bufsize",
            "1200k",
            "-b:a",
            "64k",
            "-vcodec",
            "libx264",
            "-acodec",
            "aac",
            "-strict",
            "-2",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-s",
            "320x240",
            "-y",
            temp_path.to_string_lossy().as_ref(),
        ]);
    }
    configure_command_no_window(&mut cmd);

    match cmd.output() {
        Ok(result) => {
            if result.status.success() {
                if let Err(e) = std::fs::remove_file(&file_path) {
                    return Err(format!("Failed to remove original file: {}", e));
                }
                if let Err(e) = std::fs::rename(&temp_path, &file_path) {
                    return Err(format!("Failed to replace original file: {}", e));
                }
                Ok(())
            } else {
                let _ = std::fs::remove_file(&temp_path);
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(format!("Unable to execute ffmpeg: {}", e))
        }
    }
}
