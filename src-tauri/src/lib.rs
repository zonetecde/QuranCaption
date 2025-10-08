use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

mod binary_resolver;
mod exporter;

use binary_resolver::{resolve_ffmpeg, resolve_ffprobe, resolve_yt_dlp};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

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

fn configure_command_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

#[tauri::command]
async fn download_from_youtube(
    app: tauri::AppHandle,
    url: String,
    _type: String,
    download_path: String,
) -> Result<String, String> {
    if let Err(e) = fs::create_dir_all(&download_path) {
        return Err(format!("Unable to create directory: {}", e));
    }

    let yt_dlp =
        resolve_yt_dlp(&app).map_err(|e| format!("Unable to locate yt-dlp binary: {}", e))?;
    let ffmpeg =
        resolve_ffmpeg(&app).map_err(|e| format!("Unable to locate ffmpeg binary: {}", e))?;

    let mut args: Vec<String> = vec!["--force-ipv4".to_string()];

    if let Some(dir) = ffmpeg.directory.clone() {
        args.push("--ffmpeg-location".to_string());
        args.push(dir.to_string_lossy().to_string());
    }

    let output_pattern = Path::new(&download_path)
        .join("%(title)s (%(uploader)s).%(ext)s")
        .to_string_lossy()
        .to_string();

    match _type.as_str() {
        "audio" => {
            args.extend(
                [
                    "--extract-audio",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "0",
                    "--postprocessor-args",
                    "ffmpeg:-b:a 320k -ar 44100",
                ]
                .into_iter()
                .map(|s| s.to_string()),
            );
        }
        "video" => {
            args.extend(
                [
                    "--format",
                    "best[height<=1080][ext=mp4]/best[ext=mp4]/best",
                    "--merge-output-format",
                    "mp4",
                    "--postprocessor-args",
                    "ffmpeg:-b:v 2000k -maxrate 2000k -bufsize 4000k -b:a 128k",
                ]
                .into_iter()
                .map(|s| s.to_string()),
            );
        }
        _ => {
            return Err("Invalid type: must be 'audio' or 'video'".to_string());
        }
    }

    args.push("-o".to_string());
    args.push(output_pattern);
    args.push(url);

    let mut cmd = Command::new(&yt_dlp.command);
    cmd.args(&args);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                println!("yt-dlp output: {}", output_str);

                let extension = if _type == "audio" { "mp3" } else { "mp4" };

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
fn get_duration(app: tauri::AppHandle, file_path: &str) -> Result<i64, String> {
    if !std::path::Path::new(file_path).exists() {
        return Ok(-1);
    }

    let ffprobe = match resolve_ffprobe(&app) {
        Ok(bin) => bin,
        Err(_) => return Ok(-1),
    };

    let mut cmd = Command::new(&ffprobe.command);
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
                let created_time = metadata
                    .created()
                    .or_else(|_| metadata.modified())
                    .ok()
                    .and_then(|time| {
                        time.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|duration| duration.as_millis() as u64)
                    });

                if let Some(created_time) = created_time {
                    if created_time > start_time {
                        let file_path = entry.path();
                        if let Some(file_name) = file_path.file_name() {
                            let file_name_str = file_name.to_string_lossy();
                            let asset_name_trimmed = asset_name.trim();

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
fn move_file(source: String, destination: String) -> Result<(), String> {
    use std::path::Path;

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
            Err(e) => Err(format!("Failed to execute explorer command: {}", e)),
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Sur macOS, utiliser 'open' avec -R pour révéler le fichier dans Finder
        let output = Command::new("open").args(&["-R", &file_path]).output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    // Fallback: ouvrir juste le dossier parent
                    if let Some(parent) = path.parent() {
                        let fallback_output = Command::new("open").arg(parent).output();

                        match fallback_output {
                            Ok(fallback_result) => {
                                if fallback_result.status.success() {
                                    Ok(())
                                } else {
                                    Err("Failed to open Finder".to_string())
                                }
                            }
                            Err(e) => Err(format!("Failed to execute open command: {}", e)),
                        }
                    } else {
                        Err("Failed to open Finder and no parent directory found".to_string())
                    }
                }
            }
            Err(e) => Err(format!("Failed to execute open command: {}", e)),
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Sur Linux, essayer plusieurs gestionnaires de fichiers
        let file_managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja"];
        let parent_dir = path.parent().ok_or("No parent directory found")?;

        for manager in &file_managers {
            let output = Command::new(manager).arg(parent_dir).output();

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
        let output = Command::new("xdg-open").arg(parent_dir).output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    Err("Failed to open file manager".to_string())
                }
            }
            Err(e) => Err(format!("Failed to execute xdg-open command: {}", e)),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        // Pour les autres OS, juste retourner une erreur
        Err("Unsupported operating system".to_string())
    }
}

