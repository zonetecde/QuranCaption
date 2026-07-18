use serde_json::{json, Value};

use super::types::{
    AdvancedBoldBatchPayload, AdvancedTrimBatchPayload, AdvancedWbwTranslationBatchPayload,
};

pub const DEFAULT_TEXT_AI_ENDPOINT: &str = "https://api.openai.com/v1/responses";

pub const ADVANCED_TRIM_SYSTEM_PROMPT: &str = r#"You trim Quran subtitle translations against Arabic subtitle segments.

Rules:
- Use only words that already exist in the provided verse translation.
- For Chinese or other text without spaces, treat existing characters or text units as the source words.
- Across all output segments of a verse, every word from the source translation must appear at least once.
- The global order may change when the recitation repeats, overlaps, or returns to an earlier clause.
- Overlap between segments is allowed and often required when the Arabic overlaps on a repeated word or phrase.
- If two Arabic segments share a boundary word or phrase, the translated outputs should normally share the corresponding translated words too.
- Do not drop the repeated overlap from the later segment just because it already appeared in the previous one.
- Each segment must sound natural and complete in the target language.
- Each segment may include a word-by-word English helper for the Arabic. Use it only to understand the Arabic segment better.
- Keep essential function words with the phrase when needed for local meaning: articles, pronouns, auxiliaries, conjunctions, prepositions, particles.
- Avoid unnatural cuts like `reply,` if `they reply,` is the smallest natural phrase.
- Some source translations contain words wrapped in `˹ ˺`. These words are part of the translation and must be preserved in the final output when they appear in the source.
- Do not treat words inside `˹ ˺` as optional commentary or removable asides.
- Never introduce a helper word unless that same word already exists in the provided source translation.
- Do not invent any word that does not exist in the source translation.
- Return JSON only, matching the schema exactly.
- Each segment object must use exactly the keys `i` and `text`;
"#;

pub const ADVANCED_BOLD_SYSTEM_PROMPT: &str = r#"You select which translated words should be rendered in bold inside Quran subtitle translations.

Rules:
- You must only decide which existing translated words should be bold.
- You must never rewrite, reorder, remove, or add words.
- The provided translation uses indexed words in the form `0:word 1:word 2:word`.
- Return only the word indexes that should be bolded for each segment.
- An empty array is valid when no word should be bold.
- Prefer short, meaningful emphasis. Do not over-bold.
- Focus on semantically important words or phrases, not filler words, unless the user note explicitly asks for it.
- Use the Arabic segment only as context to understand meaning.
- Return JSON only, matching the schema exactly.
"#;

pub const ADVANCED_WBW_TRANSLATION_SYSTEM_PROMPT: &str = r#"You map each Arabic word in a Quran subtitle segment to one or more ranges of existing indexed translation units.

Rules:
- Use 0-based indexes only.
- Each output segment must contain at least one range for every Arabic word in the input segment.
- A single Arabic word may be mapped to multiple non-consecutive ranges by repeating the same Arabic word index in the ranges array.
- Use multiple ranges when the matching translation units are separated by unrelated words.
- Always output indexes for every Arabic word, even when the alignment is ambiguous or imperfect.
- When alignment is ambiguous, choose the most logical range using the Arabic word, its helper, and nearby previous/next words.
- Multiple Arabic words may map to the same translation unit or the same translation range.
- A translation unit may be used by multiple Arabic words.
- Ranges may overlap.
- Repeated Arabic word indexes are allowed.
- Ranges do not need to be continuous or monotonic across Arabic word order.
- You must never rewrite, reorder, remove, or add translation words.
- The provided translation uses indexed units in the form `0:word 1:word 2:word`.
- For Chinese or other text without spaces, the indexed units may be characters. Treat them exactly like selectable units.
- Compact response keys: root `s` = segments, segment `i` = segment index, segment `r` = ranges, range `i` = Arabic word index, range `s` = start unit index, range `e` = end unit index.
- Return JSON only, matching the schema exactly.
"#;

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

/// Schéma JSON de réponse pour le trimming.
pub fn build_response_schema() -> Value {
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

/// Schéma JSON de réponse pour le bold.
pub fn build_bold_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "segmentIndex": {
                            "type": "integer"
                        },
                        "boldWordIndexes": {
                            "type": "array",
                            "items": {
                                "type": "integer"
                            }
                        }
                    },
                    "required": ["segmentIndex", "boldWordIndexes"]
                }
            }
        },
        "required": ["segments"]
    })
}

