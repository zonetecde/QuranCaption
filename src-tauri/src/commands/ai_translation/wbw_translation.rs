use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::AdvancedWbwTranslationCommandRequest;
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort, AiStreamCallbacks,
    AiStreamRequest,
};

// ---------------------------------------------------------------------------
// Emit functions
// ---------------------------------------------------------------------------

/// Émet une étape de statut pour l'assistant WBW traduction.
pub(crate) fn emit_wbw_translation_status(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    step: &str,
    message: &str,
) {
    let _ = app_handle.emit(
        "advanced-ai-wbw-translation-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

/// Émet un fragment de réponse streamée pour l'assistant WBW traduction.
pub(crate) fn emit_wbw_translation_chunk(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    delta: &str,
    accumulated_text: &str,
) {
    let _ = app_handle.emit(
        "advanced-ai-wbw-translation-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "accumulatedText": accumulated_text
        }),
    );
}

/// Émet la réponse finale d'un batch WBW traduction.
pub(crate) fn emit_wbw_translation_complete(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    raw_text: &str,
    usage: Option<&Value>,
) {
    let _ = app_handle.emit(
        "advanced-ai-wbw-translation-complete",
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
/// Lance un batch streaming de mapping WBW traduction via le provider IA texte.
pub async fn run_advanced_ai_wbw_translation_batch_streaming(
    app_handle: tauri::AppHandle,
    request: AdvancedWbwTranslationCommandRequest,
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

    let user_prompt =
        prompts::build_wbw_translation_user_prompt(&request.batch, &request.custom_prompt_note)?;
    let schema = prompts::build_wbw_translation_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            prompts::ADVANCED_WBW_TRANSLATION_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            &request.reasoning_effort,
            prompts::ADVANCED_WBW_TRANSLATION_SYSTEM_PROMPT,
            &user_prompt,
            "advanced_wbw_translation_batch",
            "Word-by-word translation mapping ranges for Quran subtitle translations.",
            &schema,
        )
    };

    let batch_id = request.batch_id.clone();
    let callbacks = AiStreamCallbacks {
        emit_status: emit_wbw_translation_status,
        emit_chunk: emit_wbw_translation_chunk,
    };

    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is generating WBW translation ranges.",
    })
    .await?;

    if raw_text.trim().is_empty() {
        let message = "Text AI provider returned an empty response.".to_string();
        emit_wbw_translation_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse text AI JSON output: {}", error))?;

    emit_wbw_translation_status(
        &app_handle,
        &batch_id,
        "completed",
        "Text AI batch completed.",
    );
    emit_wbw_translation_complete(&app_handle, &batch_id, &raw_text, usage.as_ref());

    Ok(json!({
        "batchId": batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
