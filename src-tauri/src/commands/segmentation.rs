use crate::segmentation;
use crate::segmentation::types::{HifzAudioSegment, SegmentationAudioClip};

/// Lance une segmentation Quran cloud via l'API Multi-Aligner.
#[tauri::command]
pub async fn segment_quran_audio(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    model_name: Option<String>,
    device: Option<String>,
    riwayah: Option<String>,
    pad_left_ms: Option<u32>,
    pad_right_ms: Option<u32>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio(
        app_handle,
        audio_path,
        audio_clips,
        model_name,
        device,
        riwayah,
        pad_left_ms,
        pad_right_ms,
    )
    .await
}

/// RÃ©cupÃ¨re les timestamps MFA en rÃ©utilisant une session cloud existante.
#[tauri::command]
pub async fn get_segmentation_mfa_timestamps_session(
    audio_id: String,
    segments: serde_json::Value,
    granularity: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::mfa_timestamps_session(audio_id, segments, granularity).await
}

/// RÃ©cupÃ¨re les timestamps MFA directement depuis l'audio courant du projet.
#[tauri::command]
pub async fn get_segmentation_mfa_timestamps_direct(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    segments: serde_json::Value,
    granularity: Option<String>,
    riwayah: Option<String>,
    window_start_ms: Option<i64>,
    window_end_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    segmentation::mfa_timestamps_direct(
        app_handle,
        audio_path,
        audio_clips,
        segments,
        granularity,
        riwayah,
        window_start_ms,
        window_end_ms,
    )
    .await
}

/// Liste les récitations Preload disponibles (catalogue + chapitres) côté cloud.
#[tauri::command]
pub async fn preload_recitations() -> Result<serde_json::Value, String> {
    segmentation::preload_recitations().await
}

/// Récupère les segments pré-alignés (+ timestamps mot à mot) d'une récitation/chapitre Preload.
#[tauri::command]
pub async fn preload_segments(
    recitation: String,
    chapter: i64,
    verse_from: i64,
    verse_to: i64,
    include_timestamps: Option<bool>,
) -> Result<serde_json::Value, String> {
    segmentation::preload_segments(
        recitation,
        chapter,
        verse_from,
        verse_to,
        include_timestamps.unwrap_or(true),
    )
    .await
}

/// Liste les récitations audio-only (non publiées, audio seul) côté cloud.
#[tauri::command]
pub async fn preload_audio_recitations() -> Result<serde_json::Value, String> {
    segmentation::preload_audio_recitations().await
}

/// Récupère l'URL audio directe d'un chapitre audio-only (sans segments).
#[tauri::command]
pub async fn preload_audio(recitation: String, chapter: i64) -> Result<serde_json::Value, String> {
    segmentation::preload_audio(recitation, chapter).await
}

/// Genere une nouvelle piste audio Hifz en repetant chaque segment fourni.
#[tauri::command]
pub async fn generate_hifz_audio(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    segments: Vec<HifzAudioSegment>,
    output_path: String,
) -> Result<segmentation::GeneratedHifzAudio, String> {
    segmentation::generate_hifz_audio(app_handle, audio_path, audio_clips, segments, output_path)
        .await
}
