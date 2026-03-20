use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

/// Retourne le dossier local de binaires media: `<app_data>/tools/bin`.
pub fn ensure_media_tools_bin_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let tools_bin_dir = app_data_dir.join("tools").join("bin");
    fs::create_dir_all(&tools_bin_dir).map_err(|e| {
        format!(
            "Failed to create tools bin directory '{}': {}",
            tools_bin_dir.to_string_lossy(),
            e
        )
    })?;
    Ok(tools_bin_dir)
}

fn normalize_path_key(value: &str) -> String {
    if cfg!(target_os = "windows") {
        value.to_lowercase()
    } else {
        value.to_string()
    }
}

/// Prepende un dossier au PATH du process courant.
pub fn prepend_to_process_path(dir: &Path) {
    let separator = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };
    let dir_str = dir.to_string_lossy().to_string();

    let current = env::var("PATH").unwrap_or_default();
    let dir_key = normalize_path_key(&dir_str);
    let already_present = current
        .split(separator)
        .map(normalize_path_key)
        .any(|entry| entry == dir_key);
    if already_present {
        return;
    }

    let updated = if current.is_empty() {
        dir_str
    } else {
        format!("{}{}{}", dir.to_string_lossy(), separator, current)
    };
    env::set_var("PATH", updated);
}

/// S'assure que le dossier local existe puis l'ajoute au PATH process.
pub fn prepare_media_tools_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = ensure_media_tools_bin_dir(app_handle)?;
    prepend_to_process_path(&dir);
    Ok(dir)
}
