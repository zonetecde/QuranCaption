use crate::segmentation;
use crate::segmentation::types::SegmentationAudioClip;

/// Lance une segmentation Quran cloud via l'API Multi-Aligner.
#[tauri::command]
pub async fn segment_quran_audio(
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio(
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        model_name,
        device,
    )
    .await
}

/// Vérifie la disponibilité des moteurs de segmentation locale.
#[tauri::command]
pub async fn check_local_segmentation_ready(
    app_handle: tauri::AppHandle,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::check_local_segmentation_ready(app_handle, hf_token).await
}

/// Installe les dépendances Python d'un moteur local (`legacy` ou `multi`).
#[tauri::command]
pub async fn install_local_segmentation_deps(
    app_handle: tauri::AppHandle,
    engine: String,
    hf_token: Option<String>,
) -> Result<String, String> {
    segmentation::install_local_segmentation_deps(app_handle, engine, hf_token).await
}

/// Lance la segmentation locale en mode legacy Whisper.
#[tauri::command]
pub async fn segment_quran_audio_local(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    whisper_model: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio_local(
        app_handle,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        whisper_model,
    )
    .await
}

/// Lance la segmentation locale en mode Multi-Aligner.
#[tauri::command]
pub async fn segment_quran_audio_local_multi(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio_local_multi(
        app_handle,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        model_name,
        device,
        hf_token,
    )
    .await
}
