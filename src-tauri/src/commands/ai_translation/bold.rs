use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::AdvancedBoldCommandRequest;
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort,
    AiStreamCallbacks, AiStreamRequest,
};

// ---------------------------------------------------------------------------
// Emit functions
// ---------------------------------------------------------------------------

fn emit_bold_status(app_handle: &tauri::AppHandle, batch_id: &str, step: &str, message: &str) {
    let _ = app_handle.emit(
        "advanced-ai-bold-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

fn emit_bold_chunk(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    delta: &str,
    accumulated_text: &str,
) {
    let _ = app_handle.emit(
        "advanced-ai-bold-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "accumulatedText": accumulated_text
        }),
    );
}

fn emit_bold_complete(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    raw_text: &str,
    usage: Option<&Value>,
) {
    let _ = app_handle.emit(
        "advanced-ai-bold-complete",
        json!({
            "batchId": batch_id,
            "rawText": raw_text,
            "usage": usage.map(normalize_usage)
        }),
    );
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn run_advanced_ai_bold_batch_streaming(
    app_handle: tauri::AppHandle,
    request: AdvancedBoldCommandRequest,
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

    let user_prompt = prompts::build_bold_user_prompt(&request.batch, &request.custom_prompt_note)?;
    let schema = prompts::build_bold_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            prompts::ADVANCED_BOLD_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            &request.reasoning_effort,
            prompts::ADVANCED_BOLD_SYSTEM_PROMPT,
            &user_prompt,
            "advanced_bold_batch",
            "Bold word indexes for a batch of Quran subtitle translations.",
            &schema,
        )
    };

    let batch_id = request.batch_id.clone();
    let callbacks = AiStreamCallbacks {
        emit_status: emit_bold_status,
        emit_chunk: emit_bold_chunk,
    };

    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is generating bold indexes.",
    })
    .await?;

    if raw_text.trim().is_empty() {
        let message = "Text AI provider returned an empty response.".to_string();
        emit_bold_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse text AI JSON output: {}", error))?;

    emit_bold_status(
        &app_handle,
        &batch_id,
        "completed",
        "Text AI batch completed.",
    );
    emit_bold_complete(&app_handle, &batch_id, &raw_text, usage.as_ref());

    Ok(json!({
        "batchId": batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
