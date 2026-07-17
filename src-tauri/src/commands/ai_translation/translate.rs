use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::ProjectTranslationCommandRequest;
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort,
    AiStreamCallbacks, AiStreamRequest,
};

/// Émet les changements de statut d'un batch de traduction.
fn emit_project_translation_status(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    step: &str,
    message: &str,
) {
    let _ = app_handle.emit(
        "ai-project-translation-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

/// Émet les fragments de réponse d'un batch de traduction.
fn emit_project_translation_chunk(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    delta: &str,
    accumulated_text: &str,
) {
    let _ = app_handle.emit(
        "ai-project-translation-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "accumulatedText": accumulated_text
        }),
    );
}

/// Émet les fragments de raisonnement d'un batch de traduction.
fn emit_project_translation_reasoning(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    delta: &str,
    accumulated_text: &str,
) {
    let _ = app_handle.emit(
        "ai-project-translation-reasoning",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "accumulatedText": accumulated_text
        }),
    );
}

#[tauri::command]
/// Traduit un batch de sous-titres structurés avec le provider IA texte.
pub async fn run_ai_project_translation_batch_streaming(
    app_handle: tauri::AppHandle,
    request: ProjectTranslationCommandRequest,
) -> Result<Value, String> {
    validate_model(&request.model)?;
    validate_reasoning_effort(&request.reasoning_effort)?;

    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("AI API key is required.".to_string());
    }
    if request.target_language.trim().is_empty() {
        return Err("Target language is required.".to_string());
    }
    let endpoint = prompts::normalize_text_ai_endpoint(&request.endpoint)?;
    let items = request
        .batch
        .get("i")
        .and_then(Value::as_array)
        .ok_or_else(|| "Project translation batch is missing its items array.".to_string())?;
    if items.is_empty() {
        return Err("Batch is empty.".to_string());
    }

    let user_prompt = prompts::build_project_translation_user_prompt(
        &request.target_language,
        &request.islamic_term_mode,
        &request.batch,
    )?;
    let schema = prompts::build_project_translation_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            &request.reasoning_effort,
            &endpoint,
            prompts::PROJECT_TRANSLATION_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            &request.reasoning_effort,
            prompts::PROJECT_TRANSLATION_SYSTEM_PROMPT,
            &user_prompt,
            "project_translation_batch",
            "Structured lecture translations and Quran edition ranges.",
            &schema,
        )
    };

    let callbacks = AiStreamCallbacks {
        emit_status: emit_project_translation_status,
        emit_chunk: emit_project_translation_chunk,
        emit_reasoning: Some(emit_project_translation_reasoning),
    };
    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &request.batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is translating the subtitle batch.",
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
