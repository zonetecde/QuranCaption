use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::time::Duration;

use reqwest::header::{ACCEPT, ACCEPT_ENCODING, RANGE, USER_AGENT};
use tokio::io::AsyncWriteExt;

use crate::path_utils;
use tauri::Emitter;

/// Calcule un pourcentage de copie borné entre 0 et 100.
///
/// @param copied Nombre d'octets déjà copiés.
/// @param total Taille totale du fichier.
/// @returns Pourcentage de progression.
fn copy_progress_percent(copied: u64, total: u64) -> u8 {
    if total == 0 {
        return 100;
    }
    ((copied.saturating_mul(100) / total).min(100)) as u8
}

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

/// Copie un fichier sans charger son contenu en mémoire JS.
#[tauri::command]
pub fn copy_file(source: String, destination: String) -> Result<(), String> {
    let src = path_utils::normalize_output_path(&source);
    let dst = path_utils::normalize_output_path(&destination);
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::copy(&src, &dst).map_err(|e| format!("Failed to copy file: {}", e))?;
    Ok(())
}

/// Copie un fichier par blocs via un fichier temporaire et publie sa progression.
///
/// @param source_path Chemin du fichier source.
/// @param destination_path Chemin final dans les assets du projet.
/// @param copy_request_id Identifiant de corrélation de la copie.
/// @param app_handle Gestionnaire Tauri utilisé pour publier la progression.
/// @returns Chemin final après renommage du fichier temporaire.
#[tauri::command]
pub fn copy_file_with_progress(
    source_path: String,
    destination_path: String,
    copy_request_id: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let source = path_utils::normalize_existing_path(&source_path);
    let destination = path_utils::normalize_output_path(&destination_path);
    if !source.is_file() {
        return Err("Source file not found".to_string());
    }
    if destination.exists() {
        return Err("Destination file already exists".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut temp_name = destination.as_os_str().to_os_string();
    temp_name.push(".part");
    let temp_path = std::path::PathBuf::from(temp_name);
    let _ = fs::remove_file(&temp_path);

    let result = (|| -> Result<(), String> {
        let total = fs::metadata(&source)
            .map_err(|error| error.to_string())?
            .len();
        let input = fs::File::open(&source).map_err(|error| error.to_string())?;
        let output = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(input);
        let mut writer = BufWriter::new(output);
        let mut buffer = vec![0_u8; 256 * 1024];
        let mut copied = 0_u64;
        let mut last_progress = 0_u8;

        let _ = app_handle.emit(
            "batch-file-copy-progress",
            serde_json::json!({
                "copyRequestId": copy_request_id,
                "progress": 0,
                "status": "copying"
            }),
        );
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            writer
                .write_all(&buffer[..read])
                .map_err(|error| error.to_string())?;
            copied += read as u64;
            let progress = copy_progress_percent(copied, total);
            if progress >= last_progress.saturating_add(1) {
                last_progress = progress;
                let _ = app_handle.emit(
                    "batch-file-copy-progress",
                    serde_json::json!({
                        "copyRequestId": copy_request_id,
                        "progress": progress,
                        "status": "copying"
                    }),
                );
            }
        }
        writer.flush().map_err(|error| error.to_string())?;
        fs::rename(&temp_path, &destination).map_err(|error| error.to_string())?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to copy file: {}", error));
    }

    let _ = app_handle.emit(
        "batch-file-copy-progress",
        serde_json::json!({
            "copyRequestId": copy_request_id,
            "progress": 100,
            "status": "finished"
        }),
    );
    Ok(destination.to_string_lossy().to_string())
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

    let mut temp_os = path_buf.as_os_str().to_os_string();
    temp_os.push(".part");
    let temp_path = std::path::PathBuf::from(temp_os);
    let _ = tokio::fs::remove_file(&temp_path).await;

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let max_retries = 3usize;
    let mut downloaded = 0u64;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        let mut request = client
            .get(&url)
            .header(USER_AGENT, "QuranCaption/3")
            .header(ACCEPT, "*/*")
            .header(ACCEPT_ENCODING, "identity");

        if downloaded > 0 {
            request = request.header(RANGE, format!("bytes={}-", downloaded));
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(e) => {
                last_error = format!(
                    "Request failed (attempt {}/{}): {}",
                    attempt, max_retries, e
                );
                continue;
            }
        };

        if !response.status().is_success() {
            last_error = format!(
                "HTTP error (attempt {}/{}): {}",
                attempt,
                max_retries,
                response.status()
            );
            continue;
        }

        if downloaded > 0 && response.status() == reqwest::StatusCode::OK {
            downloaded = 0;
        }

        let mut file = if downloaded == 0 {
            tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&temp_path)
                .await
                .map_err(|e| format!("Failed to open temp file: {}", e))?
        } else {
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&temp_path)
                .await
                .map_err(|e| format!("Failed to open temp file: {}", e))?
        };

        let mut response = response;
        let mut request_completed = false;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| format!("Failed to write file: {}", e))?;
                    downloaded += chunk.len() as u64;
                }
                Ok(None) => {
                    file.flush()
                        .await
                        .map_err(|e| format!("Failed to flush file: {}", e))?;
                    request_completed = true;
                    break;
                }
                Err(e) => {
                    last_error = format!(
                        "Failed to read response (attempt {}/{}): {}",
                        attempt, max_retries, e
                    );
                    break;
                }
            }
        }

        if request_completed {
            tokio::fs::rename(&temp_path, &path_buf)
                .await
                .map_err(|e| format!("Failed to finalize file: {}", e))?;
            return Ok(());
        }
    }

    let _ = tokio::fs::remove_file(&temp_path).await;
    if last_error.is_empty() {
        Err("Download failed after retries".to_string())
    } else {
        Err(last_error)
    }
}

/// Supprime un fichier existant.
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_existing_path(&path);
    fs::remove_file(path_buf).map_err(|e| format!("Failed to delete file: {}", e))
}

/// Effectue une requête HTTP GET et renvoie le code de statut.
#[tauri::command]
pub async fn send_http_get(url: String) -> Result<u16, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header(USER_AGENT, "QuranCaption/3")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", status));
    }
    Ok(status)
}

/// Effectue une requête HTTP GET et renvoie le corps de la réponse.
#[tauri::command]
pub async fn send_http_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header(USER_AGENT, "QuranCaption/3")
        .header(ACCEPT, "application/json,text/plain,*/*")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", status));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read HTTP response body: {}", e))
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

#[cfg(test)]
mod tests {
    use super::copy_progress_percent;

    #[test]
    fn copy_progress_is_bounded() {
        assert_eq!(copy_progress_percent(0, 10), 0);
        assert_eq!(copy_progress_percent(5, 10), 50);
        assert_eq!(copy_progress_percent(20, 10), 100);
        assert_eq!(copy_progress_percent(0, 0), 100);
    }
}
