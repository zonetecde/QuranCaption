use std::time::Duration;

use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use serde_json::Value;

use crate::{binaries, path_utils, utils::process::configure_command_no_window};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    source_path: String,
    start_seconds: f64,
    duration_seconds: f64,
    provider: String,
    model: String,
    api_key: String,
    language: String,
}

/// Extrait une portion WAV mono bornée et l'envoie au fournisseur choisi sans journaliser la clé.
#[tauri::command]
pub async fn transcribe_audio_chunk(request: SpeechRequest) -> Result<Value, String> {
    let groq = request.provider == "groq";
    let valid_model = match request.provider.as_str() {
        "groq" => matches!(
            request.model.as_str(),
            "whisper-large-v3" | "whisper-large-v3-turbo"
        ),
        "elevenlabs" => matches!(request.model.as_str(), "scribe_v1" | "scribe_v2"),
        _ => false,
    };
    if !valid_model || request.api_key.trim().is_empty() {
        return Err("STT_SETTINGS".into());
    }
    if !request.start_seconds.is_finite()
        || request.start_seconds < 0.0
        || !request.duration_seconds.is_finite()
        || request.duration_seconds <= 0.0
        || request.duration_seconds > 600.0
    {
        return Err("STT_AUDIO".into());
    }
    let source = path_utils::normalize_existing_path(&request.source_path);
    let ffmpeg = binaries::resolve_binary_detailed("ffmpeg").map_err(|_| "STT_AUDIO")?;
    let mut command = tokio::process::Command::new(ffmpeg);
    command.args([
        "-v",
        "error",
        "-nostdin",
        "-ss",
        &request.start_seconds.to_string(),
        "-i",
    ]);
    command.arg(source);
    command.args([
        "-t",
        &request.duration_seconds.to_string(),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        "pipe:1",
    ]);
    configure_command_no_window(command.as_std_mut());
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(120), command.output())
        .await
        .map_err(|_| "STT_AUDIO")?
        .map_err(|_| "STT_AUDIO")?;
    if !output.status.success() || output.stdout.len() <= 44 || output.stdout.len() > 24_000_000 {
        return Err("STT_AUDIO".into());
    }
    let part = Part::bytes(output.stdout)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|_| "STT_AUDIO")?;
    let mut form = Form::new().part("file", part);
    form = if groq {
        form.text("model", request.model)
            .text("response_format", "verbose_json")
            .text("timestamp_granularities[]", "word")
            .text("temperature", "0")
    } else {
        form.text("model_id", request.model)
            .text("timestamps_granularity", "word")
            .text("tag_audio_events", "false")
    };
    if !request.language.trim().is_empty() {
        form = form.text(
            if groq { "language" } else { "language_code" },
            request.language.trim().to_owned(),
        );
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|_| "STT_NETWORK")?;
    let builder = if groq {
        client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .bearer_auth(request.api_key.trim())
    } else {
        client
            .post("https://api.elevenlabs.io/v1/speech-to-text")
            .header("xi-api-key", request.api_key.trim())
    };
    let response = builder
        .multipart(form)
        .send()
        .await
        .map_err(|_| "STT_NETWORK")?;
    if !response.status().is_success() {
        return Err(format!("STT_HTTP_{}", response.status().as_u16()));
    }
    response.json().await.map_err(|_| "STT_RESPONSE".into())
}
