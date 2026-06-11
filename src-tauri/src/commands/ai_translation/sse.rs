use serde_json::Value;

/// Accumulateur d'événements Server-Sent Events.
#[derive(Default)]
pub struct SseAccumulator {
    current_event: String,
    current_data: String,
}

impl SseAccumulator {
    /// Pousse une ligne SSE et retourne un payload JSON si l'événement est complet.
    pub fn push_line(&mut self, line: &str) -> Result<Option<Value>, String> {
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

    /// Vide l'événement courant et le parse en JSON.
    pub fn flush_event(&mut self) -> Result<Option<Value>, String> {
        let event_name = self.current_event.clone();
        let data_block = self.current_data.trim().to_string();
        self.current_event.clear();
        self.current_data.clear();

        if data_block.is_empty() || data_block == "[DONE]" {
            return Ok(None);
        }

        let payload: Value = serde_json::from_str(&data_block)
            .map_err(|error| format!("Failed to parse text AI stream payload: {}", error))?;

        if event_name == "error" || payload.get("type").and_then(Value::as_str) == Some("error") {
            let message = payload
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
                .or_else(|| payload.get("message").and_then(Value::as_str))
                .unwrap_or("Text AI streaming error");
            return Err(message.to_string());
        }

        Ok(Some(payload))
    }
}

/// Extrait le delta de texte d'un chunk Chat Completions.
pub fn extract_chat_completion_delta(payload: &Value) -> Option<&str> {
    payload
        .get("choices")?
        .as_array()?
        .iter()
        .find_map(|choice| choice.get("delta")?.get("content")?.as_str())
}

/// Extrait l'usage éventuel d'un chunk Chat Completions.
pub fn extract_chat_completion_usage(payload: &Value) -> Option<Value> {
    payload
        .get("usage")
        .filter(|usage| !usage.is_null())
        .cloned()
}

/// Extrait le texte de sortie complet d'une réponse Responses API.
pub fn extract_completed_output_text(payload: &Value) -> Option<String> {
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
