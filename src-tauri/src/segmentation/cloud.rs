use std::cmp::min;
use std::fs;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use futures_util::stream;
use reqwest::multipart::{Form, Part};
use tauri::Emitter;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;
use crate::utils::temp_file::TempFileGuard;

use super::audio_merge::merge_audio_clips_for_segmentation;
use super::types::{
    SegmentationAudioClip, QURAN_MULTI_ALIGNER_BASE_URL, QURAN_MULTI_ALIGNER_PROCESS_CALL_URL,
    QURAN_MULTI_ALIGNER_UPLOAD_URL, QURAN_SEGMENTATION_MOCK_PAYLOAD, QURAN_SEGMENTATION_USE_MOCK,
};

/// Émet un état de progression de segmentation vers le frontend.
fn emit_cloud_status(
    app_handle: &tauri::AppHandle,
    step: &str,
    message: String,
    progress: Option<f64>,
) {
    let payload = serde_json::json!({
        "step": step,
        "message": message,
        "progress": progress,
    });
    let _ = app_handle.emit("segmentation-status", payload);
}

/// Parse le flux SSE brut Gradio et renvoie le payload final (événement `complete` prioritaire).
fn parse_process_stream_payload(sse_text: &str) -> Result<serde_json::Value, String> {
    let mut current_event = String::new();
    let mut current_data = String::new();
    let mut latest_payload: Option<serde_json::Value> = None;
    let mut complete_payload: Option<serde_json::Value> = None;

    for raw_line in sse_text.lines().chain(std::iter::once("")) {
        let line = raw_line.trim_end();
        if line.is_empty() {
            let data_block = current_data.trim();
            if !data_block.is_empty() {
                if data_block == "[DONE]" {
                    current_event.clear();
                    current_data.clear();
                    continue;
                }

                let payload: serde_json::Value = serde_json::from_str(data_block)
                    .map_err(|e| format!("Failed to parse process stream payload: {}", e))?;
                if current_event == "error" {
                    if let Some(error_message) =
                        payload.get("error").and_then(|value| value.as_str())
                    {
                        return Err(format!(
                            "Cloud segmentation stream error: {}",
                            error_message
                        ));
                    }
                    return Err(format!("Cloud segmentation stream error: {}", payload));
                }

                if !payload.is_null() {
                    latest_payload = Some(payload.clone());
                    if current_event == "complete" {
                        complete_payload = Some(payload);
                    }
                }
            }

            current_event.clear();
            current_data.clear();
            continue;
        }

        if let Some(event_value) = line.strip_prefix("event:") {
            current_event = event_value.trim().to_string();
            continue;
        }
        if let Some(data_value) = line.strip_prefix("data:") {
            if !current_data.is_empty() {
                current_data.push('\n');
            }
            current_data.push_str(data_value.trim());
        }
    }

    complete_payload
        .or(latest_payload)
        .ok_or_else(|| "Process stream ended without a result".to_string())
}

