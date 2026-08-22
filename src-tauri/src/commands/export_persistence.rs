use std::collections::HashSet;
use std::fs;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tauri::{Emitter, Manager};

static EXPORTS_FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

const ACTIVE_VIDEO_STATES: &[&str] = &[
    "Capturing Frames",
    "Initializing...",
    "Processing Background",
    "Adding Subtitles",
    "Creating Video",
    "Merging Files",
    "Recording",
    "Adding Audio",
];

/// Résout le chemin partagé de `exports.json` dans le dossier AppData de Quran Caption.
fn exports_file_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    Ok(app_data_dir.join("exports.json"))
}

/// Lit les entrées persistées du monitor d'exports, ou retourne une liste vide si le fichier n'existe pas.
fn read_entries(file_path: &std::path::Path) -> Result<Vec<Value>, String> {
    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    serde_json::from_str::<Vec<Value>>(&content).map_err(|error| error.to_string())
}

/// Écrit le snapshot complet du monitor d'exports dans `exports.json`.
fn write_entries(file_path: &std::path::Path, entries: &[Value]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(entries).map_err(|error| error.to_string())?;
    fs::write(file_path, content).map_err(|error| error.to_string())
}

/// Diffuse le snapshot canonique du monitor à toutes les fenêtres du processus Tauri.
fn emit_snapshot(app_handle: &tauri::AppHandle, entries: &[Value]) -> Result<(), String> {
    app_handle
        .emit("export-monitor-sync", entries.to_vec())
        .map_err(|error| error.to_string())
}

/// Indique si une entrée correspond à un export vidéo actuellement actif.
fn is_active_video_export(entry: &Value) -> bool {
    if entry.get("exportKind").and_then(Value::as_str) != Some("Video") {
        return false;
    }

    entry
        .get("currentState")
        .and_then(Value::as_str)
        .map(|state| ACTIVE_VIDEO_STATES.contains(&state))
        .unwrap_or(false)
}

/// Indique si une entrée correspond à un export vidéo encore en attente dans la file FIFO.
fn is_pending_video_export(entry: &Value) -> bool {
    entry.get("exportKind").and_then(Value::as_str) == Some("Video")
        && entry.get("currentState").and_then(Value::as_str) == Some("Pending")
}

/// Fusionne uniquement les exports explicitement touchés par la fenêtre appelante.
/// La fusion et l'écriture sont sérialisées pour toutes les fenêtres du processus.
#[tauri::command]
pub fn merge_export_entries(
    app_handle: tauri::AppHandle,
    owned_export_ids: Vec<i64>,
    exports: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let lock = EXPORTS_FILE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Failed to lock export persistence".to_string())?;

    let file_path = exports_file_path(&app_handle)?;
    let mut existing = read_entries(&file_path)?;
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
    write_entries(&file_path, &merged)?;
    emit_snapshot(&app_handle, &merged)?;
    Ok(merged)
}

/// Réserve atomiquement le prochain export vidéo FIFO si aucun export vidéo n'est actif.
/// Toutes les fenêtres peuvent poller cette commande : une seule obtiendra un identifiant.
#[tauri::command]
pub fn claim_next_video_export(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let lock = EXPORTS_FILE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Failed to lock export persistence".to_string())?;

    let file_path = exports_file_path(&app_handle)?;
    let mut entries = read_entries(&file_path)?;

    if entries.iter().any(is_active_video_export) {
        return Ok(serde_json::json!({
            "exportId": Value::Null,
            "exports": entries,
        }));
    }

    let mut candidate: Option<(usize, String)> = None;
    for (index, entry) in entries.iter().enumerate() {
        if !is_pending_video_export(entry) {
            continue;
        }

        let date = entry
            .get("date")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if candidate
            .as_ref()
            .map(|(_, current_date)| date.as_str() < current_date.as_str())
            .unwrap_or(true)
        {
            candidate = Some((index, date));
        }
    }

    let Some((candidate_index, _)) = candidate else {
        return Ok(serde_json::json!({
            "exportId": Value::Null,
            "exports": entries,
        }));
    };

    let export_id = entries[candidate_index]
        .get("exportId")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Pending export has no valid exportId".to_string())?;

    let entry = entries[candidate_index]
        .as_object_mut()
        .ok_or_else(|| "Pending export is not an object".to_string())?;
    entry.insert(
        "currentState".to_string(),
        Value::String("Capturing Frames".to_string()),
    );
    entry.insert("percentageProgress".to_string(), Value::from(0));
    entry.insert("currentTreatedTime".to_string(), Value::from(0));

    write_entries(&file_path, &entries)?;
    emit_snapshot(&app_handle, &entries)?;

    Ok(serde_json::json!({
        "exportId": export_id,
        "exports": entries,
    }))
}