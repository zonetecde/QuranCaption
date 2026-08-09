use std::fs;
use std::path::PathBuf;

use tauri::Manager;

/// Retourne le dossier de cache privé et inscriptible de l'application.
pub(crate) fn app_temp_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Unable to resolve app cache directory: {}", e))?;
    fs::create_dir_all(&path)
        .map_err(|e| format!("Unable to create app cache directory: {}", e))?;
    Ok(path)
}

/// Garde RAII qui supprime automatiquement un fichier temporaire à la sortie de scope.
pub struct TempFileGuard(pub PathBuf);

impl Drop for TempFileGuard {
    /// Tente de supprimer le fichier temporaire sans propager d'erreur.
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
