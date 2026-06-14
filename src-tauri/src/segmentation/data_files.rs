use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use futures_util::StreamExt;
use tauri::{Emitter, Manager};

use crate::utils::process::configure_command_no_window;

use super::python_env::resolve_python_resource_path;

const LFS_POINTER_PREFIX: &[u8] = b"version https://git-lfs.github.com/spec/v1";

const MULTI_ALIGNER_DATA_FILES: [(&str, &str); 6] = [
    (
        "phoneme_cache.pkl",
        "https://media.githubusercontent.com/media/zonetecde/QuranCaption/main/src-tauri/python/quran-multi-aligner/data/phoneme_cache.pkl",
    ),
    (
        "phoneme_ngram_index_5.pkl",
        "https://media.githubusercontent.com/media/zonetecde/QuranCaption/main/src-tauri/python/quran-multi-aligner/data/phoneme_ngram_index_5.pkl",
    ),
    (
        "qpc_hafs.json",
        "https://media.githubusercontent.com/media/zonetecde/QuranCaption/main/src-tauri/python/quran-multi-aligner/data/qpc_hafs.json",
    ),
    (
        "surah_info.json",
        "https://raw.githubusercontent.com/zonetecde/QuranCaption/main/src-tauri/python/quran-multi-aligner/data/surah_info.json",
    ),
    (
        "digital_khatt_v2_script.json",
        "https://media.githubusercontent.com/media/zonetecde/QuranCaption/main/src-tauri/python/quran-multi-aligner/data/digital_khatt_v2_script.json",
    ),
    (
        "phoneme_sub_costs.json",
        "https://raw.githubusercontent.com/zonetecde/QuranCaption/main/src-tauri/python/quran-multi-aligner/data/phoneme_sub_costs.json",
    ),
];

const SURAH_SPLITTER_MODEL_URL: &str =
    "https://github.com/yazinsai/offline-tarteel/releases/download/v0.1.0/fastconformer_ar_ctc_q8.onnx";
const SURAH_SPLITTER_MODEL_FILE_NAME: &str = "model.onnx";
const SURAH_SPLITTER_MODEL_EXPECTED_SIZE: u64 = 131_652_337;
const SURAH_SPLITTER_STATIC_DATA_FILES: [&str; 2] = ["vocab.json", "quran.json"];

/// Résout le dossier `data` du code Python Multi-Aligner embarqué.
pub(crate) fn resolve_multi_aligner_data_dir(
    app_handle: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    resolve_python_resource_path(app_handle, "python/quran-multi-aligner/data")
}

/// Retourne la liste des fichiers data Multi-Aligner obligatoires.
pub(crate) fn required_multi_aligner_data_files() -> &'static [(&'static str, &'static str)] {
    &MULTI_ALIGNER_DATA_FILES
}

/// Vérifie si un buffer représente un pointeur Git LFS au lieu d'un vrai binaire.
fn is_lfs_pointer(bytes: &[u8]) -> bool {
    bytes.starts_with(LFS_POINTER_PREFIX)
}

/// Vérifie si un buffer ressemble au header d'un pickle Python.
fn has_pickle_header(bytes: &[u8]) -> bool {
    bytes.first().copied() == Some(0x80)
}

/// Vérifie si un buffer ressemble au début d'un JSON texte.
fn has_json_header(bytes: &[u8]) -> bool {
    let mut idx = 0usize;
    while idx < bytes.len() {
        let b = bytes[idx];
        if matches!(b, b' ' | b'\n' | b'\r' | b'\t') {
            idx += 1;
            continue;
        }
        return b == b'{' || b == b'[';
    }
    false
}

