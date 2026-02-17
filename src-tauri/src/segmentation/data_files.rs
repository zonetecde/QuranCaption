use std::fs;
use std::path::{Path, PathBuf};

use super::python_env::resolve_python_resource_path;

const LFS_POINTER_PREFIX: &[u8] = b"version https://git-lfs.github.com/spec/v1";

const MULTI_ALIGNER_DATA_FILES: [(&str, &str); 6] = [
    (
        "phoneme_cache.pkl",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_cache.pkl?download=true",
    ),
    (
        "phoneme_ngram_index_5.pkl",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_ngram_index_5.pkl?download=true",
    ),
    (
        "qpc_hafs.json",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/qpc_hafs.json?download=true",
    ),
    (
        "surah_info.json",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/surah_info.json?download=true",
    ),
    (
        "digital_khatt_v2_script.json",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/digital_khatt_v2_script.json?download=true",
    ),
    (
        "phoneme_sub_costs.json",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_sub_costs.json?download=true",
    ),
];

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
