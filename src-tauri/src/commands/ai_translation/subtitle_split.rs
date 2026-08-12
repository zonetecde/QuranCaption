use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::AdvancedSubtitleSplitCommandRequest;
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort,
    AiStreamCallbacks, AiStreamRequest,
};

/// Émet l'état courant d'un lot de découpage sémantique.
fn emit_subtitle_split_status(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    step: &str,
    message: &str,
) {
    let _ = app_handle.emit(
        "advanced-ai-subtitle-split-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

/// Émet un fragment de réponse d'un lot de découpage sémantique.
fn emit_subtitle_split_chunk(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    delta: &str,
    kind: &str,
) {
    let _ = app_handle.emit(
        "advanced-ai-subtitle-split-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "kind": kind
        }),
    );
}

/// Émet la réponse complète et l'usage d'un lot de découpage sémantique.
fn emit_subtitle_split_complete(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    raw_text: &str,
    usage: Option<&Value>,
) {
    let _ = app_handle.emit(
        "advanced-ai-subtitle-split-complete",
        json!({
            "batchId": batch_id,
            "rawText": raw_text,
            "usage": usage.map(normalize_usage)
        }),
    );
}

/// Exécute en streaming un lot de découpage sémantique des sous-titres.
#[tauri::command]
pub async fn run_advanced_ai_subtitle_split_batch_streaming(
    app_handle: tauri::AppHandle,
    request: AdvancedSubtitleSplitCommandRequest,
) -> Result<Value, String> {
    validate_model(&request.model)?;
    validate_reasoning_effort(&request.reasoning_effort)?;

    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("AI API key is required.".to_string());
    }
    let endpoint = prompts::normalize_text_ai_endpoint(&request.endpoint)?;

    if request.batch.segments.is_empty() {
        return Err("Batch is empty.".to_string());
    }

    let user_prompt = prompts::build_subtitle_split_user_prompt(&request.batch)?;
    let schema = prompts::build_subtitle_split_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            prompts::is_deepseek_endpoint(&endpoint).then_some(request.reasoning_effort.as_str()),
            prompts::ADVANCED_SUBTITLE_SPLIT_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            prompts::is_openai_endpoint(&endpoint).then_some(request.reasoning_effort.as_str()),
            prompts::ADVANCED_SUBTITLE_SPLIT_SYSTEM_PROMPT,
            &user_prompt,
            "advanced_subtitle_split_batch",
            "Meaning-aware chunk boundaries for Arabic Quran subtitles.",
            &schema,
        )
    };

    let batch_id = request.batch_id.clone();
    let callbacks = AiStreamCallbacks {
        emit_status: emit_subtitle_split_status,
        emit_chunk: emit_subtitle_split_chunk,
    };

    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is choosing meaningful subtitle boundaries.",
    })
    .await?;

    if raw_text.trim().is_empty() {
        let message = "Text AI provider returned an empty response.".to_string();
        emit_subtitle_split_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse text AI JSON output: {}", error))?;

    emit_subtitle_split_status(
        &app_handle,
        &batch_id,
        "completed",
        "Text AI batch completed.",
    );
    emit_subtitle_split_complete(&app_handle, &batch_id, &raw_text, usage.as_ref());

    Ok(json!({
        "batchId": batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
