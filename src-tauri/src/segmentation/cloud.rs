use super::{
    audio_merge::merge_audio_clips_for_segmentation,
    types::{
        SegmentationAudioClip, QURAN_MULTI_ALIGNER_API_V1_URL, QURAN_SEGMENTATION_MOCK_PAYLOAD,
        QURAN_SEGMENTATION_USE_MOCK,
    },
};
use crate::{
    binaries, path_utils,
    utils::{process::configure_command_no_window, temp_file::TempFileGuard},
};
use bytes::Bytes;
use futures_util::{stream, StreamExt};
use reqwest::{
    multipart::{Form, Part},
    Client, Response,
};
use std::{
    cmp::min,
    fs,
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

fn emit_status(app: &tauri::AppHandle, step: &str, progress: Option<f64>) {
    let _ = app.emit(
        "segmentation-status",
        serde_json::json!({"step": step, "message": step, "progress": progress}),
    );
}
fn url(path: &str) -> String {
    format!("{}{}", QURAN_MULTI_ALIGNER_API_V1_URL, path)
}
fn validate_model(value: Option<String>) -> Result<String, String> {
    let value = value.unwrap_or_else(|| "Base".into());
    if matches!(value.as_str(), "Base" | "Large") {
        Ok(value)
    } else {
        Err(format!("Invalid model_name '{}'.", value))
    }
}
fn validate_device(value: Option<String>) -> Result<String, String> {
    let value = value.unwrap_or_else(|| "GPU".into()).to_uppercase();
    if matches!(value.as_str(), "GPU" | "CPU") {
        Ok(value)
    } else {
        Err(format!("Invalid device '{}'.", value))
    }
}
fn validate_riwayah(value: Option<String>) -> Result<String, String> {
    let value = value.unwrap_or_else(|| "hafs".into()).to_lowercase();
    if matches!(value.as_str(), "hafs" | "warsh" | "qalun" | "shuba") {
        Ok(value)
    } else {
        Err(format!("Invalid riwayah '{}'.", value))
    }
}
async fn error_text(response: Response, context: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(message) = value.get("message").and_then(|v| v.as_str()) {
            let code = value
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("api_error");
            return format!("{} ({} {}): {}", context, status, code, message);
        }
    }
    format!("{} ({}): {}", context, status, body)
}
async fn json(response: Response, context: &str) -> Result<serde_json::Value, String> {
    if !response.status().is_success() {
        return Err(error_text(response, context).await);
    }
    response
        .json()
        .await
        .map_err(|e| format!("Invalid {} response: {}", context, e))
}
fn client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Default)]
struct ApiSse {
    event: String,
    data: String,
    result: Option<serde_json::Value>,
}
impl ApiSse {
    fn line(
        &mut self,
        line: &str,
        app: &tauri::AppHandle,
    ) -> Result<Option<serde_json::Value>, String> {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            return self.flush(app);
        }
        if let Some(v) = line.strip_prefix("event:") {
            self.event = v.trim().into();
        } else if let Some(v) = line.strip_prefix("data:") {
            if !self.data.is_empty() {
                self.data.push('\n');
            }
            self.data.push_str(v.trim());
        }
        Ok(None)
    }
    fn flush(&mut self, app: &tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
        let event = std::mem::take(&mut self.event);
        let data = std::mem::take(&mut self.data);
        if data.trim().is_empty() || data.trim() == "[DONE]" {
            return Ok(None);
        }
        let value: serde_json::Value = serde_json::from_str(data.trim())
            .map_err(|e| format!("Invalid API stream event: {}", e))?;
        match event.as_str() {
            "progress" => {
                let stage = value
                    .get("stage")
                    .and_then(|v| v.as_str())
                    .unwrap_or("processing");
                let progress = match (
                    value.get("step").and_then(|v| v.as_f64()),
                    value.get("steps").and_then(|v| v.as_f64()),
                ) {
                    (Some(step), Some(steps)) if steps > 0.0 => {
                        Some((step / steps * 100.0).clamp(0.0, 100.0))
                    }
                    _ => None,
                };
                emit_status(app, stage, progress);
                Ok(None)
            }
            "result" => {
                self.result = Some(value.clone());
                Ok(Some(value))
            }
            "error" => {
                let code = value
                    .get("code")
                    .and_then(|v| v.as_str())
                    .unwrap_or("api_error");
                let message = value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Cloud alignment failed");
                Err(format!("Cloud alignment failed ({}): {}", code, message))
            }
            _ => Ok(None),
        }
    }
    fn finish(mut self, app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
        if let Some(value) = self.flush(app)? {
            return Ok(value);
        }
        self.result
            .ok_or_else(|| "API stream ended without a result event".into())
    }
}

