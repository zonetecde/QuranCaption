use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};

use crate::commands::ai_translation::prompts::{
    is_deepseek_endpoint, is_openai_endpoint, is_openrouter_endpoint,
};

use self::sse::{
    extract_chat_completion_delta, extract_chat_completion_reasoning_delta,
    extract_chat_completion_usage, extract_completed_output_text,
    extract_completed_reasoning_summary, SseAccumulator,
};

pub(crate) mod bold;
pub(crate) mod prompts;
pub(crate) mod sse;
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
    pub emit_chunk: fn(&tauri::AppHandle, &str, &str, &str, &str),
}

/// Paramètres d'une requête de streaming IA.
pub(crate) struct AiStreamRequest<'a> {
    pub app_handle: &'a tauri::AppHandle,
    pub batch_id: &'a str,
    pub api_key: &'a str,
    pub endpoint: &'a str,
    pub is_chat_completions: bool,
    pub body: &'a Value,
    pub callbacks: &'a AiStreamCallbacks,
    pub generating_message: &'a str,
}

/// Envoie la requête HTTP et diffuse la réponse SSE vers le frontend.
///
/// Retourne le texte brut accumulé et l'usage optionnel.
pub(crate) async fn stream_ai_response(
    request: AiStreamRequest<'_>,
) -> Result<(String, Option<Value>), String> {
    let AiStreamRequest {
        app_handle,
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
            .header("X-OpenRouter-Title", "QuranCaption")
    } else {
        request_builder
    };

    let response = request_builder
        .json(body)
        .send()
        .await
        .map_err(|error| format!("Text AI request failed: {}", error))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        let message = format!("Text AI API error ({}): {}", status.as_u16(), error_body);
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
    let streams_deepseek_reasoning = is_deepseek_endpoint(endpoint);
    let streams_openai_reasoning = is_openai_endpoint(endpoint);

    while let Some(chunk_result) = stream.next().await {
        let chunk =
            chunk_result.map_err(|error| format!("Failed to read text AI stream: {}", error))?;
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

                if streams_deepseek_reasoning {
                    if let Some(delta) = extract_chat_completion_reasoning_delta(&payload) {
                        if !delta.is_empty() {
                            reasoning_text.push_str(delta);
                            if !saw_streaming_chunk {
                                saw_streaming_chunk = true;
                                (callbacks.emit_status)(
                                    app_handle,
                                    batch_id,
                                    "streaming",
                                    "Streaming AI response...",
                                );
                            }
                            (callbacks.emit_chunk)(
                                app_handle,
                                batch_id,
                                delta,
                                &reasoning_text,
                                "reasoning",
                            );
                        }
                    }
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
                        (callbacks.emit_chunk)(app_handle, batch_id, delta, &raw_text, "response");
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
                "response.reasoning_summary_text.delta" if streams_openai_reasoning => {
                    let delta = payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        reasoning_text.push_str(delta);
                        if !saw_streaming_chunk {
                            saw_streaming_chunk = true;
                            (callbacks.emit_status)(
                                app_handle,
                                batch_id,
                                "streaming",
                                "Streaming AI response...",
                            );
                        }
                        (callbacks.emit_chunk)(
                            app_handle,
                            batch_id,
                            delta,
                            &reasoning_text,
                            "reasoning",
                        );
                    }
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
                        (callbacks.emit_chunk)(app_handle, batch_id, delta, &raw_text, "response");
                    }
                }
                "response.refusal.delta" => {
                    let delta = payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        raw_text.push_str(delta);
                        (callbacks.emit_chunk)(app_handle, batch_id, delta, &raw_text, "response");
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
                    if streams_openai_reasoning && reasoning_text.is_empty() {
                        if let Some(summary) = extract_completed_reasoning_summary(&payload) {
                            reasoning_text = summary;
                            (callbacks.emit_chunk)(
                                app_handle,
                                batch_id,
                                &reasoning_text,
                                &reasoning_text,
                                "reasoning",
                            );
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
                if streams_deepseek_reasoning {
                    if let Some(delta) = extract_chat_completion_reasoning_delta(&payload) {
                        reasoning_text.push_str(delta);
                        (callbacks.emit_chunk)(
                            app_handle,
                            batch_id,
                            delta,
                            &reasoning_text,
                            "reasoning",
                        );
                    }
                }
                if let Some(delta) = extract_chat_completion_delta(&payload) {
                    raw_text.push_str(delta);
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
                if streams_openai_reasoning && reasoning_text.is_empty() {
                    if let Some(summary) = extract_completed_reasoning_summary(&payload) {
                        reasoning_text = summary;
                        (callbacks.emit_chunk)(
                            app_handle,
                            batch_id,
                            &reasoning_text,
                            &reasoning_text,
                            "reasoning",
                        );
                    }
                }
            }
        }
    }

    Ok((raw_text, usage))
}
