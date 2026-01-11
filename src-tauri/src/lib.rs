use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
mod exporter;
mod binaries;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use reqwest::multipart::{Form, Part};
use tauri::Manager;

use font_kit::source::SystemSource;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Stockage global des process IDs d'export en cours
lazy_static::lazy_static! {
    static ref EXPORT_PROCESS_IDS: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));
    static ref DISCORD_CLIENT: Arc<Mutex<Option<DiscordIpcClient>>> = Arc::new(Mutex::new(None));
}

// Structure pour les paramètres Discord Rich Presence
#[derive(serde::Deserialize)]
struct DiscordActivity {
    details: Option<String>,
    state: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    party_size: Option<u32>,
    party_max: Option<u32>,
    start_timestamp: Option<i64>,
}

const FFPROBE_NOT_FOUND_ERROR: &str = "FFPROBE_NOT_FOUND";
const QURAN_SEGMENTATION_UPLOAD_URL: &str =
    "https://hetchyy-quran-segmentation-transcription.hf.space/gradio_api/upload";
const QURAN_SEGMENTATION_QUEUE_JOIN_URL: &str =
    "https://hetchyy-quran-segmentation-transcription.hf.space/gradio_api/queue/join";
const QURAN_SEGMENTATION_QUEUE_DATA_URL: &str =
    "https://hetchyy-quran-segmentation-transcription.hf.space/gradio_api/queue/data";
// Hard-coded index for /process_audio_json in the current Space config.
const QURAN_SEGMENTATION_FN_INDEX: u32 = 5;
const QURAN_SEGMENTATION_USE_MOCK: bool = false;
const QURAN_SEGMENTATION_MOCK_PAYLOAD: &str = r#"
{
    "segments": [
        {
        "confidence": 0.5,
        "error": null,
        "matched_text": "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
        "ref_from": "Isti'adha",
        "ref_to": "Isti'adha",
        "segment": 1,
        "time_from": 0.63,
        "time_to": 6.11
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
        "ref_from": "Basmala",
        "ref_to": "Basmala",
        "segment": 2,
        "time_from": 7.99,
        "time_to": 13.53
    },
    {
        "confidence": 0.75,
        "error": null,
        "matched_text": "قُلْ هُوَ ٱللَّهُ أَحَدٌ",
        "ref_from": "112:1:1",
        "ref_to": "112:1:4",
        "segment": 3,
        "time_from": 15.15,
        "time_to": 18.05
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "ٱللَّهُ ٱلصَّمَدُ",
        "ref_from": "112:2:1",
        "ref_to": "112:2:2",
        "segment": 4,
        "time_from": 19.47,
        "time_to": 21.965
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "لَمْ يَلِدْ وَلَمْ يُولَدْ",
        "ref_from": "112:3:1",
        "ref_to": "112:3:4",
        "segment": 5,
        "time_from": 23.185,
        "time_to": 26.665
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدُۢ",
        "ref_from": "112:4:1",
        "ref_to": "112:4:5",
        "segment": 6,
        "time_from": 27.945,
        "time_to": 32.665
    }
    ]
}
"#;

// Simple guard to remove temp files even if we early-return on error.
struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn configure_command_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

