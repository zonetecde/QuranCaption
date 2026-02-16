use std::fs;
use std::path::{Path, PathBuf};

use super::python_env::resolve_python_resource_path;

const LFS_POINTER_PREFIX: &[u8] = b"version https://git-lfs.github.com/spec/v1";

const MULTI_ALIGNER_DATA_FILES: [(&str, &str); 2] = [
    (
        "phoneme_cache.pkl",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_cache.pkl?download=true",
    ),
    (
        "phoneme_ngram_index_5.pkl",
        "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_ngram_index_5.pkl?download=true",
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

/// Vérifie qu'un fichier pickle est exploitable (ni pointeur LFS, ni fichier texte/corrompu).
pub(crate) fn validate_pickle_data_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Missing data file: {}", path.to_string_lossy()));
    }

    let head = fs::read(path)
        .map_err(|e| format!("Unable to read data file '{}': {}", path.to_string_lossy(), e))?;
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

