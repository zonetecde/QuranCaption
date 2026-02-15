use std::fs;
use std::path::Path;
use std::process::Command;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;

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
    let mut args: Vec<&str> = vec!["--force-ipv4"];
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
            "best[height<=1080][ext=mp4]/best[ext=mp4]/best",
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
                match fs::read_dir(&download_path_buf) {
                    Ok(entries) => {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.extension().is_some_and(|ext| ext == extension) {
                                return Ok(path.to_string_lossy().to_string());
                            }
                        }
                        Err("Downloaded file not found".to_string())
                    }
                    Err(e) => Err(format!("Error reading directory: {}", e)),
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
