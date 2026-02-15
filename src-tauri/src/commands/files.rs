use std::fs;

use crate::path_utils;

/// Recherche dans le dossier téléchargements un fichier créé après `start_time`.
#[tauri::command]
pub fn get_new_file_path(start_time: u64, asset_name: &str) -> Result<String, String> {
    let download_path = dirs::download_dir()
        .ok_or_else(|| "Unable to determine download directory".to_string())?
        .to_string_lossy()
        .to_string();

    let entries = fs::read_dir(&download_path)
        .map_err(|e| format!("Unable to read download directory: {}", e))?;
    for entry in entries.flatten() {
        if let Ok(metadata) = entry.metadata() {
            if let Ok(created) = metadata.created() {
                let created_time = created
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| "Time went backwards")?
                    .as_millis() as u64;
                if created_time > start_time {
                    let file_path = entry.path();
                    let file_path_str = file_path.to_string_lossy().to_string();
                    let _asset_name_trimmed = asset_name.trim();
                    return Ok(file_path_str);
                }
            }
        }
    }
    Err("Downloaded file not found".to_string())
}

/// Écrit un fichier binaire en créant son dossier parent si nécessaire.
#[tauri::command]
pub fn save_binary_file(path: String, content: Vec<u8>) -> Result<(), String> {
    let path_buf = path_utils::normalize_output_path(&path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path_buf, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Écrit un fichier texte en créant son dossier parent si nécessaire.
#[tauri::command]
pub fn save_file(location: String, content: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_output_path(&location);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path_buf, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Télécharge un fichier HTTP puis l'écrit de manière asynchrone sur disque.
#[tauri::command]
pub async fn download_file(url: String, path: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_output_path(&path);
    if let Some(parent) = path_buf.parent() {
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
    tokio::fs::write(&path_buf, &bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Supprime un fichier existant.
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_existing_path(&path);
    fs::remove_file(path_buf).map_err(|e| format!("Failed to delete file: {}", e))
}

/// Déplace un fichier avec fallback copy+delete sur erreur cross-device.
#[tauri::command]
pub fn move_file(source: String, destination: String) -> Result<(), String> {
    let source_path = path_utils::normalize_existing_path(&source);
    let dest_path = path_utils::normalize_output_path(&destination);

    if dest_path.exists() {
        std::fs::remove_file(&dest_path).map_err(|e| e.to_string())?;
    }

    match std::fs::rename(&source_path, &dest_path) {
        Ok(()) => Ok(()),
        Err(e) => {
            if e.raw_os_error() == Some(17) || e.raw_os_error() == Some(18) {
                std::fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;
                std::fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}