/// Vérifie qu'un fichier pickle est exploitable (ni pointeur LFS, ni fichier texte/corrompu).
pub(crate) fn validate_pickle_data_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Missing data file: {}", path.to_string_lossy()));
    }

    let head = fs::read(path).map_err(|e| {
        format!(
            "Unable to read data file '{}': {}",
            path.to_string_lossy(),
            e
        )
    })?;
    let head = &head[..head.len().min(128)];

    if is_lfs_pointer(head) {
        return Err(format!(
            "Data file '{}' is a Git LFS pointer, not real binary data.",
            path.to_string_lossy()
        ));
    }

    if !has_pickle_header(head) {
        return Err(format!(
            "Data file '{}' is not a valid pickle binary.",
            path.to_string_lossy()
        ));
    }

    Ok(())
}

/// Vérifie qu'un fichier JSON est exploitable (ni pointeur LFS, ni fichier vide/invalide).
fn validate_json_data_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Missing data file: {}", path.to_string_lossy()));
    }

    let bytes = fs::read(path).map_err(|e| {
        format!(
            "Unable to read data file '{}': {}",
            path.to_string_lossy(),
            e
        )
    })?;
    let head = &bytes[..bytes.len().min(256)];

    if is_lfs_pointer(head) {
        return Err(format!(
            "Data file '{}' is a Git LFS pointer, not real JSON data.",
            path.to_string_lossy()
        ));
    }

    if !has_json_header(head) {
        return Err(format!(
            "Data file '{}' does not look like valid JSON.",
            path.to_string_lossy()
        ));
    }

    serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| {
        format!(
            "Data file '{}' is invalid JSON: {}",
            path.to_string_lossy(),
            e
        )
    })?;

    Ok(())
}

/// Vérifie qu'un fichier data multi-aligner est valide selon son extension.
pub(crate) fn validate_multi_aligner_data_file(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension == "pkl" {
        return validate_pickle_data_file(path);
    }

    if extension == "json" {
        return validate_json_data_file(path);
    }

    Err(format!(
        "Unsupported Multi-Aligner data file type for '{}'",
        path.to_string_lossy()
    ))
}

/// Résout le dossier cache data du moteur Surah Splitter ONNX.
pub(crate) fn resolve_surah_splitter_data_dir(
    app_handle: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("surah_splitter").join("data"))
}

/// Copie les fichiers JSON statiques Surah Splitter dans le cache app.
pub(crate) fn ensure_surah_splitter_static_data(
    app_handle: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let data_dir = resolve_surah_splitter_data_dir(app_handle)?;
    fs::create_dir_all(&data_dir).map_err(|e| {
        format!(
            "Failed to create Surah Splitter data directory '{}': {}",
            data_dir.to_string_lossy(),
            e
        )
    })?;

    for file_name in SURAH_SPLITTER_STATIC_DATA_FILES {
        let source = resolve_python_resource_path(
            app_handle,
            &format!("python/surah_splitter/data/{}", file_name),
        )?;
        let destination = data_dir.join(file_name);
        if !destination.exists() {
            fs::copy(&source, &destination).map_err(|e| {
                format!(
                    "Failed to copy Surah Splitter data file '{}' to '{}': {}",
                    source.to_string_lossy(),
                    destination.to_string_lossy(),
                    e
                )
            })?;
        }
    }

    Ok(data_dir)
}

/// Vérifie rapidement que le modèle ONNX Surah Splitter est exploitable.
fn validate_surah_splitter_model_file(path: &Path, python_exe: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Missing model file: {}", path.to_string_lossy()));
    }

    let metadata = fs::metadata(path).map_err(|e| {
        format!(
            "Unable to read model metadata '{}': {}",
            path.to_string_lossy(),
            e
        )
    })?;
    if metadata.len() != SURAH_SPLITTER_MODEL_EXPECTED_SIZE {
        return Err(format!(
            "Invalid model size for '{}': expected {} bytes, got {} bytes",
            path.to_string_lossy(),
            SURAH_SPLITTER_MODEL_EXPECTED_SIZE,
            metadata.len()
        ));
    }

    let script = format!(
        "import onnxruntime as ort; ort.InferenceSession(r'''{}''', providers=['CPUExecutionProvider'])",
        path.to_string_lossy()
    );
    let mut cmd = Command::new(python_exe);
    cmd.args(["-c", &script]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| {
        format!(
            "Failed to validate Surah Splitter ONNX model with Python: {}",
            e
        )
    })?;
    if !output.status.success() {
        return Err(format!(
            "Surah Splitter ONNX model is invalid: {}",
            crate::utils::process::sanitize_cmd_error(&output)
        ));
    }

    Ok(())
}

