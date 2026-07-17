use serde_json::{json, Value};

use super::types::{
    AdvancedBoldBatchPayload, AdvancedTrimBatchPayload, AdvancedWbwTranslationBatchPayload,
    TranscriptCleanupBatchPayload,
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

pub const PROJECT_TRANSLATION_SYSTEM_PROMPT: &str = r#"You translate ordered structured Arabic Islamic lecture subtitles into polished, natural text in the requested target language.

Treat the context and target items as one continuous discourse. Subtitle boundaries are timing and display cuts, not automatic sentence boundaries. The application protects Quran passages and quotation anchors. Return structured JSON only. Never emit template markers such as `{{...}}` inside generated text, and never rewrite Quran reference markers.

Rules:
- Convey the speaker's intended meaning faithfully in idiomatic, well-written language suitable for subtitles. Avoid word-for-word calques and awkward source-language syntax.
- Preserve every substantive meaning, legal distinction, name, tone, and the symbol ﷺ. Never summarize, censor, authenticate, grade, explain, or add information.
- Use surrounding context to resolve an obvious ASR corruption, false start, or accidental repeated fragment only when the intended wording is clear. When it is uncertain, translate conservatively instead of inventing meaning.
- Determine punctuation and capitalization from the continuous sentence, not from subtitle boundaries. Never capitalize merely because an item or free-text slot starts. When a subtitle continues the previous sentence, begin with lowercase unless the target language itself requires a capital.
- Do not force every subtitle to read as an independent sentence. A subtitle may begin or end with a grammatical continuation when the spoken sentence crosses the timing boundary.
- Keep terminology, transliteration, spelling, apostrophes, and capitalization consistent throughout the batch and its context.
- Follow the Islamic terminology mode supplied in the user prompt exactly. For common transliterated technical terms, use lowercase except at a true sentence start; retain capitals for proper names, places, Allah, and other target-language proper nouns.
- Input root keys: `b` is read-only context before, `i` is the target item array, and `a` is read-only context after. Use both source `s` and existing target text `t` to preserve sentence continuity.
- Each target item has a compact batch-local index `i`, source free-text slots `f`, and ordered anchors `a`. Return that same small index; it is not a persistent project identifier.
- Anchor `k=c` is a non-Quran quotation. Translate its source `s` and return it in `c` using the same anchor id.
- Anchor `k=q` is Quran. Never translate it yourself and never return Quran text.
- For Quran anchors, `f=true` means full verse and `l=true` means locked. Do not return a range for either.
- For an editable partial Quran anchor, choose one contiguous 0-based range from the provided edition units `u` that best matches Arabic `a`, using English WBW helpers `w` when useful.
- The translated free text may be redistributed among the available slots so grammar is natural around the protected anchors. Keep anchor order unchanged.
- Free text may be redistributed across the existing slots. A slot may be an empty string when necessary, but the output array length must remain unchanged. Never duplicate or omit meaning during redistribution.
- Return every target subtitle exactly once and return no context item.
- Every target item must contain exactly the same number of free-text slots as the input.
- Return every citation anchor exactly once. Return every editable partial Quran anchor exactly once and no other Quran range.
- Generated free text and citation text must not contain `{{` or `}}`.
- Compact output keys: root `i`; item `i` subtitle id, `f` translated free-text slots, `c` citation translations, `q` Quran ranges. Citation keys: `i`,`t`. Quran range keys: `i`,`s`,`e`.
- Return JSON only, matching the schema exactly.
"#;

pub const TRANSCRIPT_CLEANUP_SYSTEM_PROMPT: &str = r#"You analyze an indexed Islamic lecture transcript before subtitle segmentation.

The application detects Quran candidates automatically before your review and creates `{{SS:VV}}` markers from accepted candidates. Words with `q=true` are protected from normal edits, but the automatic Quran match may still be false.

Return only conservative structured operations over the provided word IDs.

Rules:
- Preserve the spoken language, meaning, word order, and speaker wording.
- Never summarize, translate, invent, or freely rewrite speech. Never remove meaningful speech.
- You may remove only an immediate accidental oral restart: a short word or phrase fragment that is repeated because the speaker hesitates, stumbles, or restarts the same clause, where keeping both copies adds no meaning. Return a high-confidence correction that replaces the duplicated range with one clean occurrence.
- Example of a removable restart: `إذا لم ترتب إذا لم ترتب صلواتك` may become `إذا لم ترتب صلواتك` when the first occurrence is clearly an abandoned restart.
- Preserve intentional repetition used for emphasis, warning, exhortation, teaching, rhythm, quotation, supplication, or recitation. For example, keep `اتق الله، اتق الله`; repetition of a complete meaningful phrase is not automatically a disfluency.
- When uncertain whether repetition is accidental or intentional, preserve it. Never remove repetitions across protected Quran words.
- Never edit, quote, punctuate, or include a `q=true` word in `c`, `q`, `b`, or `p`. The only permitted operation on such words is a Quran rejection in `x`.
- A correction is allowed only when the ASR error is unquestionably evident from the surrounding context. Use the smallest contiguous ID range possible.
- Use confidence `high` only when the correction or quotation boundary is certain. The application applies only high-confidence operations.
- You are the sole authority for detecting non-Quran quotations. The application will never infer a hadith or scholar quote from keywords, punctuation, or reporting verbs.
- Detect only verbatim non-Quran quotations: a narrated hadith text, a scholar's exact words, or another unmistakable direct quotation.
- `hadith` includes a Companion's or narrator's verbatim report concerning the Prophet ﷺ; it is not limited to words spoken directly by the Prophet. Do not verify, source, grade, authenticate, or identify the narration.
- Treat reporting formulas and attributions such as `قال أنس`, `قال النبي`, `قال العالم`, `ذكر الشيخ`, or `روى فلان` as context outside the quotation. Begin at the first word belonging to the reported wording itself.
- Determine both boundaries semantically. A period, comma, silence, conjunction, same topic, or same speaker is only supporting evidence and never decides a quote boundary by itself.
- Continue through multiple clauses when they remain part of the same reported wording. Stop at the exact first word where the lecturer resumes explanation, commentary, argument, paraphrase, or application, even when that return begins with `و`, `ف`, `ثم`, or repeats the Prophet's name.
- Do not extend a quotation merely because the following commentary discusses the same person or subject.
- Before outputting each quote range, verify silently that: the attribution is excluded; the first included ID is genuinely quoted speech; the last included ID is the final quoted word before commentary resumes.
- Indexed boundary example: for `0:قال 1:أنس 2:لما 3:جاء 4:النبي ... 12:ولما 13:مات ... 17:شيء، 18:وما 19:جاء 20:النبي ...`, the correct quotation is `{"s":2,"e":17,"k":"hadith","f":"high"}`. IDs 0-1 are attribution and IDs 18 onward are the lecturer's commentary.
- Do not mark paraphrases, explanations, summaries, common religious expressions, or uncertain wording as quotations.
- `scholar` means exact words attributed to a named or clearly identified scholar; `generic` means another unmistakable direct quotation.
- Use `high` only when both the start and end boundaries are certain. If either boundary is uncertain, return `medium` or omit the quote; the application applies only `high` ranges.
- Quote ranges may continue across batches. Return only the exact quoted portion visible in the current batch and rely on overlapping context to preserve the true boundary.
- For `q=true`, `t` is the Quran text inserted by the local matcher, `r` is its Quran reference, and `o` on the first word of the candidate is the original ASR passage before replacement.
- Reject a Quran candidate in `x` only when the original ASR wording and surrounding discourse make it highly certain that the detected passage is not Quran or that the matched verse is wrong.
- A valid rejection must cover the complete contiguous Quran candidate visible in the batch. Do not reject a genuine partial recitation merely because it is incomplete, paraphrased around, or imperfectly recognized.
- If confidence is not high, preserve the Quran candidate by omitting it from `x`.
- If protected Quran words occur inside a larger reported passage, never include them in `q`; return separate non-Quran quote ranges on either side only when those ranges are independently certain.
- Treat the ordered words as continuous discourse and suggest subtitle boundaries in `b` only where both sides remain natural and understandable.
- Prefer boundaries after complete clauses, completed questions, list items, or meaningful pauses. Keep articles, prepositions, conjunctions, auxiliaries, negations, noun phrases, and verb complements with the words they depend on.
- Never create an orphan fragment merely to meet a preferred length. Avoid splitting a short expression, enumeration, legal condition, question, or cause-and-effect relation across awkward boundaries; a slightly longer coherent subtitle is preferable.
- Add punctuation only when it is strongly supported by syntax and context. Return punctuation separately in `p`; never insert it into a correction unless it is part of the corrected token itself.
- Replace a routine salutation immediately after mentioning Prophet Muhammad with `ﷺ` only when unquestionably certain and only through a correction operation. Do not do this when the wording of the salutation is itself being taught or quoted.
- Return JSON only. Compact keys: `c` corrections, `q` quotation ranges, `x` rejected automatic Quran ranges, `b` preferred break-after IDs, `p` punctuation-after operations. Correction keys: `s`,`e`,`t`,`f`. Quote keys: `s`,`e`,`k`,`f`. Quran rejection keys: `s`,`e`,`f`. Punctuation keys: `i`,`v`.
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

/// Schéma JSON de réponse pour l'analyse structurée d'une transcription.
pub fn build_project_translation_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "i": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "i": { "type": "integer" },
                        "f": { "type": "array", "items": { "type": "string" } },
                        "c": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "i": { "type": "string" },
                                    "t": { "type": "string" }
                                },
                                "required": ["i", "t"]
                            }
                        },
                        "q": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "i": { "type": "string" },
                                    "s": { "type": "integer" },
                                    "e": { "type": "integer" }
                                },
                                "required": ["i", "s", "e"]
                            }
                        }
                    },
                    "required": ["i", "f", "c", "q"]
                }
            }
        },
        "required": ["i"]
    })
}

