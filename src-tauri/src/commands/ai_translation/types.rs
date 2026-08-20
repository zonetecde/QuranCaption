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

/// Requête pour la commande de découpage sémantique des sous-titres.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSubtitleSplitCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub batch_id: String,
    pub batch: AdvancedSubtitleSplitBatchPayload,
}

/// Requête pour la vérification IA des traductions déjà découpées.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationReviewCommandRequest {
    pub api_key: String,
    pub endpoint: String,
    pub model: String,
    pub reasoning_effort: String,
    pub batch_id: String,
    pub batch: AiTranslationReviewBatchPayload,
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

/// Lot de sous-titres à découper selon leur sens.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSubtitleSplitBatchPayload {
    #[serde(rename = "s", alias = "segments")]
    pub segments: Vec<AdvancedSubtitleSplitSegmentPayload>,
}

/// Lot de versets et de segments à contrôler sans réécrire leur traduction.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationReviewBatchPayload {
    pub verses: Vec<AiTranslationReviewVersePayload>,
}

/// Contexte complet d'un verset pour une édition de traduction.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationReviewVersePayload {
    pub edition_language: String,
    pub verse_key: String,
    pub source_translation: String,
    pub segments: Vec<AiTranslationReviewSegmentPayload>,
}

/// Segment traduit et bornes actuellement enregistrées dans le projet.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationReviewSegmentPayload {
    pub id: i64,
    pub arabic_start: i64,
    pub arabic_end: i64,
    pub arabic: String,
    pub word_by_word_english: Vec<String>,
    pub is_full_verse: bool,
    pub selected_translation: String,
    pub selected_range: Option<[i64; 2]>,
    pub is_custom_text: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimVersePayload {
    pub verse_key: String,
    pub has_full_verse_coverage: bool,
    pub translation: String,
    pub segments: Vec<AdvancedTrimSegmentPayload>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTrimSegmentPayload {
    pub i: i32,
    pub arabic_start: i32,
    pub arabic_end: i32,
    pub arabic: String,
    pub word_by_word_english: Vec<String>,
    pub needs_ai: bool,
    pub locked_range: Option<[i32; 2]>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedBoldSegmentPayload {
    pub segment_index: i64,
    pub verse_key: String,
    pub segment_arabic: String,
    pub translation_indexed: String,
}

/// Sous-titre arabe et contrainte de taille transmis au modèle.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSubtitleSplitSegmentPayload {
    #[serde(rename = "i", alias = "segmentIndex")]
    pub segment_index: i64,
    #[serde(rename = "v", alias = "verseKey")]
    pub verse_key: String,
    #[serde(rename = "m", alias = "maxWords")]
    pub max_words: i64,
    #[serde(rename = "w", alias = "words")]
    pub words: String,
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
