use std::collections::HashSet;
use std::fs;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tauri::Manager;

static EXPORTS_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Fusionne uniquement les exports appartenant à la fenêtre appelante dans `exports.json`.
///
/// @param app_handle Gestionnaire Tauri utilisé pour résoudre le dossier AppData.
/// @param owned_export_ids Identifiants que la fenêtre appelante est autorisée à remplacer ou supprimer.
/// @param exports Exports courants appartenant à la fenêtre appelante.
/// @returns Succès lorsque la fusion atomique en mémoire puis l'écriture sur disque sont terminées.
#[tauri::command]
pub fn merge_export_entries(
    app_handle: tauri::AppHandle,
    owned_export_ids: Vec<i64>,
    exports: Vec<Value>,
) -> Result<(), String> {
    let lock = EXPORTS_FILE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Failed to lock export persistence".to_string())?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    let file_path = app_data_dir.join("exports.json");

    let mut existing = if file_path.exists() {
        let content = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
        serde_json::from_str::<Vec<Value>>(&content).map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };

    let owned_ids = owned_export_ids.into_iter().collect::<HashSet<_>>();
    existing.retain(|entry| {
        entry
            .get("exportId")
            .and_then(Value::as_i64)
            .map(|id| !owned_ids.contains(&id))
            .unwrap_or(true)
    });

    let mut merged = exports;
    merged.extend(existing);
    let content = serde_json::to_string_pretty(&merged).map_err(|error| error.to_string())?;
    fs::write(file_path, content).map_err(|error| error.to_string())
}