/// Schéma JSON de réponse pour l'analyse structurée d'une transcription.
pub fn build_transcript_cleanup_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "c": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "s": { "type": "integer" },
                        "e": { "type": "integer" },
                        "t": { "type": "string" },
                        "f": { "type": "string", "enum": ["high", "medium", "low"] }
                    },
                    "required": ["s", "e", "t", "f"]
                }
            },
            "q": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "s": { "type": "integer" },
                        "e": { "type": "integer" },
                        "k": { "type": "string", "enum": ["hadith", "scholar", "generic"] },
                        "f": { "type": "string", "enum": ["high", "medium", "low"] }
                    },
                    "required": ["s", "e", "k", "f"]
                }
            },
            "x": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "s": { "type": "integer" },
                        "e": { "type": "integer" },
                        "f": { "type": "string", "enum": ["high", "medium", "low"] }
                    },
                    "required": ["s", "e", "f"]
                }
            },
            "b": {
                "type": "array",
                "items": { "type": "integer" }
            },
            "p": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "i": { "type": "integer" },
                        "v": { "type": "string" }
                    },
                    "required": ["i", "v"]
                }
            }
        },
        "required": ["c", "q", "x", "b", "p"]
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

/// Construit le prompt utilisateur pour un batch d'analyse de transcription.
pub fn build_project_translation_user_prompt(
    target_language: &str,
    islamic_term_mode: &str,
    batch: &Value,
) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize project translation batch: {}", error))?;
    let term_instruction = match islamic_term_mode {
        "translated" => {
            "Use only the natural target-language equivalent for Arabic Islamic technical terms; do not include a transliteration. Example in French: `jurisprudence islamique`."
        }
        "both" => {
            "Use a genuine natural target-language translation followed immediately by a consistent lowercase transliteration in parentheses, but only when the two forms add distinct information. Example in French: `jurisprudence malikite (fiqh maliki)`. Never put one transliteration after another transliteration or repeat an almost identical borrowed form: write `Dhuhr`, `Asr`, `Maghrib`, or `Icha`, never `Dhuhr (dhouhr)`, `Asr (asr)`, `Maghrib (maghrib)`, or `Icha (icha)`. The text before parentheses must be an actual translation, so write `jurisprudence malikite (fiqh maliki)`, not `fiqh malikite (fiqh maliki)`. Do not apply this parenthetical format to proper names or terms already conventionally used in the target language in essentially the same form."
        }
        "transliterated" => {
            "Use only a consistent, readable transliteration for Arabic Islamic technical terms; do not add the translated equivalent. Example: `fiqh`."
        }
        _ => return Err("Invalid Islamic terminology mode.".to_string()),
    };

    Ok(format!(
        "Translate the target items into {} and return JSON only.\n\
         Islamic terminology mode: {}\n\
         Return exactly this compact shape: {{\"i\":[{{\"i\":0,\"f\":[\"...\"],\"c\":[{{\"i\":\"citation-0\",\"t\":\"...\"}}],\"q\":[{{\"i\":\"quran-0\",\"s\":0,\"e\":4}}]}}]}}.\n\
         All item `i` values are compact indexes local to this batch. Return each target index exactly as provided.\n\
         `b` and `a` are context only and must never be returned.\n\
         Keep every protected anchor in its original relative order by filling only free-text slots, citation texts, and editable Quran ranges.\n\n\
         Batch JSON:\n{}",
        target_language.trim(),
        term_instruction,
        batch_json
    ))
}