#[tauri::command]
async fn download_from_youtube(
    url: String,
    _type: String,
    download_path: String,
) -> Result<String, String> {
    // Créer le dossier de téléchargement s'il n'existe pas
    if let Err(e) = fs::create_dir_all(&download_path) {
        return Err(format!("Unable to create directory: {}", e));
    }

    let yt_dlp_path = binaries::resolve_binary("yt-dlp")
        .ok_or_else(|| "yt-dlp binary not found".to_string())?;

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    let ffmpeg_dir = Path::new(&ffmpeg_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string());

    // Configuration selon le type (audio ou vidéo)
    let mut args: Vec<&str> = vec!["--force-ipv4"];
    
    // Ajouter le chemin vers le dossier contenant ffmpeg et ffprobe
    // Créer une variable statique pour garder la valeur en mémoire
    let ffmpeg_dir_str;
    if let Some(dir) = ffmpeg_dir {
        ffmpeg_dir_str = dir;
        args.push("--ffmpeg-location");
        args.push(&ffmpeg_dir_str);
    }

    // Pattern de sortie avec le titre de la vidéo et le nom de la chaîne
    let output_pattern = format!("{}/%(title)s (%(uploader)s).%(ext)s", download_path);

    match _type.as_str() {
        "audio" => {
            // Pour l'audio : qualité maximale, format MP3, bitrate constant
            args.extend_from_slice(&[
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0", // Qualité maximale
                "--postprocessor-args",
                "ffmpeg:-b:a 320k -ar 44100", // Bitrate constant 320k
                "-o",
                &output_pattern,
            ]);
        }
        "video" => {
            // Pour la vidéo : 1080p ou moins, format MP4, bitrate constant
            args.extend_from_slice(&[
                "--format",
                "best[height<=1080][ext=mp4]/best[ext=mp4]/best",
                "--merge-output-format",
                "mp4",
                "--postprocessor-args",
                "ffmpeg:-b:v 2000k -maxrate 2000k -bufsize 4000k -b:a 128k",
                "-o",
                &output_pattern,
            ]);
        }
        _ => {
            return Err("Invalid type: must be 'audio' or 'video'".to_string());
        }
    }

    // Ajouter l'URL à la fin
    args.push(&url);

    // Exécuter yt-dlp
    let mut cmd = Command::new(&yt_dlp_path);
    cmd.args(&args);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                println!("yt-dlp output: {}", output_str);

                // Chercher le fichier téléchargé dans le dossier
                let extension = if _type == "audio" { "mp3" } else { "mp4" };

                // Lire le dossier pour trouver le fichier téléchargé
                match fs::read_dir(&download_path) {
                    Ok(entries) => {
                        for entry in entries {
                            if let Ok(entry) = entry {
                                let path = entry.path();
                                if let Some(ext) = path.extension() {
                                    if ext == extension {
                                        if let Some(_filename) = path.file_name() {
                                            let file_path = path.to_string_lossy().to_string();

                                            return Ok(file_path);
                                        }
                                    }
                                }
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

// Fonction pour obtenir la durée précise du fichier téléchargé avec ffprobe
#[tauri::command]
fn get_duration(file_path: &str) -> Result<i64, String> {
    // If the file does not exist, return -1
    if !std::path::Path::new(file_path).exists() {
        return Ok(-1);
    }

    let ffprobe_path = match binaries::resolve_binary("ffprobe") {
        Some(p) => p,
        None => return Err(FFPROBE_NOT_FOUND_ERROR.to_string()),
    };

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args(&[
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file_path,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                let duration_line = output_str.trim();

                if let Ok(duration_seconds) = duration_line.parse::<f64>() {
                    // Convertir en millisecondes avec précision
                    Ok((duration_seconds * 1000.0).round() as i64)
                } else {
                    Err("Unable to parse duration from ffprobe output".to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffprobe error: {}", stderr))
            }
        }
        Err(e) => Err(format!("Unable to execute ffprobe: {}", e)),
    }
}

#[tauri::command]
fn get_new_file_path(start_time: u64, asset_name: &str) -> Result<String, String> {
    // get download directory folder (on windows, macos and linux)
    let download_path = dirs::download_dir()
        .ok_or_else(|| "Unable to determine download directory".to_string())?
        .to_string_lossy()
        .to_string();

    // Search for a file whose creation date is > start_time
    let entries = fs::read_dir(&download_path)
        .map_err(|e| format!("Unable to read download directory: {}", e))?;

    for entry in entries {
        if let Ok(entry) = entry {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(created) = metadata.created() {
                    let created_time = created
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|_| "Time went backwards")?
                        .as_millis() as u64;

                    // If the creation date is greater than start_time, check the file name
                    if created_time > start_time {
                        let file_path = entry.path();
                        if let Some(file_name) = file_path.file_name() {
                            let file_name_str = file_name.to_string_lossy();
                            let asset_name_trimmed = asset_name.trim();

                            // Check if the file name contains the asset name
                            if file_name_str.contains(asset_name_trimmed) {
                                return Ok(file_path.to_string_lossy().to_string());
                            } else {
                                return Ok(file_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    Err("Downloaded file not found".to_string())
}


#[tauri::command]
fn save_binary_file(path: String, content: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
async fn download_file(url: String, path: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
fn move_file(source: String, destination: String) -> Result<(), String> {
    use std::path::Path;
    
    let source_path = Path::new(&source);
    let dest_path = Path::new(&destination);
    
    // If destination exists, remove it first to force the move
    if dest_path.exists() {
        std::fs::remove_file(&destination).map_err(|e| e.to_string())?;
    }
    
    // Try rename first (works if on same drive/filesystem)
    match std::fs::rename(&source, &destination) {
        Ok(()) => Ok(()),
        Err(e) => {
            // If rename fails with cross-device error (Windows: 17, Unix: 18), do copy + delete
            if e.raw_os_error() == Some(17) || e.raw_os_error() == Some(18) {
                // Copy the file
                std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
                // Remove the original
                std::fs::remove_file(&source).map_err(|e| e.to_string())?;
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

#[tauri::command]
fn get_system_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let fonts = source.all_fonts().map_err(|e| e.to_string())?;
    let mut font_names = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    for font in fonts {
        // Load the font to get its properties
        let handle = font.load().map_err(|e| e.to_string())?;
        let family = handle.family_name();
        
        // Only add the font name if we haven't seen it before
        if seen_names.insert(family.clone()) {
            font_names.push(family);
        }
    }

    // Sort the font names alphabetically for better usability
    font_names.sort();
    Ok(font_names)
}

#[tauri::command]
fn open_explorer_with_file_selected(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    
    // Vérifier que le fichier existe
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    #[cfg(target_os = "windows")]
    {
        // Sur Windows, utiliser explorer.exe avec /select pour sélectionner le fichier
        // Note: explorer.exe peut retourner un code de sortie non-zéro même en cas de succès
        let mut cmd = Command::new("explorer");
        cmd.args(&["/select,", &file_path]);
        configure_command_no_window(&mut cmd);
        let output = cmd.output();

        match output {
            Ok(_) => {
                // Si la commande a pu être exécutée, on considère que c'est un succès
                // car explorer.exe peut retourner des codes de sortie non-zéro même quand ça marche
                Ok(())
            }
            Err(e) => Err(format!("Failed to execute explorer command: {}", e))
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Sur macOS, utiliser 'open' avec -R pour révéler le fichier dans Finder
        let output = Command::new("open")
            .args(&["-R", &file_path])
            .output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    // Fallback: ouvrir juste le dossier parent
                    if let Some(parent) = path.parent() {
                        let fallback_output = Command::new("open")
                            .arg(parent)
                            .output();
                        
                        match fallback_output {
                            Ok(fallback_result) => {
                                if fallback_result.status.success() {
                                    Ok(())
                                } else {
                                    Err("Failed to open Finder".to_string())
                                }
                            }
                            Err(e) => Err(format!("Failed to execute open command: {}", e))
                        }
                    } else {
                        Err("Failed to open Finder and no parent directory found".to_string())
                    }
                }
            }
            Err(e) => Err(format!("Failed to execute open command: {}", e))
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Sur Linux, essayer plusieurs gestionnaires de fichiers
        let file_managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja"];
        let parent_dir = path.parent().ok_or("No parent directory found")?;
        
        for manager in &file_managers {
            let output = Command::new(manager)
                .arg(parent_dir)
                .output();
                
            match output {
                Ok(result) => {
                    if result.status.success() {
                        return Ok(());
                    }
                }
                Err(_) => continue, // Essayer le gestionnaire suivant
            }
        }
        
        // Fallback: utiliser xdg-open pour ouvrir le dossier parent
        let output = Command::new("xdg-open")
            .arg(parent_dir)
            .output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    Err("Failed to open file manager".to_string())
                }
            }
            Err(e) => Err(format!("Failed to execute xdg-open command: {}", e))
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        // Pour les autres OS, juste retourner une erreur
        Err("Unsupported operating system".to_string())
    }
}

#[tauri::command]
fn get_video_dimensions(file_path: &str) -> Result<serde_json::Value, String> {
    // Vérifier que le fichier existe
    if !std::path::Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ffprobe_path = binaries::resolve_binary("ffprobe")
        .ok_or_else(|| "ffprobe binary not found".to_string())?;

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args(&[
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "v:0", // Sélectionner le premier stream vidéo
        file_path,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                
                // Parser le JSON de ffprobe
                let json_value: serde_json::Value = serde_json::from_str(&output_str)
                    .map_err(|e| format!("Failed to parse ffprobe JSON output: {}", e))?;
                
                // Extraire les dimensions du premier stream vidéo
                if let Some(streams) = json_value.get("streams") {
                    if let Some(stream) = streams.get(0) {
                        let width = stream.get("width")
                            .and_then(|w| w.as_i64())
                            .unwrap_or(0);
                        let height = stream.get("height")
                            .and_then(|h| h.as_i64())
                            .unwrap_or(0);
                        
                        return Ok(serde_json::json!({
                            "width": width,
                            "height": height
                        }));
                    }
                }
                
                Err("No video stream found in file".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffprobe error: {}", stderr))
            }
        }
        Err(e) => Err(format!("Unable to execute ffprobe: {}", e)),
    }
}

#[tauri::command]
fn cut_audio(source_path: String, start_ms: u64, end_ms: u64, output_path: String) -> Result<(), String> {
    // Vérifier que le fichier source existe
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Convertir les millisecondes en secondes pour ffmpeg (format HH:MM:SS.ms)
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;

    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
        "-ss", &start_secs.to_string(),
        "-t", &duration_secs.to_string(),
        "-i", &source_path,
        "-c", "copy", // On copie le flux pour garder le format original sans ré-encoder
        "-y",        // Overwrite output file
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                // Si la copie brute échoue (parfois dû à des problèmes de bitstream), 
                // on peut tenter un ré-encodage minimal si c'est nécessaire.
                // Pour l'instant on reste sur copy car c'est plus rapide et préserve la qualité.
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

#[tauri::command]
fn convert_audio_to_cbr(file_path: String) -> Result<(), String> {
    // Vérifier que le fichier existe
    if !std::path::Path::new(&file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Extraire l'extension du fichier d'origine
    let path = Path::new(&file_path);
    let extension = path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4");
    
    // Créer un fichier temporaire avec la même extension
    let file_stem = path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("temp");
    let parent_dir = path.parent()
        .map(|p| p.to_str().unwrap_or(""))
        .unwrap_or("");
    
    let temp_path = if parent_dir.is_empty() {
        format!("{}_temp.{}", file_stem, extension)
    } else {
        format!("{}\\{}_temp.{}", parent_dir, file_stem, extension)
    };

    // Commande ffmpeg pour convertir en CBR - adapter selon le type de fichier
    let mut cmd = Command::new(&ffmpeg_path);
    
    // Détecter si c'est un fichier audio ou vidéo basé sur l'extension
    let is_audio_only = matches!(extension.to_lowercase().as_str(), "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a");
    
    if is_audio_only {
        // Pour les fichiers audio seulement - paramètres identiques à Audacity
        cmd.args(&[
            "-i", &file_path,
            "-codec:a", "libmp3lame",    // Encodeur LAME comme Audacity
            "-b:a", "192k",              // Bitrate constant 192k comme dans l'image
            "-cbr", "1",                 // Force CBR (Constant Bitrate)
            "-ar", "44100",              // Sample rate 44100 Hz comme Audacity
            "-ac", "2",                  // Stéréo comme Audacity
            "-f", "mp3",                 // Format MP3
            "-y",                        // Overwrite output file
            &temp_path,
        ]);
    } else {
        // Pour les fichiers vidéo
        cmd.args(&[
            "-i", &file_path,
            "-b:v", "1200k",         // Bitrate vidéo
            "-minrate", "1200k",     // Bitrate minimum
            "-maxrate", "1200k",     // Bitrate maximum
            "-bufsize", "1200k",     // Buffer size
            "-b:a", "64k",           // Bitrate audio
            "-vcodec", "libx264",    // Codec vidéo
            "-acodec", "aac",        // Codec audio
            "-strict", "-2",         // Strict mode
            "-ac", "2",              // Canaux audio (stéréo)
            "-ar", "44100",          // Sample rate
            "-s", "320x240",         // Résolution vidéo
            "-y",                    // Overwrite output file
            &temp_path,
        ]);
    }
    configure_command_no_window(&mut cmd);
    
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                // Remplacer le fichier original par le fichier converti
                if let Err(e) = std::fs::remove_file(&file_path) {
                    return Err(format!("Failed to remove original file: {}", e));
                }
                if let Err(e) = std::fs::rename(&temp_path, &file_path) {
                    return Err(format!("Failed to replace original file: {}", e));
                }
                Ok(())
            } else {
                // Nettoyer le fichier temporaire en cas d'erreur
                let _ = std::fs::remove_file(&temp_path);
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => {
            // Nettoyer le fichier temporaire en cas d'erreur
            let _ = std::fs::remove_file(&temp_path);
            Err(format!("Unable to execute ffmpeg: {}", e))
        }
    }
}

#[tauri::command]
async fn segment_quran_audio(
    audio_path: String,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    include_word_by_word: Option<bool>,
) -> Result<serde_json::Value, String> {
    // Early-return mock payload to avoid external API calls during testing.
    if QURAN_SEGMENTATION_USE_MOCK {
        return serde_json::from_str(QURAN_SEGMENTATION_MOCK_PAYLOAD)
            .map_err(|e| format!("Mock segmentation JSON invalid: {}", e));
    }

    // Basic input validation before we do any heavy work.
    let _include_word_by_word = include_word_by_word.unwrap_or(false);
    if !Path::new(&audio_path).exists() {
        return Err(format!("Audio file not found: {}", audio_path));
    }

    // Resolve ffmpeg so we can resample to 16kHz mono as required by the API.
    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Build a unique temp file path for the resampled WAV.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!("qurancaption-seg-{}.wav", stamp));
    let _temp_guard = TempFileGuard(temp_path.clone());

    // Resample to 16kHz mono WAV with ffmpeg.
    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &audio_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-vn",
        temp_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr));
    }

    // Read the resampled file into memory for upload.
    let audio_bytes =
        fs::read(&temp_path).map_err(|e| format!("Failed to read resampled audio: {}", e))?;

    // Upload the file to the Gradio space and get a server-side path back.
    let client = reqwest::Client::new();
    let upload_part = Part::bytes(audio_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let upload_form = Form::new().part("files", upload_part);

    let upload_response = client
        .post(QURAN_SEGMENTATION_UPLOAD_URL)
        .multipart(upload_form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Upload request error: {}", e))?;

    let uploaded_paths: Vec<String> = upload_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload response: {}", e))?;

    let uploaded_path = uploaded_paths
        .get(0)
        .ok_or_else(|| "Upload response was empty".to_string())?;

    // Build the API payload in Gradio "queue" format.
    let file_payload = serde_json::json!({
        "path": uploaded_path,
        "orig_name": "audio.wav",
        "mime_type": "audio/wav",
        "meta": { "_type": "gradio.FileData" }
    });
    let session_hash = format!("qc{}", stamp);
    let join_payload = serde_json::json!({
        "data": [
            file_payload,
            min_silence_ms.unwrap_or(200),
            min_speech_ms.unwrap_or(1000),
            pad_ms.unwrap_or(50)
        ],
        "fn_index": QURAN_SEGMENTATION_FN_INDEX,
        "session_hash": session_hash
    });

    // Join the Gradio queue to start processing.
    let join_response = client
        .post(QURAN_SEGMENTATION_QUEUE_JOIN_URL)
        .json(&join_payload)
        .send()
        .await
        .map_err(|e| format!("Queue join failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Queue join error: {}", e))?;

    let join_json: serde_json::Value = join_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse queue join response: {}", e))?;

    let event_id = join_json
        .get("event_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Queue join did not return an event_id".to_string())?
        .to_string();

    // Poll the queue stream (SSE) until the job completes.
    let queue_url = format!(
        "{}?session_hash={}",
        QURAN_SEGMENTATION_QUEUE_DATA_URL, session_hash
    );
    let sse_text = client
        .get(queue_url)
        .send()
        .await
        .map_err(|e| format!("Queue stream request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read queue stream: {}", e))?;

    for line in sse_text.lines() {
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }

        let json_str = line.trim_start_matches("data:").trim();
        if json_str.is_empty() {
            continue;
        }

        let event: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse queue event: {}", e))?;

        // Ignore events for other jobs.
        if let Some(eid) = event.get("event_id").and_then(|v| v.as_str()) {
            if eid != event_id {
                continue;
            }
        }

        let msg = event.get("msg").and_then(|v| v.as_str()).unwrap_or("");
        if msg != "process_completed" {
            continue;
        }

        let success = event.get("success").and_then(|v| v.as_bool()).unwrap_or(true);
        let output = event.get("output").cloned().unwrap_or_else(|| event.clone());

        if !success {
            let error_msg = output
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Segmentation failed")
                .to_string();
            return Err(error_msg);
        }

        // Gradio returns output.data[0] for JSON components; unwrap it when present.
        if let Some(data) = output.get("data").and_then(|v| v.as_array()) {
            if let Some(first) = data.first() {
                return Ok(first.clone());
            }
        }

        return Ok(output);
    }

    Err("Segmentation queue ended without a result".to_string())
}

/// Check if Python and required packages are available for local segmentation
/// This is async to avoid blocking the UI thread during slow Python imports
#[tauri::command]
async fn check_local_segmentation_ready() -> Result<serde_json::Value, String> {
    use tokio::time::{timeout, Duration};
    
    // Run the blocking checks in a background thread with a timeout
    let check_result = timeout(
        Duration::from_secs(30), // 30 second timeout
        tokio::task::spawn_blocking(|| {
            // Try to find Python executable
            let python_cmd = if cfg!(target_os = "windows") {
                "python"
            } else {
                "python3"
            };

            // Check if Python is available (quick check)
            let mut cmd = Command::new(python_cmd);
            cmd.args(&["--version"]);
            configure_command_no_window(&mut cmd);
            
            let python_available = match cmd.output() {
                Ok(output) => output.status.success(),
                Err(_) => false,
            };

            if !python_available {
                return serde_json::json!({
                    "ready": false,
                    "pythonInstalled": false,
                    "packagesInstalled": false,
                    "message": "Python is not installed. Please install Python 3.10+ from python.org"
                });
            }

            // Check if required packages are installed using pip show (FAST - doesn't import)
            // This is much faster than importing the packages which loads heavy ML libraries
            let mut cmd = Command::new(python_cmd);
            cmd.args(&[
                "-m", "pip", "show", 
                "torch", "transformers", "librosa", "numpy", "soundfile"
            ]);
            configure_command_no_window(&mut cmd);
            
            let packages_available = match cmd.output() {
                Ok(output) => {
                    // pip show returns success if ALL packages are found
                    // Check stdout contains info for all packages
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        // Verify we got info for each package
                        stdout.contains("Name: torch") && 
                        stdout.contains("Name: transformers") &&
                        stdout.contains("Name: librosa") &&
                        stdout.contains("Name: numpy") &&
                        stdout.contains("Name: soundfile")
                    } else {
                        false
                    }
                },
                Err(_) => false,
            };

            serde_json::json!({
                "ready": packages_available,
                "pythonInstalled": true,
                "packagesInstalled": packages_available,
                "message": if packages_available {
                    "Local segmentation is ready"
                } else {
                    "Python packages need to be installed (~3GB download)"
                }
            })
        })
    ).await;
    
    match check_result {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(e)) => Err(format!("Task failed: {}", e)),
        Err(_) => {
            // Timeout occurred - return a safe default
            Ok(serde_json::json!({
                "ready": false,
                "pythonInstalled": true,
                "packagesInstalled": false,
                "message": "Check timed out - packages may need to be installed"
            }))
        }
    }
}

/// Install Python dependencies for local segmentation
#[tauri::command]
async fn install_local_segmentation_deps(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;

    let python_cmd = if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    };

    // Helper to emit install status
    let emit_status = |message: &str| {
        let _ = app_handle.emit("install-status", serde_json::json!({ "message": message }));
    };

    // Get the path to the requirements.txt in the app bundle
    let resource_path = app_handle
        .path()
        .resolve("python/requirements.txt", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    // If resource path doesn't exist, try the development path
    let requirements_path = if resource_path.exists() {
        resource_path
    } else {
        // Development fallback - try to find it relative to the executable
        let exe_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Cannot get executable directory")?
            .to_path_buf();
        
        // Try a few locations
        let dev_path = exe_dir.join("..").join("..").join("python").join("requirements.txt");
        if dev_path.exists() {
            dev_path
        } else {
            return Err("requirements.txt not found".to_string());
        }
    };

    // Install PyTorch - detect CUDA availability first, then install appropriate version
    if cfg!(target_os = "windows") {
        // First, check if CUDA is available on this system using nvidia-smi
        emit_status("Detecting GPU capabilities...");
        let mut nvidia_check = Command::new("nvidia-smi");
        configure_command_no_window(&mut nvidia_check);
        
        // Parse nvidia-smi output to get CUDA version
        let cuda_version: Option<(u32, u32)> = match nvidia_check.output() {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Look for "CUDA Version: X.Y" in the output
                // nvidia-smi output format: "CUDA Version: 12.1"
                if let Some(pos) = stdout.find("CUDA Version:") {
                    let version_str = &stdout[pos + 13..];
                    let version_str = version_str.trim();
                    // Take until space or newline
                    let end = version_str.find(|c: char| c.is_whitespace() || c == '|').unwrap_or(version_str.len());
                    let version_str = &version_str[..end].trim();
                    let parts: Vec<&str> = version_str.split('.').collect();
                    if parts.len() >= 2 {
                        if let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                            Some((major, minor))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            },
            _ => None,
        };
        
        if let Some((major, minor)) = cuda_version {
            emit_status(&format!("CUDA {} detected, installing PyTorch with CUDA support...", format!("{}.{}", major, minor)));
            
            // Select appropriate CUDA index based on detected version
            // PyTorch wheels: cu124 (12.4+), cu121 (12.1-12.3), cu118 (11.8-12.0)
            let cuda_indexes: Vec<&str> = if major >= 12 && minor >= 4 {
                vec!["https://download.pytorch.org/whl/cu124", "https://download.pytorch.org/whl/cu121", "https://download.pytorch.org/whl/cu118"]
            } else if major >= 12 && minor >= 1 {
                vec!["https://download.pytorch.org/whl/cu121", "https://download.pytorch.org/whl/cu124", "https://download.pytorch.org/whl/cu118"]
            } else if major >= 11 && minor >= 8 {
                vec!["https://download.pytorch.org/whl/cu118", "https://download.pytorch.org/whl/cu121"]
            } else if major >= 11 {
                vec!["https://download.pytorch.org/whl/cu118"]
            } else {
                // CUDA too old, skip to CPU
                vec![]
            };
            
            let mut cuda_install_errors: Vec<String> = Vec::new();
            let mut cuda_success = false;

            for index_url in cuda_indexes {
                emit_status(&format!("Trying PyTorch from {}...", index_url));
                let mut torch_cmd = Command::new(python_cmd);
                torch_cmd.args(&[
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "torch",
                    "torchvision",
                    "torchaudio",
                    "--index-url",
                    index_url,
                    "--quiet",
                ]);
                configure_command_no_window(&mut torch_cmd);

                let torch_output = torch_cmd
                    .output()
                    .map_err(|e| format!("Failed to run pip (torch): {}", e))?;

                if !torch_output.status.success() {
                    let stderr = String::from_utf8_lossy(&torch_output.stderr);
                    cuda_install_errors.push(format!("Index {} failed: {}", index_url, stderr));
                    continue;
                }

                // Verify CUDA is actually available in the installed torch
                let mut cuda_check = Command::new(python_cmd);
                cuda_check.args(&[
                    "-c",
                    "import torch; assert torch.cuda.is_available(), 'no cuda'; print('ok')",
                ]);
                configure_command_no_window(&mut cuda_check);

                let cuda_output = cuda_check.output();
                if let Ok(output) = cuda_output {
                    if output.status.success() {
                        cuda_success = true;
                        cuda_install_errors.clear();
                        emit_status(&format!("PyTorch with CUDA ({}) installed successfully!", index_url.split('/').last().unwrap_or("cu")));
                        break;
                    }
                }

                cuda_install_errors.push(format!(
                    "Index {} installed but CUDA not available in torch",
                    index_url
                ));
            }

            // If CUDA installation failed, fall back to CPU
            if !cuda_success {
                emit_status("CUDA setup failed, falling back to CPU version...");
                
                // Uninstall potentially broken CUDA torch first
                let mut uninstall_cmd = Command::new(python_cmd);
                uninstall_cmd.args(&["-m", "pip", "uninstall", "torch", "torchvision", "torchaudio", "-y"]);
                configure_command_no_window(&mut uninstall_cmd);
                let _ = uninstall_cmd.output(); // Ignore errors
                
                // Install CPU version
                let mut cpu_cmd = Command::new(python_cmd);
                cpu_cmd.args(&[
                    "-m",
                    "pip",
                    "install",
                    "torch",
                    "torchvision",
                    "torchaudio",
                    "--index-url",
                    "https://download.pytorch.org/whl/cpu",
                    "--quiet",
                ]);
                configure_command_no_window(&mut cpu_cmd);

                let cpu_output = cpu_cmd
                    .output()
                    .map_err(|e| format!("Failed to run pip (torch CPU): {}", e))?;

                if !cpu_output.status.success() {
                    let stderr = String::from_utf8_lossy(&cpu_output.stderr);
                    return Err(format!(
                        "Failed to install torch. CUDA attempts: {} | CPU fallback failed: {}",
                        cuda_install_errors.join(" | "),
                        stderr
                    ));
                }
            }
        } else {
            // Check if nvidia-smi was available but version couldn't be parsed
            let mut nvidia_fallback = Command::new("nvidia-smi");
            configure_command_no_window(&mut nvidia_fallback);
            let has_nvidia = nvidia_fallback.output().map(|o| o.status.success()).unwrap_or(false);
            
            if has_nvidia {
                // nvidia-smi worked but couldn't parse CUDA version - try CUDA anyway
                emit_status("NVIDIA GPU detected but couldn't determine CUDA version, trying CUDA install...");
                
                let mut cuda_success = false;
                for index_url in &["https://download.pytorch.org/whl/cu121", "https://download.pytorch.org/whl/cu118"] {
                    emit_status(&format!("Trying PyTorch from {}...", index_url));
                    let mut torch_cmd = Command::new(python_cmd);
                    torch_cmd.args(&[
                        "-m", "pip", "install", "--upgrade", "torch", "torchvision", "torchaudio",
                        "--index-url", index_url, "--quiet",
                    ]);
                    configure_command_no_window(&mut torch_cmd);

                    if torch_cmd.output().map(|o| o.status.success()).unwrap_or(false) {
                        let mut cuda_check = Command::new(python_cmd);
                        cuda_check.args(&["-c", "import torch; assert torch.cuda.is_available()"]);
                        configure_command_no_window(&mut cuda_check);
                        
                        if cuda_check.output().map(|o| o.status.success()).unwrap_or(false) {
                            cuda_success = true;
                            emit_status(&format!("PyTorch with CUDA ({}) installed!", index_url.split('/').last().unwrap_or("cu")));
                            break;
                        }
                    }
                }
                
                if !cuda_success {
                    emit_status("CUDA setup failed, falling back to CPU...");
                    let mut cpu_cmd = Command::new(python_cmd);
                    cpu_cmd.args(&[
                        "-m", "pip", "install", "torch", "torchvision", "torchaudio",
                        "--index-url", "https://download.pytorch.org/whl/cpu", "--quiet",
                    ]);
                    configure_command_no_window(&mut cpu_cmd);
                    let _ = cpu_cmd.output();
                }
            } else {
                // No CUDA GPU detected - install CPU version directly
                emit_status("No CUDA GPU detected, installing PyTorch CPU version...");
            let mut cpu_cmd = Command::new(python_cmd);
            cpu_cmd.args(&[
                "-m",
                "pip",
                "install",
                "torch",
                "torchvision",
                "torchaudio",
                "--index-url",
                "https://download.pytorch.org/whl/cpu",
                "--quiet",
            ]);
            configure_command_no_window(&mut cpu_cmd);

            let cpu_output = cpu_cmd
                .output()
                .map_err(|e| format!("Failed to run pip (torch CPU): {}", e))?;

            if !cpu_output.status.success() {
                let stderr = String::from_utf8_lossy(&cpu_output.stderr);
                return Err(format!("Failed to install torch CPU: {}", stderr));
            }
            emit_status("PyTorch CPU version installed successfully!");
            }
        }
    }


    let requirements_to_use = if cfg!(target_os = "windows") {
        let requirements_content = std::fs::read_to_string(&requirements_path)
            .map_err(|e| format!("Failed to read requirements.txt: {}", e))?;
        let filtered: String = requirements_content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    return false;
                }
                let lower = trimmed.to_lowercase();
                !(lower.starts_with("torch") || lower.starts_with("torchvision") || lower.starts_with("torchaudio"))
            })
            .collect::<Vec<_>>()
            .join("\n");

        let filtered_path = std::env::temp_dir().join("qurancaption_requirements_no_torch.txt");
        std::fs::write(&filtered_path, filtered)
            .map_err(|e| format!("Failed to write filtered requirements: {}", e))?;
        filtered_path
    } else {
        requirements_path
    };

    emit_status("Installing ML packages (transformers, librosa...)...");
    let mut cmd = Command::new(python_cmd);
    cmd.args(&[
        "-m",
        "pip",
        "install",
        "-r",
        requirements_to_use.to_string_lossy().as_ref(),
        "--quiet",
    ]);
    configure_command_no_window(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run pip: {}", e))?;

    if output.status.success() {
        Ok("Dependencies installed successfully".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("pip install failed: {}", stderr))
    }
}

/// Run local segmentation using the Python script
#[tauri::command]
async fn segment_quran_audio_local(
    app_handle: tauri::AppHandle,
    audio_path: String,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    whisper_model: Option<String>,
    include_word_by_word: Option<bool>,
) -> Result<serde_json::Value, String> {
    use std::process::Stdio;
    use std::io::{BufRead, BufReader};
    use tauri::Emitter;

    // Validate input file exists
    if !Path::new(&audio_path).exists() {
        return Err(format!("Audio file not found: {}", audio_path));
    }

    // Resolve ffmpeg for audio preprocessing
    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Build a unique temp file path for the resampled WAV (same as cloud mode)
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!("qurancaption-local-seg-{}.wav", stamp));
    let _temp_guard = TempFileGuard(temp_path.clone());

    // Resample to 16kHz mono WAV with ffmpeg (same preprocessing as cloud mode)
    let mut resample_cmd = Command::new(&ffmpeg_path);
    resample_cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &audio_path,
        "-ac",
        "1",           // mono
        "-ar",
        "16000",       // 16kHz
        "-c:a",
        "pcm_s16le",   // 16-bit PCM
        "-vn",
        temp_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut resample_cmd);
    
    let resample_output = resample_cmd.output()
        .map_err(|e| format!("Unable to execute ffmpeg for preprocessing: {}", e))?;

    if !resample_output.status.success() {
        let stderr = String::from_utf8_lossy(&resample_output.stderr);
        return Err(format!("ffmpeg preprocessing error: {}", stderr));
    }

    let python_cmd = if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    };

    // Get the path to the Python script
    let resource_path = app_handle
        .path()
        .resolve("python/local_segmenter.py", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    // Development fallback
    let script_path = if resource_path.exists() {
        resource_path
    } else {
        let exe_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Cannot get executable directory")?
            .to_path_buf();
        
        let dev_path = exe_dir.join("..").join("..").join("python").join("local_segmenter.py");
        if dev_path.exists() {
            dev_path
        } else {
            return Err("local_segmenter.py not found".to_string());
        }
    };

    // Build command arguments - use the preprocessed temp file instead of original
    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        temp_path.to_string_lossy().to_string(), // Use preprocessed audio
    ];

    if let Some(ms) = min_silence_ms {
        args.push("--min-silence-ms".to_string());
        args.push(ms.to_string());
    }
    if let Some(ms) = min_speech_ms {
        args.push("--min-speech-ms".to_string());
        args.push(ms.to_string());
    }
    if let Some(ms) = pad_ms {
        args.push("--pad-ms".to_string());
        args.push(ms.to_string());
    }
    if let Some(model) = whisper_model {
        args.push("--whisper-model".to_string());
        args.push(model);
    }
    if include_word_by_word.unwrap_or(false) {
        args.push("--include-word-timestamps".to_string());
    }

    let mut cmd = Command::new(python_cmd);
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    configure_command_no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn Python: {}", e))?;
    
    // Read stderr in a separate thread for status updates
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let app_handle_clone = app_handle.clone();
    
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                // Check for STATUS: prefix
                if line.starts_with("STATUS:") {
                    let json_str = line.trim_start_matches("STATUS:");
                    if let Ok(status_data) = serde_json::from_str::<serde_json::Value>(json_str) {
                        let _ = app_handle_clone.emit("segmentation-status", status_data);
                    }
                }
            }
        }
    });

    // Wait for process to complete
    let output = child.wait_with_output().map_err(|e| format!("Failed to wait for Python: {}", e))?;
    
    // Wait for stderr thread to finish
    let _ = stderr_handle.join();

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let result: serde_json::Value = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse Python output: {}", e))?;
        
        // Check if there's an error in the JSON response
        if let Some(error) = result.get("error") {
            return Err(error.as_str().unwrap_or("Unknown error").to_string());
        }
        
        Ok(result)
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        
        // Try to parse error from stdout (our script outputs JSON errors)
        if let Ok(error_json) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if let Some(error) = error_json.get("error") {
                return Err(error.as_str().unwrap_or("Unknown error").to_string());
            }
        }
        
        Err(format!("Python script failed: {}", stdout))
    }
}