/// Exécute la segmentation cloud via Quran Multi-Aligner (upload, call, stream SSE).
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
    if QURAN_SEGMENTATION_USE_MOCK {
        return serde_json::from_str(QURAN_SEGMENTATION_MOCK_PAYLOAD)
            .map_err(|e| format!("Mock segmentation JSON invalid: {}", e));
    }

    emit_cloud_status(
        &app_handle,
        "cloud_prepare",
        "Preparing audio for cloud...".to_string(),
        Some(0.0),
    );

    // Pré-traitement cloud: merge éventuel puis encodage FLAC (pas de resample forcé).
    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let mut _merged_guard: Option<TempFileGuard> = None;
    let audio_path = if let Some(clips) = audio_clips.as_ref().filter(|c| !c.is_empty()) {
        println!(
            "[segmentation] Merging {} audio clip(s) for cloud segmentation",
            clips.len()
        );
        for (idx, clip) in clips.iter().enumerate() {
            println!(
                "[segmentation] clip[{}] path={} start_ms={} end_ms={}",
                idx, clip.path, clip.start_ms, clip.end_ms
            );
        }
        let needs_merge = clips.len() > 1 || clips[0].start_ms > 0;
        if needs_merge {
            let (merged_path, guard) = merge_audio_clips_for_segmentation(&ffmpeg_path, clips)?;
            _merged_guard = Some(guard);
            println!(
                "[segmentation] Using merged audio for cloud: {}",
                merged_path.to_string_lossy()
            );
            merged_path
        } else {
            path_utils::normalize_existing_path(&clips[0].path)
        }
    } else if let Some(path) = audio_path.as_ref() {
        path_utils::normalize_existing_path(path)
    } else {
        return Err("Audio file not found: missing audioPath/audioClips".to_string());
    };

    let audio_path_str = audio_path.to_string_lossy().to_string();
    if !audio_path.exists() {
        return Err(format!("Audio file not found: {}", audio_path_str));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!("qurancaption-seg-{}.flac", stamp));
    let _temp_guard = TempFileGuard(temp_path.clone());

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &audio_path_str,
        "-c:a",
        "flac",
        "-vn",
        temp_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr));
    }
    emit_cloud_status(
        &app_handle,
        "cloud_prepare",
        "Audio prepared. Starting upload...".to_string(),
        Some(0.0),
    );

    let audio_bytes =
        fs::read(&temp_path).map_err(|e| format!("Failed to read FLAC audio: {}", e))?;
    let total_bytes = audio_bytes.len() as u64;
    if total_bytes == 0 {
        return Err("Cloud upload payload is empty after preprocessing".to_string());
    }
    let total_mb = total_bytes as f64 / (1024.0 * 1024.0);
    emit_cloud_status(
        &app_handle,
        "cloud_upload",
        format!("Uploading {:.1} MB to cloud...", total_mb),
        Some(0.0),
    );

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let bytes = Bytes::from(audio_bytes);
    let upload_chunk_size: usize = 256 * 1024;
    let upload_app_handle = app_handle.clone();
    let upload_stream = stream::unfold((bytes, 0usize, 0u64), move |state| {
        let app_handle = upload_app_handle.clone();
        async move {
            let (bytes, offset, last_percent) = state;
            if offset >= bytes.len() {
                return None;
            }

            let end = min(offset + upload_chunk_size, bytes.len());
            let chunk = bytes.slice(offset..end);
            let percent = ((end as f64 / bytes.len() as f64) * 100.0).min(100.0);
            let rounded_percent = percent.floor() as u64;
            if rounded_percent > last_percent {
                emit_cloud_status(
                    &app_handle,
                    "cloud_upload",
                    format!(
                        "Uploading {:.1} MB to cloud... {}%",
                        total_mb, rounded_percent
                    ),
                    Some(percent),
                );
            }

            Some((
                Ok::<Bytes, std::io::Error>(chunk),
                (bytes, end, rounded_percent.max(last_percent)),
            ))
        }
    });
    let upload_body = reqwest::Body::wrap_stream(upload_stream);
    let upload_part = Part::stream_with_length(upload_body, total_bytes)
        .file_name("audio.flac")
        .mime_str("audio/flac")
        .map_err(|e| e.to_string())?;
    let upload_form = Form::new().part("files", upload_part);

    let upload_response = client
        .post(QURAN_MULTI_ALIGNER_UPLOAD_URL)
        .multipart(upload_form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Upload request error: {}", e))?;
    emit_cloud_status(
        &app_handle,
        "cloud_upload",
        "Cloud upload complete. Starting segmentation...".to_string(),
        Some(100.0),
    );

    let uploaded_paths: Vec<String> = upload_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload response: {}", e))?;
    let uploaded_path = uploaded_paths
        .first()
        .ok_or_else(|| "Upload response was empty".to_string())?;

    let selected_model = model_name.unwrap_or_else(|| "Base".to_string());
    if selected_model != "Base" && selected_model != "Large" {
        return Err(format!(
            "Invalid model_name '{}'. Expected 'Base' or 'Large'.",
            selected_model
        ));
    }

    let selected_device = device.unwrap_or_else(|| "GPU".to_string()).to_uppercase();
    if selected_device != "GPU" && selected_device != "CPU" {
        return Err(format!(
            "Invalid device '{}'. Expected 'GPU' or 'CPU'.",
            selected_device
        ));
    }

    let file_payload = serde_json::json!({
        "path": uploaded_path,
        "orig_name": "audio.flac",
        "mime_type": "audio/flac",
        "meta": { "_type": "gradio.FileData" }
    });
    let call_payload = serde_json::json!({
        "data": [
            file_payload,
            min_silence_ms.unwrap_or(200),
            min_speech_ms.unwrap_or(1000),
            pad_ms.unwrap_or(100),
            selected_model,
            selected_device
        ]
    });

    let call_response = client
        .post(QURAN_MULTI_ALIGNER_PROCESS_CALL_URL)
        .json(&call_payload)
        .send()
        .await
        .map_err(|e| format!("Process call failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Process call error: {}", e))?;
    emit_cloud_status(
        &app_handle,
        "cloud_process",
        "Cloud job accepted. Waiting for segmentation results...".to_string(),
        Some(100.0),
    );
    let call_json: serde_json::Value = call_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse process call response: {}", e))?;

    let event_id = call_json
        .get("event_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Process call did not return an event_id".to_string())?;

    let stream_url = format!(
        "{}/call/process_audio_session/{}",
        QURAN_MULTI_ALIGNER_BASE_URL, event_id
    );
    let sse_text = client
        .get(&stream_url)
        .send()
        .await
        .map_err(|e| format!("Process stream request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read process stream: {}", e))?;

    let payload = parse_process_stream_payload(&sse_text)?;
    emit_cloud_status(
        &app_handle,
        "cloud_complete",
        "Cloud segmentation completed.".to_string(),
        None,
    );
    if let Some(values) = payload.as_array() {
        if let Some(first) = values.first() {
            return Ok(first.clone());
        }
    }
    Ok(payload)
}
