/// URL racine de l'API FastAPI v1 Quranic Universal Aligner en production.
pub const QURAN_MULTI_ALIGNER_API_V1_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/api/v1";

/// Flag de developpement pour forcer un payload mock au lieu d'appeler le cloud.
pub const QURAN_SEGMENTATION_USE_MOCK: bool = false;

/// Payload mock utilise quand `QURAN_SEGMENTATION_USE_MOCK` est active.
pub const QURAN_SEGMENTATION_MOCK_PAYLOAD: &str = r#"
{
    "segments": [
        {
        "confidence": 0.5,
        "error": null,
        "matched_text": "Ø£Ø¹ÙˆØ° Ø¨Ø§Ù„Ù„Ù‡ Ù…Ù† Ø§Ù„Ø´ÙŠØ·Ø§Ù† Ø§Ù„Ø±Ø¬ÙŠÙ…",
        "ref_from": "Isti'adha",
        "ref_to": "Isti'adha",
        "segment": 1,
        "time_from": 0.63,
        "time_to": 6.11
    }
    ]
}
"#;

/// Clip audio transmis par le frontend pour une segmentation avec merge temporel.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentationAudioClip {
    /// Chemin du fichier audio.
    pub path: String,
    /// Debut du clip en millisecondes.
    pub start_ms: i64,
    /// Fin du clip en millisecondes.
    pub end_ms: i64,
    /// Debut du clip dans le fichier source, en millisecondes.
    #[serde(default)]
    pub source_start_ms: i64,
}

/// Segment audio a dupliquer pour generer une piste Hifz.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HifzAudioSegment {
    /// Debut du segment dans la timeline source, en millisecondes.
    pub start_ms: i64,
    /// Fin du segment dans la timeline source, en millisecondes.
    pub end_ms: i64,
    /// Nombre de repetitions a inserer pour ce segment.
    pub repeat_count: u32,
    /// Silence a inserer entre deux repetitions de ce segment, en millisecondes.
    pub silence_between_repetitions_ms: Option<i64>,
}
