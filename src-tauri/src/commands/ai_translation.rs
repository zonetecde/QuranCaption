use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const ADVANCED_TRIM_SYSTEM_PROMPT: &str = r#"You trim Quran subtitle translations against Arabic subtitle segments.

Rules:
- Use only words that already exist in the provided verse translation.
- Across all output segments of a verse, every word from the source translation must appear at least once.
- The global order may change when the recitation repeats, overlaps, or returns to an earlier clause.
- Overlap between segments is allowed and often required when the Arabic overlaps on a repeated word or phrase.
- If two Arabic segments share a boundary word or phrase, the translated outputs should normally share the corresponding translated words too.
- Do not drop the repeated overlap from the later segment just because it already appeared in the previous one.
- Each segment must sound natural and complete in the target language.
- Each segment may include a word-by-word English helper for the Arabic. Use it only to understand the Arabic segment better.
- Keep essential function words with the phrase when needed for local meaning: articles, pronouns, auxiliaries, conjunctions, prepositions, particles.
- Avoid unnatural cuts like `reply,` if `they reply,` is the smallest natural phrase.
- Never introduce a helper word unless that same word already exists in the provided source translation.
- Do not invent any word that does not exist in the source translation.
- Return JSON only, matching the schema exactly.
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimCommandRequest {
    api_key: String,
    model: String,
    reasoning_effort: String,
    batch_id: String,
    batch: AdvancedTrimBatchPayload,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimBatchPayload {
    verses: Vec<AdvancedTrimVersePayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimVersePayload {
    verse_key: String,
    translation: String,
    segments: Vec<AdvancedTrimSegmentPayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimSegmentPayload {
    i: i32,
    arabic: String,
    word_by_word_english: Vec<String>,
}

#[derive(Default)]
struct SseAccumulator {
    current_event: String,
    current_data: String,
}

impl SseAccumulator {
    fn push_line(&mut self, line: &str) -> Result<Option<Value>, String> {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            return self.flush_event();
        }

        if let Some(event_name) = line.strip_prefix("event:") {
            self.current_event = event_name.trim().to_string();
            return Ok(None);
        }

        if let Some(data_value) = line.strip_prefix("data:") {
            if !self.current_data.is_empty() {
                self.current_data.push('\n');
            }
            self.current_data.push_str(data_value.trim());
        }

        Ok(None)
    }

    fn flush_event(&mut self) -> Result<Option<Value>, String> {
        let event_name = self.current_event.clone();
        let data_block = self.current_data.trim().to_string();
        self.current_event.clear();
        self.current_data.clear();

        if data_block.is_empty() || data_block == "[DONE]" {
            return Ok(None);
        }

        let payload: Value = serde_json::from_str(&data_block)
            .map_err(|error| format!("Failed to parse OpenAI stream payload: {}", error))?;

        if event_name == "error" || payload.get("type").and_then(Value::as_str) == Some("error") {
            let message = payload
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
                .or_else(|| payload.get("message").and_then(Value::as_str))
                .unwrap_or("OpenAI streaming error");
            return Err(message.to_string());
        }

        Ok(Some(payload))
    }
}

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

fn emit_chunk(app_handle: &tauri::AppHandle, batch_id: &str, delta: &str, accumulated_text: &str) {
    let _ = app_handle.emit(
        "advanced-ai-trim-chunk",
        json!({
            "batchId": batch_id,
            "delta": delta,
            "accumulatedText": accumulated_text
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

fn normalize_usage(usage: &Value) -> Value {
    json!({
        "inputTokens": usage.get("input_tokens").and_then(Value::as_u64),
        "outputTokens": usage.get("output_tokens").and_then(Value::as_u64),
        "totalTokens": usage.get("total_tokens").and_then(Value::as_u64),
        "reasoningTokens": usage
            .get("output_tokens_details")
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
    })
}

fn validate_model(model: &str) -> Result<(), String> {
    match model {
        "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.4-nano" => Ok(()),
        _ => Err(format!(
            "Unsupported model '{}'. Expected gpt-5.4, gpt-5.4-mini, or gpt-5.4-nano.",
            model
        )),
    }
}

fn validate_reasoning_effort(reasoning_effort: &str) -> Result<(), String> {
    match reasoning_effort {
        "none" | "low" | "medium" | "high" => Ok(()),
        _ => Err(format!(
            "Unsupported reasoning_effort '{}'. Expected none, low, medium, or high.",
            reasoning_effort
        )),
    }
}

fn build_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "verses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "verseKey": {
                            "type": "string"
                        },
                        "segments": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "i": {
                                        "type": "integer"
                                    },
                                    "text": {
                                        "type": "string"
                                    }
                                },
                                "required": ["i", "text"]
                            }
                        }
                    },
                    "required": ["verseKey", "segments"]
                }
            }
        },
        "required": ["verses"]
    })
}

