use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;

fn find_latest_downloaded_file(
    download_path: &Path,
    extension: &str,
) -> Result<PathBuf, String> {
    let mut latest_path: Option<PathBuf> = None;
    let mut latest_modified = std::time::SystemTime::UNIX_EPOCH;

    let entries = fs::read_dir(download_path).map_err(|e| format!("Error reading directory: {}", e))?;
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
            Err(format!("Unable to execute ffmpeg for compatibility transcode: {}", e))
        }
    }
}

/// Télécharge un média YouTube (audio MP3 ou vidéo MP4) via yt-dlp.
#[tauri::command]
pub async fn download_from_youtube(
    url: String,
    _type: String,
    download_path: String,
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
        "--force-ipv4",
        "--restrict-filenames",
        "--trim-filenames",
        "120",
    ];
    let ffmpeg_dir_str;
    if let Some(dir) = ffmpeg_dir {
        ffmpeg_dir_str = dir;
        args.push("--ffmpeg-location");
        args.push(&ffmpeg_dir_str);
    }
    let output_pattern = format!("{}/%(title)s (%(uploader)s).%(ext)s", download_path_str);

    match _type.as_str() {
        "audio" => args.extend_from_slice(&[
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--postprocessor-args",
            "ffmpeg:-b:a 320k -ar 44100",
            "-o",
            &output_pattern,
        ]),
        "video" => args.extend_from_slice(&[
            "--format",
            "bv*[height<=1080][ext=mp4][vcodec~='^(avc1|h264)']+ba[ext=m4a]/b[height<=1080][ext=mp4][vcodec~='^(avc1|h264)']/best[height<=1080][ext=mp4]/best[ext=mp4]/best",
            "--merge-output-format",
            "mp4",
            "--postprocessor-args",
            "ffmpeg:-b:v 2000k -maxrate 2000k -bufsize 4000k -b:a 128k",
            "-o",
            &output_pattern,
        ]),
        _ => return Err("Invalid type: must be 'audio' or 'video'".to_string()),
    }
    args.push(&url);

    let mut cmd = Command::new(&yt_dlp_path);
    cmd.args(&args);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                println!("yt-dlp output: {}", output_str);

                let extension = if _type == "audio" { "mp3" } else { "mp4" };
                match find_latest_downloaded_file(&download_path_buf, extension) {
                    Ok(path) => {
                        if _type == "video" {
                            transcode_to_web_compatible_mp4(&path, &ffmpeg_path)?;
                        }
                        Ok(path.to_string_lossy().to_string())
                    }
                    Err(error) => Err(error),
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let stdout = String::from_utf8_lossy(&result.stdout);
                Err(format!("yt-dlp error: {}\n{}", stderr, stdout))
            }
        }
        Err(e) => Err(format!("Unable to execute yt-dlp: {}", e)),
    }
}