/// Schéma JSON de réponse pour les ranges WBW traduction.
pub fn build_wbw_translation_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "s": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "i": {
                            "type": "integer"
                        },
                        "r": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "i": {
                                        "type": "integer"
                                    },
                                    "s": {
                                        "type": "integer"
                                    },
                                    "e": {
                                        "type": "integer"
                                    }
                                },
                                "required": ["i", "s", "e"]
                            }
                        }
                    },
                    "required": ["i", "r"]
                }
            }
        },
        "required": ["s"]
    })
}

// ---------------------------------------------------------------------------
// User prompt builders
// ---------------------------------------------------------------------------

/// Construit le prompt utilisateur pour un batch de trimming.
pub fn build_user_prompt(batch: &AdvancedTrimBatchPayload) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    Ok(format!(
        "Trim this batch of verses and return JSON only.\n\
         Output shape must be exactly {{\"verses\":[{{\"verseKey\":\"...\",\"segments\":[{{\"i\":0,\"text\":\"...\"}}]}}]}}.\n\
         Segment text must be stored in the `text` field only.\n\
         Respect overlap/repetition in the recitation when needed.\n\
         Pay special attention to overlapping Arabic segments: when a word or phrase is repeated across two segments, keep the corresponding translated overlap in both outputs when natural.\n\
         Keep each segment natural in the target language while using only words from the source translation.\n\
         For Chinese or other text without spaces, trim by existing characters or text units without adding spaces.\n\
         If the source translation contains words wrapped in ˹ ˺, keep them in the final trimmed output wherever they belong. They are part of the translation, not removable side comments.\n\
         Each segment also includes a wordByWordEnglish helper array for Arabic understanding only.\n\n\
         Batch JSON:\n{}",
        batch_json
    ))
}

/// Construit le prompt utilisateur pour un batch de bold.
pub fn build_bold_user_prompt(
    batch: &AdvancedBoldBatchPayload,
    custom_prompt_note: &str,
) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    let trimmed_note = custom_prompt_note.trim();
    let note_block = if trimmed_note.is_empty() {
        "User note: none provided.".to_string()
    } else {
        format!("User note:\n{}", trimmed_note)
    };

    Ok(format!(
        "Choose which translated words should be bolded for each subtitle segment and return JSON only.\n\
         Use the indexed translation as the source of truth for selectable words.\n\
         Do not rewrite the translation.\n\
         Return only `segmentIndex` and `boldWordIndexes`.\n\n\
         {}\n\n\
         Batch JSON:\n{}",
        note_block, batch_json
    ))
}

