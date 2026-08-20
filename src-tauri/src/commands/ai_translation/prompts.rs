use serde_json::{json, Value};

use super::types::{
    AdvancedBoldBatchPayload, AdvancedSubtitleSplitBatchPayload, AdvancedTrimBatchPayload,
    AdvancedWbwTranslationBatchPayload, AiTranslationReviewBatchPayload,
};

pub const DEFAULT_TEXT_AI_ENDPOINT: &str = "https://api.openai.com/v1/responses";

pub const ADVANCED_TRIM_SYSTEM_PROMPT: &str = r#"Role: Align Quran Arabic subtitle fragments to an existing indexed translation.

Goal: For each segment with needsAi=true, copy the smallest contiguous source span that expresses the Arabic words actually present in that segment. Return copied source text, not a new translation.

Priority order:
1. Exact Arabic semantic boundaries. Never add meaning from Arabic words outside arabicStart..arabicEnd merely to complete a sentence.
2. Express every included Arabic content word, required predicate, and translated coordination particle.
3. Copy one exact contiguous source span, preserving spelling, punctuation, brackets, typography, and order.
4. Required overlap and repetition.
5. Natural boundaries when they do not violate rules 1-2.
6. Conditional coverage, which never overrides semantic boundaries.

Boundary and overlap decisions:
- Use wordByWordEnglish only to understand Arabic; never copy helper wording absent from translation.
- When Arabic begins with a coordination particle such as وَ, فَ, ثُمَّ, أَوْ, بَلْ, لَٰكِنْ, or أَمْ, include its translated leading connector when present, such as "and", "so", "then", "or", "but", "while", or "whereas".
- A fragment may intentionally end at a dependency boundary. If its Arabic ends at a connector, include the matching target connector but not the absent content phrase: "capable of", not "capable of resurrecting".
- Target-language reordering may force a contiguous span across intervening translated words. Include the smallest span through the required predicate, even when an intervening coordinated item is unavoidable. Example: if Arabic means "hearing and eyes testified against them" while the source says "hearing, eyes and skins testified against them", include through "testified against them"; stopping after "eyes" loses the predicate.
- If a final Arabic cognate object only emphasizes a verb and the source completes its noun phrase with an adjective belonging to the next Arabic word, prefer the already-complete verb. Example: Arabic ending at "curse them a curse" before "great", with source "... and curse them with a great curse", maps through "curse them", not dangling "with a great" and not omitted "great curse".
- Otherwise allow only the smallest spillover required by target word order. Never absorb an adjacent clause.
- Use arabicStart/arabicEnd numerically. Intersecting Arabic ranges require translated overlap on the corresponding shared phrase. Keep overlap minimal; one shared boundary word does not justify copying the whole neighboring segment.
- Containment in Arabic normally implies containment of translated meaning. Identical repeated Arabic normally uses identical spans; source order may move backward for repetition.
- Avoid dangling conjunctions belonging only to the next Arabic segment.

Context and coverage:
- needsAi=false segments are immutable anchors. Use lockedRange and do not return them.
- If hasFullVerseCoverage=true, partial segments need not cover the verse. Never assign the full translation to a fragment for coverage.
- Otherwise, the union of locked and requested spans should cover the source. Attach only unaligned punctuation or neutral filler to the nearest span; never content from another Arabic clause.

Output exactly one {i,text} for every and only needsAi=true segment. Verify verbatim contiguous copying, semantic boundaries, required predicates and connectors, minimal overlaps, repetition, and applicable coverage. Return JSON only.
"#;

pub const AI_TRANSLATION_REVIEW_SYSTEM_PROMPT: &str = r#"Role: Audit existing Quran subtitle translation trims. Never rewrite any translation.

For each edition and verse, compare every selectedTranslation with its Arabic segment, the indexed full sourceTranslation, and the other segments of the same verse. Return only high-confidence, obvious errors. A human will review every segment you flag, so false positives are costly.

Flag a segment only for one of these reasons:
- out_of_bounds: when isCustomText=false, selectedRange is invalid, reversed, or outside sourceTranslation.
- source_mismatch: selectedTranslation clearly does not match the indicated source span. Skip this check when isCustomText=true.
- semantic_mismatch: the selection expresses a different Arabic phrase or meaning.
- missing_meaning: it omits an essential included content word, predicate, object, or translated coordination particle.
- excess_meaning: it includes meaning from Arabic outside arabicStart..arabicEnd. This includes assigning the whole verse translation to a partial Arabic fragment.
- overlap_mismatch: Arabic ranges overlap but the selections fail to share the corresponding translated meaning, or non-overlapping Arabic segments unnecessarily duplicate a neighboring clause.
- repetition_mismatch: identical repeated Arabic is handled inconsistently without a source-order or grammar reason.

Review rules:
- sourceTranslation entries are `index:unit`; indexes are 0-based and selectedRange is inclusive.
- isFullVerse=true normally requires the full verse meaning. isFullVerse=false must never receive the entire verse merely for sentence completeness or coverage.
- Respect target-language reordering. Minimal unavoidable spillover, shared predicates, pronouns, articles, punctuation, and natural overlap are valid.
- A segment may intentionally stop at a dependency boundary. Do not demand meaning belonging to Arabic words outside its bounds.
- wordByWordEnglish is semantic help only; do not require its exact wording in another translation language.
- Custom text may paraphrase and has no reliable source range; judge only obvious semantic boundary errors.
- Review AI-trimmed, manually trimmed, reviewed, and default translations by the same rules.
- Do not flag stylistic preferences, alternate valid wording, punctuation-only differences, minor grammar, or any uncertain case.
- If no segment has an obvious error, return an empty issues array.