#[tauri::command]
fn get_video_dimensions(
    app: tauri::AppHandle,
    file_path: &str,
) -> Result<serde_json::Value, String> {
    if !std::path::Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ffprobe = resolve_ffprobe(&app).map_err(|e| format!("ffprobe binary not found: {}", e))?;

    let mut cmd = Command::new(&ffprobe.command);
    cmd.args(&[
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "v:0",
        file_path,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);

                let json_value: serde_json::Value = serde_json::from_str(&output_str)
                    .map_err(|e| format!("Failed to parse ffprobe JSON output: {}", e))?;

                if let Some(streams) = json_value.get("streams") {
                    if let Some(stream) = streams.get(0) {
                        let width = stream.get("width").and_then(|w| w.as_i64()).unwrap_or(0);
                        let height = stream.get("height").and_then(|h| h.as_i64()).unwrap_or(0);

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
fn convert_audio_to_cbr(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    if !std::path::Path::new(&file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ffmpeg = resolve_ffmpeg(&app).map_err(|e| format!("ffmpeg binary not found: {}", e))?;

    let path = std::path::Path::new(&file_path);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4");
    let file_stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("temp");

    let temp_path = path.with_file_name(format!("{}_temp.{}", file_stem, extension));

    let mut cmd = Command::new(&ffmpeg.command);

    let is_audio_only = matches!(
        extension.to_lowercase().as_str(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a"
    );

    if is_audio_only {
        cmd.arg("-i").arg(&file_path);
        cmd.arg("-codec:a").arg("libmp3lame");
        cmd.arg("-b:a").arg("192k");
        cmd.arg("-cbr").arg("1");
        cmd.arg("-ar").arg("44100");
        cmd.arg("-ac").arg("2");
        cmd.arg("-f").arg("mp3");
        cmd.arg("-y");
        cmd.arg(temp_path.as_os_str());
    } else {
        cmd.arg("-i").arg(&file_path);
        cmd.arg("-b:v").arg("1200k");
        cmd.arg("-minrate").arg("1200k");
        cmd.arg("-maxrate").arg("1200k");
        cmd.arg("-bufsize").arg("1200k");
        cmd.arg("-b:a").arg("64k");
        cmd.arg("-vcodec").arg("libx264");
        cmd.arg("-acodec").arg("aac");
        cmd.arg("-strict").arg("-2");
        cmd.arg("-ac").arg("2");
        cmd.arg("-ar").arg("44100");
        cmd.arg("-preset").arg("medium");
        cmd.arg("-y");
        cmd.arg(temp_path.as_os_str());
    }

    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                std::fs::rename(&temp_path, &file_path)
                    .map_err(|e| format!("Failed to replace original file: {}", e))?;
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let _ = std::fs::remove_file(&temp_path);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(format!("Unable to execute ffmpeg: {}", e))
        }
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

        activity_builder =
            activity_builder.timestamps(activity::Timestamps::new().start(start_time));

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
        if let (Some(party_size), Some(party_max)) =
            (activity_data.party_size, activity_data.party_max)
        {
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            download_from_youtube,
            get_duration,
            get_new_file_path,
            move_file,
            get_system_fonts,
            open_explorer_with_file_selected,
            get_video_dimensions,
            exporter::export_video,
            exporter::cancel_export,
            exporter::concat_videos,
            convert_audio_to_cbr,
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
