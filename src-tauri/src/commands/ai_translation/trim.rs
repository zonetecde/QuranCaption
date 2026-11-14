use serde_json::{json, Value};
use tauri::Emitter;

use super::prompts;
use super::types::{
    AdvancedBoldBatchPayload, AdvancedSubtitleSplitBatchPayload, AdvancedTrimBatchPayload,
    AdvancedTrimCommandRequest, AdvancedWbwTranslationBatchPayload,
    AiTranslationReviewBatchPayload,
};
use super::{
    normalize_usage, stream_ai_response, validate_model, validate_reasoning_effort,
    AiStreamCallbacks, AiStreamRequest,
};

// ---------------------------------------------------------------------------
// Emit functions
// ---------------------------------------------------------------------------

fn emit_status(app_handle: &tauri::AppHandle, batch_id: &str, step: &str, message: &str) {
    let _ = app_handle.emit(
        "advanced-ai-trim-status",
        json!({
            "batchId": batch_id,
            "step": step,
            "message": message
        }),
    );
}

fn emit_chunk(app_handle: &tauri::AppHandle, batch_id: &str, delta: &str, kind: &str) {
    let _ = app_handle.emit(
        "advanced-ai-trim-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "kind": kind
        }),
    );
}

fn emit_complete(
    app_handle: &tauri::AppHandle,
    batch_id: &str,
    raw_text: &str,
    usage: Option<&Value>,
) {
    let _ = app_handle.emit(
        "advanced-ai-trim-complete",
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

/// Prépare les mêmes instructions que les assistants API, sans clé ni requête réseau.
#[tauri::command]
pub fn prepare_manual_ai_prompt(kind: String, request: Value) -> Result<String, String> {
    let batch = request.get("batch").cloned().ok_or("MANUAL_AI_INPUT")?;
    let note = request
        .get("customPromptNote")
        .and_then(Value::as_str)
        .unwrap_or("");
    let (system, user, schema) = match kind.as_str() {
        "translation_trim" => {
            let batch: AdvancedTrimBatchPayload =
                serde_json::from_value(batch).map_err(|_| "MANUAL_AI_INPUT")?;
            if batch.verses.is_empty() {
                return Err("MANUAL_AI_INPUT".into());
            }
            (
                prompts::ADVANCED_TRIM_SYSTEM_PROMPT,
                prompts::build_user_prompt(&batch)?,
                None,
            )
        }
        "translation_bold" => {
            let batch: AdvancedBoldBatchPayload =
                serde_json::from_value(batch).map_err(|_| "MANUAL_AI_INPUT")?;
            if batch.segments.is_empty() {
                return Err("MANUAL_AI_INPUT".into());
            }
            (
                prompts::ADVANCED_BOLD_SYSTEM_PROMPT,
                prompts::build_bold_user_prompt(&batch, note)?,
                Some(prompts::build_bold_response_schema()),
            )
        }
        "translation_wbw" => {
            let batch: AdvancedWbwTranslationBatchPayload =
                serde_json::from_value(batch).map_err(|_| "MANUAL_AI_INPUT")?;
            if batch.segments.is_empty() {
                return Err("MANUAL_AI_INPUT".into());
            }
            (
                prompts::ADVANCED_WBW_TRANSLATION_SYSTEM_PROMPT,
                prompts::build_wbw_translation_user_prompt(&batch, note)?,
                Some(prompts::build_wbw_translation_response_schema()),
            )
        }
        "translation_review" => {
            let batch: AiTranslationReviewBatchPayload =
                serde_json::from_value(batch).map_err(|_| "MANUAL_AI_INPUT")?;
            if batch.verses.is_empty() {
                return Err("MANUAL_AI_INPUT".into());
            }
            (
                prompts::AI_TRANSLATION_REVIEW_SYSTEM_PROMPT,
                prompts::build_translation_review_user_prompt(&batch)?,
                Some(prompts::build_translation_review_response_schema()),
            )
        }
        "subtitle_split" => {
            let batch: AdvancedSubtitleSplitBatchPayload =
                serde_json::from_value(batch).map_err(|_| "MANUAL_AI_INPUT")?;
            if batch.segments.is_empty() {
                return Err("MANUAL_AI_INPUT".into());
            }
            (
                prompts::ADVANCED_SUBTITLE_SPLIT_SYSTEM_PROMPT,
                prompts::build_subtitle_split_user_prompt(&batch)?,
                Some(prompts::build_subtitle_split_response_schema()),
            )
        }
        _ => return Err("MANUAL_AI_KIND".into()),
    };
    // Le chat manuel doit recevoir le schéma fourni séparément à l'API Responses.
    Ok(match schema {
        Some(schema) => format!(
            "{}\n\n{}\n\nResponse JSON schema:\n{}",
            system, user, schema
        ),
        None => format!("{}\n\n{}", system, user),
    })
}

#[cfg(test)]
mod manual_ai_prompt_tests {
    use super::*;

    /// Vérifie que les chats reçoivent les instructions, données et schémas API existants.
    #[test]
    fn manual_ai_prompts_reuse_api_instructions_and_schemas() {
        let note = "Emphasize invocations only.";
        let bold: AdvancedBoldBatchPayload = serde_json::from_value(json!({
            "segments": [{"segmentIndex": 0, "verseKey": "1:1", "segmentArabic": "بسم",
                "translationIndexed": "0:In 1:the 2:name"}]
        }))
        .unwrap();
        let wbw: AdvancedWbwTranslationBatchPayload = serde_json::from_value(json!({
            "s": [{"i": 0, "v": "1:1", "a": "بسم", "w": [{"i": 0, "a": "بسم", "h": "In the name"}],
                "t": "0:In 1:the 2:name"}]
        }))
        .unwrap();
        let review: AiTranslationReviewBatchPayload = serde_json::from_value(json!({
            "verses": [{"editionLanguage": "English", "verseKey": "1:1", "sourceTranslation": "In the name",
                "segments": [{"id": 0, "arabicStart": 0, "arabicEnd": 0, "arabic": "بسم",
                    "wordByWordEnglish": ["In the name"], "isFullVerse": false,
                    "selectedTranslation": "In", "selectedRange": [0, 0], "isCustomText": false}]}]
        })).unwrap();
        let split: AdvancedSubtitleSplitBatchPayload = serde_json::from_value(json!({
            "s": [{"i": 0, "v": "1:1", "m": 1, "w": "0:بسم 1:الله"}]
        }))
        .unwrap();
        let cases = [
            (
                "translation_bold",
                serde_json::to_value(&bold).unwrap(),
                prompts::ADVANCED_BOLD_SYSTEM_PROMPT,
                prompts::build_bold_user_prompt(&bold, note).unwrap(),
                prompts::build_bold_response_schema(),
            ),
            (
                "translation_wbw",
                serde_json::to_value(&wbw).unwrap(),
                prompts::ADVANCED_WBW_TRANSLATION_SYSTEM_PROMPT,
                prompts::build_wbw_translation_user_prompt(&wbw, note).unwrap(),
                prompts::build_wbw_translation_response_schema(),
            ),
            (
                "translation_review",
                serde_json::to_value(&review).unwrap(),
                prompts::AI_TRANSLATION_REVIEW_SYSTEM_PROMPT,
                prompts::build_translation_review_user_prompt(&review).unwrap(),
                prompts::build_translation_review_response_schema(),
            ),
            (
                "subtitle_split",
                serde_json::to_value(&split).unwrap(),
                prompts::ADVANCED_SUBTITLE_SPLIT_SYSTEM_PROMPT,
                prompts::build_subtitle_split_user_prompt(&split).unwrap(),
                prompts::build_subtitle_split_response_schema(),
            ),
        ];
        for (kind, batch, system, user, schema) in cases {
            let prompt = prepare_manual_ai_prompt(
                kind.into(),
                json!({"batch": batch, "customPromptNote": note}),
            )
            .unwrap();
            assert!(prompt.starts_with(&format!("{}\n\n{}", system, user)));
            let (_, encoded_schema) = prompt.split_once("Response JSON schema:\n").unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(encoded_schema).unwrap(),
                schema
            );
        }
    }

    /// Refuse les lots vides ou malformés avant de créer un prompt manuel.
    #[test]
    fn manual_ai_prompts_reject_invalid_batches() {
        for kind in [
            "translation_bold",
            "translation_wbw",
            "translation_review",
            "subtitle_split",
        ] {
            assert!(prepare_manual_ai_prompt(kind.into(), json!({"batch": {}})).is_err());
            assert!(prepare_manual_ai_prompt(
                kind.into(),
                json!({"batch": {"s": [], "segments": [], "verses": []}})
            )
            .is_err());
        }
    }
}

#[tauri::command]
pub async fn run_advanced_ai_trim_batch_streaming(
    app_handle: tauri::AppHandle,
    request: AdvancedTrimCommandRequest,
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

    let user_prompt = prompts::build_user_prompt(&request.batch)?;
    let schema = prompts::build_response_schema();
    let is_chat_completions = prompts::is_chat_completions_endpoint(&endpoint);
    let body = if is_chat_completions {
        prompts::build_chat_completions_body(
            &request.model,
            prompts::is_deepseek_endpoint(&endpoint).then_some(request.reasoning_effort.as_str()),
            prompts::ADVANCED_TRIM_SYSTEM_PROMPT,
            &user_prompt,
        )
    } else {
        prompts::build_responses_api_body(
            &request.model,
            prompts::is_openai_endpoint(&endpoint).then_some(request.reasoning_effort.as_str()),
            prompts::ADVANCED_TRIM_SYSTEM_PROMPT,
            &user_prompt,
            "advanced_trim_batch",
            "Trimmed translations for a batch of Quran subtitle segments.",
            &schema,
        )
    };

    let batch_id = request.batch_id.clone();
    let callbacks = AiStreamCallbacks {
        emit_status,
        emit_chunk,
    };

    let (raw_text, usage) = stream_ai_response(AiStreamRequest {
        app_handle: &app_handle,
        batch_id: &batch_id,
        api_key,
        endpoint: &endpoint,
        is_chat_completions,
        body: &body,
        callbacks: &callbacks,
        generating_message: "Text AI provider is generating the trim.",
    })
    .await?;

    if raw_text.trim().is_empty() {
        let message = "Text AI provider returned an empty response.".to_string();
        emit_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse text AI JSON output: {}", error))?;

    emit_status(
        &app_handle,
        &batch_id,
        "completed",
        "Text AI batch completed.",
    );
    emit_complete(&app_handle, &batch_id, &raw_text, usage.as_ref());

    Ok(json!({
        "batchId": batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
