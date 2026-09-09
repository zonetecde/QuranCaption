use serde::{Deserialize, Serialize};

/// Requête commune pour les trois commandes de trimming IA.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub batch_id: String,
    pub batch: AdvancedTrimBatchPayload,
}

/// Requête pour la commande de mise en gras IA.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedBoldCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub batch_id: String,
    pub custom_prompt_note: String,
    pub batch: AdvancedBoldBatchPayload,
}

/// Requête pour la commande de mapping WBW traduction IA.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedWbwTranslationCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub batch_id: String,
    pub custom_prompt_note: String,
    pub batch: AdvancedWbwTranslationBatchPayload,
}

/// Requête pour le nettoyage et la détection de citations d'une transcription.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptCleanupCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub thinking_enabled: Option<bool>,
    pub batch_id: String,
    pub batch: TranscriptCleanupBatchPayload,
}

/// Requête pour l'analyse sémantique des coupures d'une transcription nettoyée.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegmentationCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub thinking_enabled: Option<bool>,
    pub batch_id: String,
    pub batch: serde_json::Value,
}

/// Requête pour la traduction structurée d'un batch de sous-titres.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTranslationCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub thinking_enabled: Option<bool>,
    pub batch_id: String,
    pub target_language: String,
    pub islamic_term_mode: String,
    pub batch: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimBatchPayload {
    pub verses: Vec<AdvancedTrimVersePayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedBoldBatchPayload {
    pub segments: Vec<AdvancedBoldSegmentPayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedWbwTranslationBatchPayload {
    #[serde(rename = "s", alias = "segments")]
    pub segments: Vec<AdvancedWbwTranslationSegmentPayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptCleanupBatchPayload {
    #[serde(rename = "w", alias = "words")]
    pub words: Vec<TranscriptCleanupWordPayload>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TranscriptCleanupWordPayload {
    pub i: i64,
    pub p: i64,
    pub t: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub q: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub o: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub g: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimVersePayload {
    pub verse_key: String,
    pub translation: String,
    pub segments: Vec<AdvancedTrimSegmentPayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimSegmentPayload {
    pub i: i32,
    pub arabic: String,
    pub word_by_word_english: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedBoldSegmentPayload {
    pub segment_index: i64,
    pub verse_key: String,
    pub segment_arabic: String,
    pub translation_indexed: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedWbwTranslationArabicWordPayload {
    #[serde(rename = "i", alias = "index")]
    pub index: i64,
    #[serde(rename = "a", alias = "arabic")]
    pub arabic: String,
    #[serde(rename = "h", alias = "helper")]
    pub helper: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedWbwTranslationSegmentPayload {
    #[serde(rename = "i", alias = "segmentIndex")]
    pub segment_index: i64,
    #[serde(rename = "v", alias = "verseKey")]
    pub verse_key: String,
    #[serde(rename = "a", alias = "segmentArabic")]
    pub segment_arabic: String,
    #[serde(rename = "w", alias = "arabicWords")]
    pub arabic_words: Vec<AdvancedWbwTranslationArabicWordPayload>,
    #[serde(rename = "t", alias = "translationIndexed")]
    pub translation_indexed: String,
}
