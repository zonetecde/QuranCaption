use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::python_env::resolve_python_resource_path;
use super::types::LocalSegmentationEngine;

const LFS_POINTER_PREFIX: &[u8] = b"version https://git-lfs.github.com/spec/v1";

const WORD_TIMING_MODEL_FILES: [(&str, &str, usize, &str); 2] = [
    (
        "zipformer_p_arabic_v3.int8.onnx",
        "https://github.com/Iam-Muslim/Natlu/releases/download/models-latest/zipformer_p_arabic_v3.int8.onnx",
        72_705_392,
        "6a5ddafa9c5e5c01260d30264031b341785bdc152e9ef1d569b41c8c278508eb",
    ),
    (
        "silero_vad_half.onnx",
        "https://raw.githubusercontent.com/snakers4/silero-vad/1e261b036686cd0017d500ee96acd1c4ba572a9d/src/silero_vad/data/silero_vad_half.onnx",
        1_280_395,
        "1e0b195ad4806595ef4466f419d16fca7e4afcfc6669b8c0b5f76ea87547c769",
    ),
];

const OLD_WORD_TIMING_MODEL_FILES: [(&str, &str, usize, &str); 1] = [(
    "qurankarim-fastconformer-mixed.onnx",
    "https://github.com/Iam-Muslim/QuranReciteToText/releases/download/model/qurankarim-fastconformer-mixed.onnx",
    86_983_112,
    "e564c8b4ce93ec3e83190ab590caeb093be519133f16864cb611a495fdf48e6b",
)];

/// Retourne les modèles requis par le moteur WordTiming hors ligne.
pub(crate) fn required_word_timing_model_files(
    engine: LocalSegmentationEngine,
) -> &'static [(&'static str, &'static str, usize, &'static str)] {
    match engine {
        LocalSegmentationEngine::QuranWordTimingOld => &OLD_WORD_TIMING_MODEL_FILES,
        _ => &WORD_TIMING_MODEL_FILES,
    }
}

/// Vérifie la taille et l'empreinte SHA-256 d'un modèle WordTiming téléchargé.
pub(crate) fn validate_word_timing_model_file(
    path: &Path,
    expected_size: usize,
    expected_hash: &str,
) -> Result<(), String> {
    let bytes =
        fs::read(path).map_err(|e| format!("Failed to read model '{}': {}", path.display(), e))?;
    if bytes.len() != expected_size || format!("{:x}", Sha256::digest(&bytes)) != expected_hash {
        return Err(format!(
            "WordTiming model '{}' is missing or invalid",
            path.display()
        ));
    }
    Ok(())
}


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
