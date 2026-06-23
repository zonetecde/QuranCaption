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