/// Télécharge le modèle ONNX Surah Splitter avec progression et écriture atomique.
async fn download_surah_splitter_model(
    app_handle: &tauri::AppHandle,
    destination: &Path,
) -> Result<(), String> {
    let partial_path = destination.with_extension("onnx.partial");
    if partial_path.exists() {
        fs::remove_file(&partial_path).map_err(|e| {
            format!(
                "Failed to remove interrupted download '{}': {}",
                partial_path.to_string_lossy(),
                e
            )
        })?;
    }

    let response = reqwest::get(SURAH_SPLITTER_MODEL_URL)
        .await
        .map_err(|e| format!("Failed to download Surah Splitter model: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download Surah Splitter model: HTTP {}",
            response.status()
        ));
    }

    let total_size = response
        .content_length()
        .unwrap_or(SURAH_SPLITTER_MODEL_EXPECTED_SIZE);
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file = fs::File::create(&partial_path).map_err(|e| {
        format!(
            "Failed to create partial model file '{}': {}",
            partial_path.to_string_lossy(),
            e
        )
    })?;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to download model chunk: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| {
            format!(
                "Failed to write model chunk to '{}': {}",
                partial_path.to_string_lossy(),
                e
            )
        })?;
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0).clamp(0.0, 99.0)
        } else {
            0.0
        };
        let _ = app_handle.emit(
            "segmentation-status",
            serde_json::json!({
                "step": "download",
                "message": "Downloading Surah Splitter ONNX model...",
                "progress": progress
            }),
        );
    }

    drop(file);
    let downloaded_size = fs::metadata(&partial_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if downloaded_size != SURAH_SPLITTER_MODEL_EXPECTED_SIZE {
        let _ = fs::remove_file(&partial_path);
        return Err(format!(
            "Downloaded Surah Splitter model is incomplete: expected {} bytes, got {} bytes",
            SURAH_SPLITTER_MODEL_EXPECTED_SIZE, downloaded_size
        ));
    }

    if destination.exists() {
        fs::remove_file(destination).map_err(|e| {
            format!(
                "Failed to replace old Surah Splitter model '{}': {}",
                destination.to_string_lossy(),
                e
            )
        })?;
    }
    fs::rename(&partial_path, destination).map_err(|e| {
        format!(
            "Failed to finalize Surah Splitter model download '{}': {}",
            destination.to_string_lossy(),
            e
        )
    })?;

    let _ = app_handle.emit(
        "segmentation-status",
        serde_json::json!({
            "step": "download",
            "message": "Surah Splitter ONNX model downloaded.",
            "progress": 100
        }),
    );

    Ok(())
}

/// Prépare et valide le modèle ONNX Surah Splitter avant une segmentation.
pub(crate) async fn ensure_surah_splitter_model(
    app_handle: &tauri::AppHandle,
    python_exe: &Path,
) -> Result<PathBuf, String> {
    let data_dir = ensure_surah_splitter_static_data(app_handle)?;
    let model_path = data_dir.join(SURAH_SPLITTER_MODEL_FILE_NAME);

    if validate_surah_splitter_model_file(&model_path, python_exe).is_ok() {
        return Ok(data_dir);
    }

    if model_path.exists() {
        fs::remove_file(&model_path).map_err(|e| {
            format!(
                "Failed to remove invalid Surah Splitter model '{}': {}",
                model_path.to_string_lossy(),
                e
            )
        })?;
    }

    download_surah_splitter_model(app_handle, &model_path).await?;
    validate_surah_splitter_model_file(&model_path, python_exe)?;
    Ok(data_dir)
}