#[tauri::command]
async fn init_discord_rpc(app_id: String) -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    // Fermer la connexion existante si elle existe
    if let Some(ref mut client) = *client_guard {
        let _ = client.close();
    }
    
    // Créer une nouvelle connexion
    let mut client = DiscordIpcClient::new(&app_id).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    
    *client_guard = Some(client);
    Ok(())
}

#[tauri::command]
async fn update_discord_activity(activity_data: DiscordActivity) -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut client) = *client_guard {
        let mut activity_builder = activity::Activity::new();
        
        // Traiter les détails
        if let Some(ref details) = activity_data.details {
            activity_builder = activity_builder.details(details);
        }
        
        // Traiter l'état
        if let Some(ref state) = activity_data.state {
            activity_builder = activity_builder.state(state);
        }
        
        // Ajouter le timestamp de début (utilise start_timestamp si fourni, sinon l'heure actuelle)
        let start_time = activity_data.start_timestamp.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
        });
        
        activity_builder = activity_builder.timestamps(
            activity::Timestamps::new().start(start_time)
        );
        
        // Construire les assets si nécessaire
        let has_large_image = activity_data.large_image_key.is_some();
        let has_small_image = activity_data.small_image_key.is_some();
        
        if has_large_image || has_small_image {
            let mut assets_builder = activity::Assets::new();
            
            if let Some(ref large_image_key) = activity_data.large_image_key {
                assets_builder = assets_builder.large_image(large_image_key);
                
                if let Some(ref large_image_text) = activity_data.large_image_text {
                    assets_builder = assets_builder.large_text(large_image_text);
                }
            }
            
            if let Some(ref small_image_key) = activity_data.small_image_key {
                assets_builder = assets_builder.small_image(small_image_key);
                
                if let Some(ref small_image_text) = activity_data.small_image_text {
                    assets_builder = assets_builder.small_text(small_image_text);
                }
            }
            
            activity_builder = activity_builder.assets(assets_builder);
        }
        
        // Construire la party si nécessaire
        if let (Some(party_size), Some(party_max)) = (activity_data.party_size, activity_data.party_max) {
            let party = activity::Party::new().size([party_size as i32, party_max as i32]);
            activity_builder = activity_builder.party(party);
        }
        
        let activity = activity_builder;
        client.set_activity(activity).map_err(|e| e.to_string())?;
        
        Ok(())
    } else {
        Err("Discord client not initialized. Call init_discord_rpc first.".to_string())
    }
}

#[tauri::command]
async fn clear_discord_activity() -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut client) = *client_guard {
        client.clear_activity().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Discord client not initialized.".to_string())
    }
}

#[tauri::command]
async fn close_discord_rpc() -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut client) = *client_guard {
        client.close().map_err(|e| e.to_string())?;
        *client_guard = None;
        Ok(())
    } else {
        Ok(()) // Déjà fermé ou pas initialisé
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())        .invoke_handler(tauri::generate_handler![
            download_from_youtube,
            get_duration,
            get_new_file_path,
            save_binary_file,
            download_file,
            delete_file,
            move_file,
            get_system_fonts,
            open_explorer_with_file_selected,
            get_video_dimensions,
            exporter::export_video,
            exporter::cancel_export,
            exporter::concat_videos,
            convert_audio_to_cbr,
            cut_audio,
            segment_quran_audio,
            segment_quran_audio_local,
            check_local_segmentation_ready,
            install_local_segmentation_deps,
            init_discord_rpc,
            update_discord_activity,
            clear_discord_activity,
            close_discord_rpc
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
