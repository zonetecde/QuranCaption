use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::TranscriptCleanupCommandRequest;
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort,
    AiStreamCallbacks, AiStreamRequest,
};

/// Émet les statuts du nettoyage de transcription.
fn emit_transcript_cleanup_status(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    step: &str,
    message: &str,
) {
    let _ = app_handle.emit(
        "ai-transcript-cleanup-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

/// Émet les fragments du nettoyage de transcription.
fn emit_transcript_cleanup_chunk(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    delta: &str,
    accumulated_text: &str,
) {
    let _ = app_handle.emit(
        "ai-transcript-cleanup-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "accumulatedText": accumulated_text
        }),
    );
}

#[tauri::command]
/// Nettoie un batch de transcription et détecte ses citations via le provider IA texte.
pub async fn run_ai_transcript_cleanup_batch_streaming(
    app_handle: tauri::AppHandle,
    request: TranscriptCleanupCommandRequest,
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

    let user_prompt = prompts::build_transcript_cleanup_user_prompt(&request.batch)?;
    let schema = prompts::build_transcript_cleanup_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            prompts::TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            &request.reasoning_effort,
            prompts::TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
            &user_prompt,
            "transcript_cleanup_batch",
            "Cleaned transcript segments with validated quotation markers.",
            &schema,
        )
    };

    let callbacks = AiStreamCallbacks {
        emit_status: emit_transcript_cleanup_status,
        emit_chunk: emit_transcript_cleanup_chunk,
    };
    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &request.batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is cleaning the transcript.",
    })
    .await?;

    if raw_text.trim().is_empty() {
        return Err("Text AI provider returned an empty response.".to_string());
    }
    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse text AI JSON output: {}", error))?;

    Ok(json!({
        "batchId": request.batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
