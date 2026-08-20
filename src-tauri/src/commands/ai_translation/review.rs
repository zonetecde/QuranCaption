use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::AiTranslationReviewCommandRequest;
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort,
    AiStreamCallbacks, AiStreamRequest,
};

/// Émet l'étape courante d'un lot de vérification.
fn emit_review_status(app_handle: &tauri::AppHandle, batch_id: &str, step: &str, message: &str) {
    let _ = app_handle.emit(
        "ai-translation-review-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

/// Émet un fragment de la réponse de vérification.
fn emit_review_chunk(app_handle: &tauri::AppHandle, batch_id: &str, delta: &str, kind: &str) {
    let _ = app_handle.emit(
        "ai-translation-review-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "kind": kind
        }),
    );
}

/// Vérifie un lot de traductions et retourne uniquement les segments suspects.
#[tauri::command]
pub async fn run_ai_translation_review_batch_streaming(
    app_handle: tauri::AppHandle,
    request: AiTranslationReviewCommandRequest,
) -> Result<Value, String> {
    validate_model(&request.model)?;
    validate_reasoning_effort(&request.reasoning_effort)?;

    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("AI API key is required.".to_string());
    }
    let endpoint = prompts::normalize_text_ai_endpoint(&request.endpoint)?;
    if request.batch.verses.is_empty() {
        return Err("Batch is empty.".to_string());
    }

    let user_prompt = prompts::build_translation_review_user_prompt(&request.batch)?;
    let schema = prompts::build_translation_review_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            prompts::is_deepseek_endpoint(&endpoint).then_some(request.reasoning_effort.as_str()),
            prompts::AI_TRANSLATION_REVIEW_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            prompts::is_openai_endpoint(&endpoint).then_some(request.reasoning_effort.as_str()),
            prompts::AI_TRANSLATION_REVIEW_SYSTEM_PROMPT,
            &user_prompt,
            "ai_translation_review_batch",
            "High-confidence issues in existing Quran subtitle translation trims.",
            &schema,
        )
    };

    let batch_id = request.batch_id.clone();
    let callbacks = AiStreamCallbacks {
        emit_status: emit_review_status,
        emit_chunk: emit_review_chunk,
    };
    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is reviewing translations.",
    })
    .await?;

    if raw_text.trim().is_empty() {
        let message = "Text AI provider returned an empty response.".to_string();
        emit_review_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse text AI JSON output: {}", error))?;
    emit_review_status(
        &app_handle,
        &batch_id,
        "completed",
        "Translation review batch completed.",
    );

    Ok(json!({
        "batchId": batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
