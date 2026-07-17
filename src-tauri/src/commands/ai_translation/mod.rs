use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use tauri::Manager;

use crate::commands::ai_translation::prompts::is_openrouter_endpoint;

use self::sse::{
    extract_chat_completion_delta, extract_chat_completion_reasoning_delta,
    extract_chat_completion_usage, extract_completed_output_text, SseAccumulator,
};

pub(crate) mod bold;
pub(crate) mod prompts;
pub(crate) mod sse;
pub(crate) mod transcript_cleanup;
pub(crate) mod translate;
pub(crate) mod trim;
pub(crate) mod types;
pub(crate) mod wbw_translation;

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

/// Vérifie que le modèle n'est pas vide.
pub(crate) fn validate_model(model: &str) -> Result<(), String> {
    match model.trim() {
        "" => Err("Model is required.".to_string()),
        _ => Ok(()),
    }
}

/// Vérifie que l'effort de raisonnement est une valeur supportée.
pub(crate) fn validate_reasoning_effort(reasoning_effort: &str) -> Result<(), String> {
    match reasoning_effort {
        "none" | "low" | "medium" | "high" => Ok(()),
        _ => Err(format!(
            "Unsupported reasoning_effort '{}'. Expected none, low, medium, or high.",
            reasoning_effort
        )),
    }
}

// ---------------------------------------------------------------------------
// Usage normalization
// ---------------------------------------------------------------------------

/// Normalise les métriques d'usage entre formats Chat Completions et Responses.
pub(crate) fn normalize_usage(usage: &Value) -> Value {
    json!({
        "inputTokens": usage
            .get("input_tokens")
            .or_else(|| usage.get("prompt_tokens"))
            .and_then(Value::as_u64),
        "outputTokens": usage
            .get("output_tokens")
            .or_else(|| usage.get("completion_tokens"))
            .and_then(Value::as_u64),
        "totalTokens": usage.get("total_tokens").and_then(Value::as_u64),
        "reasoningTokens": usage
            .get("output_tokens_details")
            .or_else(|| usage.get("completion_tokens_details"))
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
    })
}

// ---------------------------------------------------------------------------
// Shared streaming
// ---------------------------------------------------------------------------

/// Callbacks d'émission spécifiques à chaque type d'opération IA.
pub(crate) struct AiStreamCallbacks {
    pub emit_status: fn(&tauri::AppHandle, &str, &str, &str),
    pub emit_chunk: fn(&tauri::AppHandle, &str, &str, &str),
    pub emit_reasoning: Option<fn(&tauri::AppHandle, &str, &str, &str)>,
}

/// Paramètres d'une requête de streaming IA.
pub(crate) struct AiStreamRequest<'a> {
    pub app_handle: &'a tauri::AppHandle,
    pub operation: &'a str,
    pub batch_id: &'a str,
    pub api_key: &'a str,
    pub endpoint: &'a str,
    pub is_chat_completions: bool,
    pub body: &'a Value,
    pub callbacks: &'a AiStreamCallbacks,
    pub generating_message: &'a str,
}

/// Ajoute un échange IA complet au journal JSONL local sans jamais enregistrer la clé API.
fn append_ai_exchange_log(
    app_handle: &tauri::AppHandle,
    operation: &str,
    batch_id: &str,
    endpoint: &str,
    body: &Value,
    reasoning: &str,
    response: &str,
    usage: Option<&Value>,
    error: Option<&str>,
) -> Result<(), String> {
    let log_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|path_error| path_error.to_string())?
        .join("logs");
    fs::create_dir_all(&log_dir).map_err(|create_error| {
        format!(
            "Failed to create AI log directory '{}': {}",
            log_dir.to_string_lossy(),
            create_error
        )
    })?;
    let timestamp_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let entry = json!({
        "timestampUnixMs": timestamp_unix_ms,
        "operation": operation,
        "batchId": batch_id,
        "endpoint": endpoint,
        "request": body,
        "reasoning": reasoning,
        "response": response,
        "usage": usage,
        "error": error
    });
    let serialized = serde_json::to_string(&entry).map_err(|serialize_error| {
        format!("Failed to serialize AI log entry: {}", serialize_error)
    })?;
    let log_path = log_dir.join("ai-exchanges.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|open_error| {
            format!(
                "Failed to open AI log file '{}': {}",
                log_path.to_string_lossy(),
                open_error
            )
        })?;
    writeln!(file, "{}", serialized).map_err(|write_error| {
        format!(
            "Failed to write AI log file '{}': {}",
            log_path.to_string_lossy(),
            write_error
        )
    })
}

