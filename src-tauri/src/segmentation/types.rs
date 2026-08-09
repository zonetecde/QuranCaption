/// URL racine de l'API Gradio Quran Multi-Aligner.
pub const QURAN_MULTI_ALIGNER_BASE_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api";
/// Endpoint d'upload Gradio.
pub const QURAN_MULTI_ALIGNER_UPLOAD_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/upload";
/// Endpoint d'appel du pipeline complet.
pub const QURAN_MULTI_ALIGNER_PROCESS_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/process_audio_session";
/// Endpoint d'appel de l'estimation de duree.
pub const QURAN_MULTI_ALIGNER_ESTIMATE_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/estimate_duration";
/// Endpoint MFA base sur une session cloud existante.
pub const QURAN_MULTI_ALIGNER_MFA_SESSION_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/timestamps";
/// Endpoint MFA direct sur un fichier audio uploade.
pub const QURAN_MULTI_ALIGNER_MFA_DIRECT_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/timestamps_direct";
/// Endpoint de split des segments par contraintes (versets/mots/duree).
pub const QURAN_MULTI_ALIGNER_SPLIT_SEGMENTS_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/split_segments";
/// Endpoint preload : catalogue des recitations + chapitres disponibles.
pub const QURAN_MULTI_ALIGNER_PRELOAD_RECITATIONS_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/preload_recitations";
/// Endpoint preload : segments pre-alignes (+ timestamps mot a mot) d'une recitation/chapitre.
pub const QURAN_MULTI_ALIGNER_PRELOAD_SEGMENTS_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/preload_segments";
/// Endpoint preload audio-only : catalogue des recitations non publiees (audio seul).
pub const QURAN_MULTI_ALIGNER_PRELOAD_AUDIO_RECITATIONS_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/preload_audio_recitations";
/// Endpoint preload audio-only : URL audio directe d'un chapitre (sans segments).
pub const QURAN_MULTI_ALIGNER_PRELOAD_AUDIO_CALL_URL: &str =
    "https://hetchyy-quranic-universal-aligner.hf.space/gradio_api/call/preload_audio";

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
