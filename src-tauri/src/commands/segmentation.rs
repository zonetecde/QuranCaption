use crate::segmentation;
use crate::segmentation::types::{HifzAudioSegment, SegmentationAudioClip};

/// Lance une segmentation Quran cloud via l'API Multi-Aligner.
#[tauri::command]
pub async fn segment_quran_audio(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio(
        app_handle,
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

/// Estime la durÃ©e d'un endpoint Multi-Aligner cloud.
#[tauri::command]
pub async fn estimate_segmentation_duration(
    endpoint: String,
    audio_duration_s: f64,
    model_name: Option<String>,
    device: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::estimate_duration(endpoint, audio_duration_s, model_name, device).await
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
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    segments: serde_json::Value,
    granularity: Option<String>,
    window_start_ms: Option<i64>,
    window_end_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    segmentation::mfa_timestamps_direct(
        audio_path,
        audio_clips,
        segments,
        granularity,
        window_start_ms,
        window_end_ms,
    )
    .await
}

/// VÃ©rifie la disponibilitÃ© des moteurs de segmentation locale.
#[tauri::command]
pub async fn check_local_segmentation_ready(
    app_handle: tauri::AppHandle,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    segmentation::check_local_segmentation_ready(app_handle, hf_token).await
}

/// Installe les dÃ©pendances Python d'un moteur local (`legacy` ou `multi`).
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

/// Lance la segmentation locale en mode Offline Tarteel.
#[tauri::command]
pub async fn segment_quran_audio_local_muaalem(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
    include_wbw_timestamps: Option<bool>,
    multiple_surahs: Option<bool>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio_local_muaalem(
        app_handle,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        model_name,
        device,
        include_wbw_timestamps,
        multiple_surahs,
    )
    .await
}

/// Lance la segmentation locale en mode Surah Splitter.
#[tauri::command]
pub async fn segment_quran_audio_local_surah_splitter(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
    surah: Option<u32>,
    include_wbw_timestamps: Option<bool>,
) -> Result<serde_json::Value, String> {
    segmentation::segment_quran_audio_local_surah_splitter(
        app_handle,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        model_name,
        device,
        surah,
        include_wbw_timestamps,
    )
    .await
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