fn build_user_prompt(batch: &AdvancedTrimBatchPayload) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    Ok(format!(
        "Trim this batch of verses and return JSON only.\n\
         Respect overlap/repetition in the recitation when needed.\n\
         Pay special attention to overlapping Arabic segments: when a word or phrase is repeated across two segments, keep the corresponding translated overlap in both outputs when natural.\n\
         Keep each segment natural in the target language while using only words from the source translation.\n\
         Each segment also includes a wordByWordEnglish helper array for Arabic understanding only.\n\n\
         Batch JSON:\n{}",
        batch_json
    ))
}

fn extract_completed_output_text(payload: &Value) -> Option<String> {
    let response = payload.get("response")?;

    if let Some(output_text) = response.get("output_text").and_then(Value::as_str) {
        if !output_text.trim().is_empty() {
            return Some(output_text.to_string());
        }
    }

    let output = response.get("output")?.as_array()?;
    let mut parts: Vec<String> = Vec::new();

    for item in output {
        let content = item.get("content").and_then(Value::as_array);
        let Some(content_items) = content else {
            continue;
        };

        for content_item in content_items {
            if content_item.get("type").and_then(Value::as_str) == Some("output_text") {
                if let Some(text) = content_item.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        parts.push(text.to_string());
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(""))
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
        return Err("OpenAI API key is required.".to_string());
    }

    if request.batch.verses.is_empty() {
        return Err("Batch is empty.".to_string());
    }

    let _source_stats: usize = request
        .batch
        .verses
        .iter()
        .map(|verse| {
            verse.translation.len()
                + verse.verse_key.len()
                + verse
                    .segments
                    .iter()
                    .map(|segment| {
                        segment.arabic.len()
                            + segment.i.unsigned_abs() as usize
                            + segment
                                .word_by_word_english
                                .iter()
                                .map(|word| word.len())
                                .sum::<usize>()
                    })
                    .sum::<usize>()
        })
        .sum();

    let user_prompt = build_user_prompt(&request.batch)?;
    let schema = build_response_schema();
    let model = request.model.clone();
    let reasoning_effort = request.reasoning_effort.clone();
    let batch_id = request.batch_id.clone();
    let body = json!({
        "model": model,
        "stream": true,
        "store": false,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": ADVANCED_TRIM_SYSTEM_PROMPT
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": user_prompt
                    }
                ]
            }
        ],
        "reasoning": {
            "effort": reasoning_effort
        },
        "text": {
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "advanced_trim_batch",
                "description": "Trimmed translations for a batch of Quran subtitle segments.",
                "strict": true,
                "schema": schema
            }
        }
    });

    emit_status(&app_handle, &batch_id, "queued", "Queued for OpenAI.");

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("Failed to build OpenAI HTTP client: {}", error))?;

    emit_status(
        &app_handle,
        &batch_id,
        "sending",
        "Sending batch to OpenAI...",
    );

    let response = client
        .post(OPENAI_RESPONSES_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("OpenAI request failed: {}", error))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        let message = format!("OpenAI API error ({}): {}", status.as_u16(), error_body);
        emit_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let mut accumulator = SseAccumulator::default();
    let mut buffered_bytes: Vec<u8> = Vec::new();
    let mut raw_text = String::new();
    let mut usage: Option<Value> = None;
    let mut stream = response.bytes_stream();
    let mut saw_streaming_chunk = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk =
            chunk_result.map_err(|error| format!("Failed to read OpenAI stream: {}", error))?;
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

            match payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "response.created" => {
                    emit_status(
                        &app_handle,
                        &batch_id,
                        "streaming",
                        "OpenAI accepted the batch.",
                    );
                }
                "response.in_progress" => {
                    emit_status(
                        &app_handle,
                        &batch_id,
                        "streaming",
                        "OpenAI is generating the trim.",
                    );
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
                            emit_status(
                                &app_handle,
                                &batch_id,
                                "streaming",
                                "Streaming AI response...",
                            );
                        }
                        emit_chunk(&app_handle, &batch_id, delta, &raw_text);
                    }
                }
                "response.refusal.delta" => {
                    let delta = payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        raw_text.push_str(delta);
                        emit_chunk(&app_handle, &batch_id, delta, &raw_text);
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

    if !buffered_bytes.is_empty() {
        let trailing_line = String::from_utf8_lossy(&buffered_bytes);
        let _ = accumulator.push_line(&trailing_line)?;
        if let Some(payload) = accumulator.flush_event()? {
            if payload.get("type").and_then(Value::as_str) == Some("response.completed") {
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

    if raw_text.trim().is_empty() {
        let message = "OpenAI returned an empty response.".to_string();
        emit_status(&app_handle, &batch_id, "failed", &message);
        return Err(message);
    }

    let parsed: Value = serde_json::from_str(raw_text.trim())
        .map_err(|error| format!("Failed to parse OpenAI JSON output: {}", error))?;

    emit_status(
        &app_handle,
        &batch_id,
        "completed",
        "OpenAI batch completed.",
    );
    emit_complete(&app_handle, &batch_id, &raw_text, usage.as_ref());

    Ok(json!({
        "batchId": batch_id,
        "rawText": raw_text,
        "parsed": parsed,
        "usage": usage.as_ref().map(normalize_usage)
    }))
}