/// Construit le prompt utilisateur pour un batch WBW traduction.
pub fn build_wbw_translation_user_prompt(
    batch: &AdvancedWbwTranslationBatchPayload,
    custom_prompt_note: &str,
) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    let trimmed_note = custom_prompt_note.trim();
    let note_block = if trimmed_note.is_empty() {
        "User note: none provided.".to_string()
    } else {
        format!("User note:\n{}", trimmed_note)
    };

    Ok(format!(
        "Map each Arabic word to translation unit indexes and return JSON only.\n\
         Return exactly this compact shape: {{\"s\":[{{\"i\":0,\"r\":[{{\"i\":0,\"s\":0,\"e\":0}}]}}]}}.\n\
         Input keys: root `s` = segments; segment `i` = segment index; `v` = verse key; `a` = Arabic text; `w` = Arabic words; `t` = indexed translation; word `i` = word index; word `a` = Arabic; word `h` = helper.\n\
         Output keys: root `s` = segments; segment `i` = segment index; `r` = ranges; range `i` = Arabic word index; range `s` = start unit index; range `e` = end unit index.\n\
         Each segment must include at least one range per `w` item.\n\
         New split-range format: repeat the same range `i` when one Arabic word maps to non-consecutive translation units.\n\
         Do not rewrite the translation. Use only indexes from `t`.\n\
         Overlap, repeated ranges, and repeated range `i` values are allowed. If the mapping is difficult, still choose the most logical indexes.\n\n\
         Example 1 input:\n\
         {{\"w\":[{{\"i\":0,\"a\":\"وَوَجَدَكَ\",\"h\":\"And He found you\"}},{{\"i\":1,\"a\":\"ضَالًّا\",\"h\":\"lost\"}},{{\"i\":2,\"a\":\"فَهَدَى\",\"h\":\"so He guided\"}}],\"t\":\"0:Ne 1:t’a-t-Il 2:pas 3:trouvé 4:orphelin 5:? 6:Alors 7:Il 8:t’a 9:accueilli 10:!\"}}\n\
         Example 1 output ranges:\n\
         [{{\"i\":0,\"s\":0,\"e\":2}},{{\"i\":1,\"s\":3,\"e\":5}},{{\"i\":2,\"s\":6,\"e\":10}}]\n\n\
         Example 2 input:\n\
         {{\"w\":[{{\"i\":0,\"a\":\"وَلَلْآخِرَةُ\",\"h\":\"And surely the Hereafter\"}},{{\"i\":1,\"a\":\"خَيْرٌ\",\"h\":\"(is) better\"}},{{\"i\":2,\"a\":\"لَكَ\",\"h\":\"for you\"}},{{\"i\":3,\"a\":\"مِنَ\",\"h\":\"than\"}},{{\"i\":4,\"a\":\"الْأُولَى\",\"h\":\"the first\"}}],\"t\":\"0:La 1:vie 2:dernière 3:t’est, 4:certes, 5:meilleure 6:que 7:la 8:vie 9:présente.\"}}\n\
         Example 2 output ranges:\n\
         [{{\"i\":0,\"s\":0,\"e\":2}},{{\"i\":1,\"s\":3,\"e\":5}},{{\"i\":2,\"s\":3,\"e\":5}},{{\"i\":3,\"s\":6,\"e\":6}},{{\"i\":4,\"s\":7,\"e\":9}}]\n\n\
         Split-range example output ranges for one Arabic word mapped to `Ne` and `orphelin ?` in units [\"Ne\",\"t'a-t-Il\",\"pas\",\"trouve\",\"orphelin\",\"?\"]:\n\
         [{{\"i\":0,\"s\":0,\"e\":0}},{{\"i\":0,\"s\":4,\"e\":5}}]\n\n\
         {}\n\n\
         Batch JSON:\n{}",
        note_block, batch_json
    ))
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/// Construit un corps Chat Completions standard, avec raisonnement DeepSeek optionnel.
pub fn build_chat_completions_body(
    model: &str,
    deepseek_reasoning_effort: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
) -> Value {
    let mut body = json!({
        "model": model,
        "stream": true,
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],
        "response_format": {
            "type": "json_object"
        }
    });

    if let Some(reasoning_effort) = deepseek_reasoning_effort {
        let reasoning_enabled = reasoning_effort != "none";
        body["thinking"] = json!({
            "type": if reasoning_enabled { "enabled" } else { "disabled" }
        });
        if reasoning_enabled {
            body["reasoning_effort"] = json!(reasoning_effort);
        }
    }

    body
}

/// Construit un corps Responses API avec schéma JSON strict.
pub fn build_responses_api_body(
    model: &str,
    openai_reasoning_effort: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
    schema_name: &str,
    schema_description: &str,
    schema: &Value,
) -> Value {
    let mut body = json!({
        "model": model,
        "stream": true,
        "store": false,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": system_prompt
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
        "text": {
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "description": schema_description,
                "strict": true,
                "schema": schema
            }
        }
    });

    if let Some(reasoning_effort) = openai_reasoning_effort {
        body["reasoning"] = if reasoning_effort == "none" {
            json!({ "effort": reasoning_effort })
        } else {
            json!({
                "effort": reasoning_effort,
                "summary": "auto"
            })
        };
    }

    body
}

// ---------------------------------------------------------------------------
// Endpoint utilities
// ---------------------------------------------------------------------------

/// Normalise et valide l'endpoint texte IA.
pub fn normalize_text_ai_endpoint(endpoint: &str) -> Result<String, String> {
    let trimmed = endpoint.trim();
    let resolved = if trimmed.is_empty() {
        DEFAULT_TEXT_AI_ENDPOINT
    } else {
        trimmed
    };

    reqwest::Url::parse(resolved)
        .map_err(|error| format!("Invalid text AI endpoint: {}", error))?;

    Ok(resolved.to_string())
}

/// Indique si l'endpoint utilise le format Chat Completions.
pub fn is_chat_completions_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .map(|url| url.path().ends_with("/chat/completions"))
        .unwrap_or(false)
}

/// Indique si l'endpoint cible OpenRouter.
pub fn is_openrouter_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .map(|url| url.host_str() == Some("openrouter.ai"))
        .unwrap_or(false)
}

/// Indique si l'endpoint cible directement OpenAI.
pub fn is_openai_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .map(|url| url.host_str() == Some("api.openai.com"))
        .unwrap_or(false)
}

/// Indique si l'endpoint cible directement DeepSeek.
pub fn is_deepseek_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .map(|url| url.host_str() == Some("api.deepseek.com"))
        .unwrap_or(false)
}