Output JSON only. Each flagged id must appear once with exactly one strongest reason. Never return clean ids.
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

pub const ADVANCED_SUBTITLE_SPLIT_SYSTEM_PROMPT: &str = r#"You split Arabic Quran subtitle segments into the smallest possible number of meaningful chunks.

Rules:
- Input keys: root `s` = segments; segment `i` = segment index, `v` = verse key, `m` = max words, `w` = space-separated `index:Arabic` words using absolute 0-based Quran word indexes.
- Output keys: root `s` = segments; segment `i` = segment index, `e` = chunk end word indexes.
- Every value in `e` is the inclusive index of the last word in the current chunk. It is never the first word of the next chunk.
- After an end index `x`, the next chunk starts at index `x + 1`.
- Return one inclusive end index in `e` for every resulting chunk, including the final input word index.
- Every chunk must contain at most `m` words.
- Use exactly ceil(the number of indexed words in `w` / `m`) chunks: no more and no fewer.
- Preserve the original word order and include every word exactly once.
- Choose boundaries at the most semantically natural locations possible.
- Prefer complete phrases and clauses, Quranic stop signs, and syntactic boundaries.
- Avoid ending a chunk on a conjunction, preposition, particle, relative pronoun, or other word whose meaning depends on what follows whenever another valid boundary exists.
- Never rewrite, reorder, remove, or add Arabic words.
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

/// Schéma JSON de réponse pour le découpage sémantique des sous-titres.
pub fn build_subtitle_split_response_schema() -> Value {
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
                        "e": {
                            "type": "array",
                            "items": {
                                "type": "integer"
                            }
                        }
                    },
                    "required": ["i", "e"]
                }
            }
        },
        "required": ["s"]
    })
}

/// Schéma JSON de réponse pour la vérification des traductions.
pub fn build_translation_review_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "id": { "type": "integer" },
                        "reason": {
                            "type": "string",
                            "enum": [
                                "out_of_bounds",
                                "source_mismatch",
                                "semantic_mismatch",
                                "missing_meaning",
                                "excess_meaning",
                                "overlap_mismatch",
                                "repetition_mismatch"
                            ]
                        }
                    },
                    "required": ["id", "reason"]
                }
            }
        },
        "required": ["issues"]
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
        "Align this batch of verses and return JSON only.\n\
         Output shape must be exactly {{\"verses\":[{{\"verseKey\":\"...\",\"segments\":[{{\"i\":0,\"text\":\"...\"}}]}}]}}.\n\
         The translation uses `index:unit` entries. Copy only the unit values after the first colon into `text`, never the numeric prefixes. Preserve each selected value verbatim; for Chinese or other text without spaces, do not insert spaces between characters.\n\
         Return only segments where needsAi=true. Treat needsAi=false segments and their inclusive lockedRange as immutable context.\n\
         Use hasFullVerseCoverage to apply the conditional coverage rule.\n\n\
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

/// Construit le prompt utilisateur pour un lot de découpage sémantique.
pub fn build_subtitle_split_user_prompt(
    batch: &AdvancedSubtitleSplitBatchPayload,
) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    Ok(format!(
        "Split every Arabic subtitle into meaningful chunks and return JSON only.\n\
         Return exactly {{\"s\":[{{\"i\":0,\"e\":[4,9]}}]}}.\n\
         Input keys: `s` = segments; `i` = segment index; `v` = verse key; `m` = max words; `w` = space-separated `index:Arabic` words.\n\
         Output keys: `s` = segments; `i` = segment index; `e` = inclusive absolute index of the last word in every chunk, including the subtitle's final word.\n\
         An index in `e` is never the first word of the next chunk: if one chunk ends at `x`, the next chunk starts at `x + 1`.\n\
         Example: with `w` = `0:قَالُوا 1:سُبْحَانَكَ 2:لَا 3:عِلْمَ 4:لَنَا 5:إِلَّا 6:مَا 7:عَلَّمْتَنَا` and `e` = `[4,7]`, the chunks are words `0..4` and `5..7`.\n\
         Each chunk must contain at most `m` words and the number of chunks must be ceil(the number of indexed words in `w` / `m`).\n\n\
         Batch JSON:\n{}",
        batch_json
    ))
}

/// Construit le prompt utilisateur pour un lot de vérification des traductions.
pub fn build_translation_review_user_prompt(
    batch: &AiTranslationReviewBatchPayload,
) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    Ok(format!(
        "Audit this batch conservatively and return JSON only.\n\
         Return exactly {{\"issues\":[{{\"id\":0,\"reason\":\"excess_meaning\"}}]}} or {{\"issues\":[]}} when no obvious error exists.\n\
         Do not return explanations, corrected text, or clean segment ids.\n\n\
         Batch JSON:\n{}",
        batch_json
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