fn prepared_audio(
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    window_start_ms: Option<i64>,
    window_end_ms: Option<i64>,
) -> Result<(std::path::PathBuf, TempFileGuard, Option<TempFileGuard>), String> {
    let ffmpeg =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let mut merged_guard = None;
    let source = if let Some(clips) = audio_clips.as_ref().filter(|v| !v.is_empty()) {
        let (path, guard) = merge_audio_clips_for_segmentation(&ffmpeg, clips)?;
        merged_guard = Some(guard);
        path
    } else if let Some(path) = audio_path.as_ref() {
        path_utils::normalize_existing_path(path)
    } else {
        return Err("Audio file not found: missing audioPath/audioClips".into());
    };
    if !source.exists() {
        return Err(format!(
            "Audio file not found: {}",
            source.to_string_lossy()
        ));
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let output_path = std::env::temp_dir().join(format!("qurancaption-mfa-{}.wav", stamp));
    let guard = TempFileGuard(output_path.clone());
    let window = match (window_start_ms, window_end_ms) {
        (Some(a), Some(b)) if b > a && a >= 0 => Some((a, b)),
        _ => None,
    };
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error"]);
    if let Some((start, _)) = window {
        cmd.arg("-ss").arg(format!("{:.3}", start as f64 / 1000.0));
    }
    cmd.arg("-i").arg(source);
    if let Some((start, end)) = window {
        cmd.arg("-t")
            .arg(format!("{:.3}", (end - start) as f64 / 1000.0));
    }
    cmd.args(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-vn"])
        .arg(&output_path);
    configure_command_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok((output_path, guard, merged_guard))
}

pub async fn mfa_timestamps_session(
    audio_id: String,
    segments: serde_json::Value,
    granularity: Option<String>,
) -> Result<serde_json::Value, String> {
    if audio_id.trim().is_empty() || !segments.is_array() {
        return Err("audio_id and a segments array are required.".into());
    }
    let response = client(Duration::from_secs(300))?.post(url(&format!("/sessions/{}/timestamps", audio_id)))
        .json(&serde_json::json!({"segments": segments, "granularity": granularity.unwrap_or_else(|| "words".into())}))
        .send().await.map_err(|e| format!("Session timestamps request failed: {}", e))?;
    json(response, "session timestamps").await
}
pub async fn preload_recitations() -> Result<serde_json::Value, String> {
    let response = client(Duration::from_secs(60))?
        .get(url("/recitations"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    json(response, "recitations catalog").await
}
pub async fn preload_segments(
    recitation: String,
    chapter: i64,
    verse_from: i64,
    verse_to: i64,
    include_timestamps: bool,
) -> Result<serde_json::Value, String> {
    let response = client(Duration::from_secs(120))?
        .get(url(&format!(
            "/recitations/{}/chapters/{}/segments",
            recitation, chapter
        )))
        .query(&[
            ("verse_from", verse_from.to_string()),
            ("verse_to", verse_to.to_string()),
            ("include_timestamps", include_timestamps.to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    json(response, "preload segments").await
}
pub async fn preload_audio_recitations() -> Result<serde_json::Value, String> {
    let response = client(Duration::from_secs(60))?
        .get(url("/audio-recitations"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    json(response, "audio recitations catalog").await
}
pub async fn preload_audio(recitation: String, chapter: i64) -> Result<serde_json::Value, String> {
    let response = client(Duration::from_secs(60))?
        .get(url(&format!(
            "/recitations/{}/chapters/{}/audio",
            recitation, chapter
        )))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    json(response, "preload audio").await
}
pub async fn mfa_timestamps_direct(
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    segments: serde_json::Value,
    granularity: Option<String>,
    riwayah: Option<String>,
    window_start_ms: Option<i64>,
    window_end_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    if !segments.is_array() {
        return Err("segments must be a JSON array.".into());
    }
    let (path, _guard, _merged) =
        prepared_audio(audio_path, audio_clips, window_start_ms, window_end_ms)?;
    let part = Part::bytes(fs::read(path).map_err(|e| e.to_string())?)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let selected_riwayah = validate_riwayah(riwayah)?;
    let form = Form::new()
        .part("audio", part)
        .text("segments", segments.to_string())
        .text("granularity", granularity.unwrap_or_else(|| "words".into()))
        .text("riwayah", selected_riwayah);
    let response = client(Duration::from_secs(300))?
        .post(url("/timestamps"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    json(response, "direct timestamps").await
}

pub async fn segment_quran_audio(
    app: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    model_name: Option<String>,
    device: Option<String>,
    riwayah: Option<String>,
    pad_left_ms: Option<u32>,
    pad_right_ms: Option<u32>,
) -> Result<serde_json::Value, String> {
    if QURAN_SEGMENTATION_USE_MOCK {
        return serde_json::from_str(QURAN_SEGMENTATION_MOCK_PAYLOAD).map_err(|e| e.to_string());
    }
    let model_name = validate_model(model_name)?;
    let requested_device = validate_device(device)?;
    let selected_riwayah = validate_riwayah(riwayah)?;
    let pad_left_ms = pad_left_ms.unwrap_or(100).min(1000);
    let pad_right_ms = pad_right_ms.unwrap_or(200).min(1000);
    emit_status(&app, "preparing", None);
    let ffmpeg =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let mut _merged_guard = None;
    let source = if let Some(clips) = audio_clips.as_ref().filter(|v| !v.is_empty()) {
        let (path, guard) = merge_audio_clips_for_segmentation(&ffmpeg, clips)?;
        _merged_guard = Some(guard);
        path
    } else if let Some(path) = audio_path.as_ref() {
        path_utils::normalize_existing_path(path)
    } else {
        return Err("Audio file not found: missing audioPath/audioClips".into());
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = std::env::temp_dir().join(format!("qurancaption-seg-{}.ogg", stamp));
    let _guard = TempFileGuard(path.clone());
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-vn"])
        .arg(&path);
    configure_command_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let bytes = Bytes::from(fs::read(path).map_err(|e| e.to_string())?);
    if bytes.is_empty() {
        return Err("Prepared audio is empty".into());
    }
    let length = bytes.len() as u64;
    emit_status(&app, "uploading", Some(0.0));
    let app_for_upload = app.clone();
    let body = stream::unfold((bytes, 0usize, 0u64), move |(bytes, offset, last)| {
        let app = app_for_upload.clone();
        async move {
            if offset >= bytes.len() {
                return None;
            }
            let end = min(offset + 256 * 1024, bytes.len());
            let chunk = bytes.slice(offset..end);
            let p = (end as f64 / bytes.len() as f64 * 100.0).min(100.0);
            let rounded = p.floor() as u64;
            if rounded > last {
                emit_status(&app, "uploading", Some(p));
            }
            Some((
                Ok::<Bytes, std::io::Error>(chunk),
                (bytes, end, rounded.max(last)),
            ))
        }
    });
    let part = Part::stream_with_length(reqwest::Body::wrap_stream(body), length)
        .file_name("audio.ogg")
        .mime_str("audio/ogg")
        .map_err(|e| e.to_string())?;
    let form = Form::new()
        .part("audio", part)
        .text("pad_left_ms", pad_left_ms.to_string())
        .text("pad_right_ms", pad_right_ms.to_string())
        .text("model_name", model_name)
        .text("device", requested_device)
        .text("riwayah", selected_riwayah);
    let http = client(Duration::from_secs(60 * 60))?;
    let response = http
        .post(url("/align/audio/stream"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Alignment request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(error_text(response, "alignment request").await);
    }
    let mut parser = ApiSse::default();
    let mut buffer = Vec::new();
    let mut result = None;
    let mut chunks = response.bytes_stream();
    'outer: while let Some(chunk) = chunks.next().await {
        buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
        while let Some(pos) = buffer.iter().position(|b| *b == b'\n') {
            let raw = buffer.drain(..=pos).collect::<Vec<_>>();
            let line = String::from_utf8_lossy(&raw[..raw.len() - 1]);
            if let Some(value) = parser.line(&line, &app)? {
                result = Some(value);
                break 'outer;
            }
        }
    }
    if result.is_none() && !buffer.is_empty() {
        result = parser.line(&String::from_utf8_lossy(&buffer), &app)?;
    }
    let result = match result {
        Some(value) => value,
        None => parser.finish(&app)?,
    };
    let audio_id = result
        .get("audio_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Alignment result did not include audio_id".to_string())?;
    emit_status(&app, "splitting", None);
    let response = http.post(url(&format!("/sessions/{}/split", audio_id))).json(&serde_json::json!({"max_verses":1,"max_words":null,"max_duration":null,"require_stop_sign":false})).send().await.map_err(|e| e.to_string())?;
    let mut split = json(response, "one-verse split").await?;
    if let (Some(split), Some(alignment)) = (split.as_object_mut(), result.as_object()) {
        for key in ["device"] {
            if let Some(value) = alignment.get(key) {
                split.insert(key.to_string(), value.clone());
            }
        }
    }
    Ok(split)
}

#[cfg(test)]
mod tests {
    use super::validate_riwayah;
    #[test]
    fn validates_riwayat() {
        for value in ["hafs", "warsh", "qalun", "shuba"] {
            assert_eq!(validate_riwayah(Some(value.into())).unwrap(), value);
        }
        assert!(validate_riwayah(Some("bad".into())).is_err());
    }
}