/// Enregistre un échange sans interrompre le workflow lorsque le journal est indisponible.
fn append_ai_exchange_log_non_fatal(
    app_handle: &tauri::AppHandle,
    operation: &str,
    batch_id: &str,
    endpoint: &str,
    body: &Value,
    reasoning: &str,
    response: &str,
    usage: Option<&Value>,
    error: Option<&str>,
) {
    if let Err(log_error) = append_ai_exchange_log(
        app_handle, operation, batch_id, endpoint, body, reasoning, response, usage, error,
    ) {
        eprintln!("Failed to persist text AI exchange log: {}", log_error);
    }
}

/// Envoie la requête HTTP et diffuse la réponse SSE vers le frontend.
///
/// Retourne le texte brut accumulé et l'usage optionnel.
pub(crate) async fn stream_ai_response(
    request: AiStreamRequest<'_>,
) -> Result<(String, Option<Value>), String> {
    let AiStreamRequest {
        app_handle,
        operation,
        batch_id,
        api_key,
        endpoint,
        is_chat_completions,
        body,
        callbacks,
        generating_message,
    } = request;
    (callbacks.emit_status)(
        app_handle,
        batch_id,
        "queued",
        "Queued for text AI provider.",
    );

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("Failed to build text AI HTTP client: {}", error))?;

    (callbacks.emit_status)(
        app_handle,
        batch_id,
        "sending",
        "Sending batch to text AI provider...",
    );

    let request_builder = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json");
    let request_builder = if is_openrouter_endpoint(endpoint) {
        request_builder
            .header("HTTP-Referer", "https://qurancaption.app")
            .header("X-OpenRouter-Title", "MinbarStudio")
    } else {
        request_builder
    };

    let response = match request_builder.json(body).send().await {
        Ok(response) => response,
        Err(request_error) => {
            let message = format!("Text AI request failed: {}", request_error);
            append_ai_exchange_log_non_fatal(
                app_handle,
                operation,
                batch_id,
                endpoint,
                body,
                "",
                "",
                None,
                Some(&message),
            );
            return Err(message);
        }
    };

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        let message = format!("Text AI API error ({}): {}", status.as_u16(), error_body);
        append_ai_exchange_log_non_fatal(
            app_handle,
            operation,
            batch_id,
            endpoint,
            body,
            "",
            &error_body,
            None,
            Some(&message),
        );
        (callbacks.emit_status)(app_handle, batch_id, "failed", &message);
        return Err(message);
    }

    let mut accumulator = SseAccumulator::default();
    let mut buffered_bytes: Vec<u8> = Vec::new();
    let mut raw_text = String::new();
    let mut reasoning_text = String::new();
    let mut usage: Option<Value> = None;
    let mut stream = response.bytes_stream();
    let mut saw_streaming_chunk = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(chunk) => chunk,
            Err(stream_error) => {
                let message = format!("Failed to read text AI stream: {}", stream_error);
                append_ai_exchange_log_non_fatal(
                    app_handle,
                    operation,
                    batch_id,
                    endpoint,
                    body,
                    &reasoning_text,
                    &raw_text,
                    usage.as_ref(),
                    Some(&message),
                );
                return Err(message);
            }
        };
        if chunk.is_empty() {
            continue;
        }

        buffered_bytes.extend_from_slice(&chunk);

        while let Some(newline_pos) = buffered_bytes.iter().position(|byte| *byte == b'\n') {
            let line_bytes = buffered_bytes.drain(..=newline_pos).collect::<Vec<u8>>();
            let mut line_slice = line_bytes.as_slice();
            if line_slice.ends_with(b"\n") {
                line_slice = &line_slice[..line_slice.len() - 1];
            }
            if line_slice.ends_with(b"\r") {
                line_slice = &line_slice[..line_slice.len() - 1];
            }

            let line = String::from_utf8_lossy(line_slice);
            let maybe_payload = accumulator.push_line(&line)?;
            let Some(payload) = maybe_payload else {
                continue;
            };

            if is_chat_completions
                && payload.get("object").and_then(Value::as_str) == Some("chat.completion.chunk")
            {
                if let Some(chat_usage) = extract_chat_completion_usage(&payload) {
                    usage = Some(chat_usage);
                }

                if let Some(delta) = extract_chat_completion_delta(&payload) {
                    if !delta.is_empty() {
                        raw_text.push_str(delta);
                        if !saw_streaming_chunk {
                            saw_streaming_chunk = true;
                            (callbacks.emit_status)(
                                app_handle,
                                batch_id,
                                "streaming",
                                "Streaming AI response...",
                            );
                        }
                        (callbacks.emit_chunk)(app_handle, batch_id, delta, &raw_text);
                    }
                }
                if let Some(delta) = extract_chat_completion_reasoning_delta(&payload) {
                    if !delta.is_empty() {
                        reasoning_text.push_str(delta);
                        if let Some(emit_reasoning) = callbacks.emit_reasoning {
                            emit_reasoning(app_handle, batch_id, delta, &reasoning_text);
                        }
                    }
                }
                continue;
            }

            match payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "response.created" => {
                    (callbacks.emit_status)(
                        app_handle,
                        batch_id,
                        "streaming",
                        "Text AI provider accepted the batch.",
                    );
                }
                "response.in_progress" => {
                    (callbacks.emit_status)(app_handle, batch_id, "streaming", generating_message);
                }
                "response.output_text.delta" => {
                    let delta = payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        raw_text.push_str(delta);
                        if !saw_streaming_chunk {
                            saw_streaming_chunk = true;
                            (callbacks.emit_status)(
                                app_handle,
                                batch_id,
                                "streaming",
                                "Streaming AI response...",
                            );
                        }
                        (callbacks.emit_chunk)(app_handle, batch_id, delta, &raw_text);
                    }
                }
                "response.reasoning_summary_text.delta" => {
                    let delta = payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        reasoning_text.push_str(delta);
                        if let Some(emit_reasoning) = callbacks.emit_reasoning {
                            emit_reasoning(app_handle, batch_id, delta, &reasoning_text);
                        }
                    }
                }
                "response.refusal.delta" => {
                    let delta = payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        raw_text.push_str(delta);
                        (callbacks.emit_chunk)(app_handle, batch_id, delta, &raw_text);
                    }
                }
                "response.completed" => {
                    usage = payload
                        .get("response")
                        .and_then(|response_value| response_value.get("usage"))
                        .cloned();

                    if raw_text.trim().is_empty() {
                        if let Some(completed_text) = extract_completed_output_text(&payload) {
                            raw_text = completed_text;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // Traite les derniers octets sans saut de ligne.
    if !buffered_bytes.is_empty() {
        let trailing_line = String::from_utf8_lossy(&buffered_bytes);
        let _ = accumulator.push_line(&trailing_line)?;
        if let Some(payload) = accumulator.flush_event()? {
            if is_chat_completions
                && payload.get("object").and_then(Value::as_str) == Some("chat.completion.chunk")
            {
                if let Some(chat_usage) = extract_chat_completion_usage(&payload) {
                    usage = Some(chat_usage);
                }
                if let Some(delta) = extract_chat_completion_delta(&payload) {
                    raw_text.push_str(delta);
                }
                if let Some(delta) = extract_chat_completion_reasoning_delta(&payload) {
                    reasoning_text.push_str(delta);
                    if let Some(emit_reasoning) = callbacks.emit_reasoning {
                        emit_reasoning(app_handle, batch_id, delta, &reasoning_text);
                    }
                }
            } else if payload.get("type").and_then(Value::as_str) == Some("response.completed") {
                usage = payload
                    .get("response")
                    .and_then(|response_value| response_value.get("usage"))
                    .cloned();
                if raw_text.trim().is_empty() {
                    if let Some(completed_text) = extract_completed_output_text(&payload) {
                        raw_text = completed_text;
                    }
                }
            }
        }
    }

    append_ai_exchange_log_non_fatal(
        app_handle,
        operation,
        batch_id,
        endpoint,
        body,
        &reasoning_text,
        &raw_text,
        usage.as_ref(),
        None,
    );
    Ok((raw_text, usage))
}