/// Construit le prompt utilisateur pour un batch d'analyse de transcription.
pub fn build_transcript_cleanup_user_prompt(
    batch: &TranscriptCleanupBatchPayload,
) -> Result<String, String> {
    let batch_json = serde_json::to_string_pretty(batch)
        .map_err(|error| format!("Failed to serialize batch: {}", error))?;

    Ok(format!(
        "Analyze these ordered indexed words and return JSON only.\n\
         Return exactly this shape: {{\"c\":[],\"q\":[],\"x\":[],\"b\":[],\"p\":[]}}.\n\
         Input keys: `w` is the ordered word array; word `i` is its stable ID; `p` is the speaker; `t` is the current token with punctuation; `q=true` marks an automatic Quran candidate; `r` is its Quran reference; `o` is the original ASR passage on the candidate's first token; `g` is the silence in seconds before the next word, or null at the batch end.\n\
         Corrections: {{\"s\":firstId,\"e\":lastId,\"t\":\"replacement words\",\"f\":\"high|medium|low\"}}.\n\
         Verbatim non-Quran quotations: {{\"s\":firstId,\"e\":lastId,\"k\":\"hadith|scholar|generic\",\"f\":\"high|medium|low\"}}. The range must exclude attribution and stop before commentary resumes.\n\
         False automatic Quran candidates: {{\"s\":firstQuranId,\"e\":lastQuranId,\"f\":\"high|medium|low\"}} in `x`; only high-confidence complete candidate ranges are applied.\n\
         `b` contains IDs after which a natural complete-meaning subtitle break is preferred.\n\
         `p` contains punctuation operations shaped {{\"i\":wordId,\"v\":\"،\"}}.\n\
         Never output Quran references or braces. Never include a q=true word in `c`, `q`, `b`, or `p`; use only `x` to reject a false automatic Quran match.\n\
         Empty arrays are correct when there is nothing certain to change or annotate.\n\n\
         Batch JSON:\n{}",
        batch_json
    ))
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/// Construit un corps Chat Completions standard.
pub fn build_chat_completions_body(
    model: &str,
    reasoning_effort: &str,
    endpoint: &str,
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

    if is_deepseek_endpoint(endpoint) && reasoning_effort != "none" {
        let body = body
            .as_object_mut()
            .expect("Chat Completions body must be an object");
        body.insert("reasoning_effort".to_string(), json!(reasoning_effort));
        body.insert("thinking".to_string(), json!({ "type": "enabled" }));
    }

    body
}

/// Construit un corps Responses API avec schéma JSON strict.
pub fn build_responses_api_body(
    model: &str,
    reasoning_effort: &str,
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

    // "none" is an application setting; the Responses API expects the field to be omitted.
    if reasoning_effort != "none" {
        body.as_object_mut()
            .expect("Responses API body must be an object")
            .insert(
                "reasoning".to_string(),
                json!({ "effort": reasoning_effort, "summary": "auto" }),
            );
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

/// Indique si l'endpoint cible l'API directe DeepSeek.
pub fn is_deepseek_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .map(|url| url.host_str() == Some("api.deepseek.com"))
        .unwrap_or(false)
}

/// Indique si l'endpoint cible OpenRouter.
pub fn is_openrouter_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .map(|url| url.host_str() == Some("openrouter.ai"))
        .unwrap_or(false)
}
