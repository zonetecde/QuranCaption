/// URL racine de l'API Gradio Quran Multi-Aligner.
pub const QURAN_MULTI_ALIGNER_BASE_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api";
/// Endpoint d'upload Gradio.
pub const QURAN_MULTI_ALIGNER_UPLOAD_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api/upload";
/// Endpoint d'appel du pipeline complet.
pub const QURAN_MULTI_ALIGNER_PROCESS_CALL_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api/call/process_audio_session";
/// Endpoint d'appel de l'estimation de durée.
pub const QURAN_MULTI_ALIGNER_ESTIMATE_CALL_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api/call/estimate_duration";

/// Flag de développement pour forcer un payload mock au lieu d'appeler le cloud.
pub const QURAN_SEGMENTATION_USE_MOCK: bool = false;

/// Payload mock utilisé quand `QURAN_SEGMENTATION_USE_MOCK` est activé.
pub const QURAN_SEGMENTATION_MOCK_PAYLOAD: &str = r#"
{
    "segments": [
        {
        "confidence": 0.5,
        "error": null,
        "matched_text": "أعوذ بالله من الشيطان الرجيم",
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
    /// Début du clip en millisecondes.
    pub start_ms: i64,
    /// Fin du clip en millisecondes.
    pub end_ms: i64,
}

/// Moteur de segmentation locale supporté.
#[derive(Clone, Copy, Debug)]
pub enum LocalSegmentationEngine {
    /// Moteur historique basé sur Whisper.
    LegacyWhisper,
    /// Nouveau moteur multi-aligner.
    MultiAligner,
}

impl LocalSegmentationEngine {
    /// Construit le moteur depuis la valeur brute reçue du frontend.
    pub fn from_raw(raw: &str) -> Result<Self, String> {
        match raw {
            "legacy" | "legacy_whisper" => Ok(Self::LegacyWhisper),
            "multi" | "multi_aligner" => Ok(Self::MultiAligner),
            _ => Err(format!(
                "Unknown local segmentation engine '{}'. Expected 'legacy' or 'multi'.",
                raw
            )),
        }
    }

    /// Retourne la clé technique courte du moteur.
    pub fn as_key(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "legacy",
            Self::MultiAligner => "multi",
        }
    }

    /// Retourne le label humain du moteur.
    pub fn as_label(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "Legacy Whisper",
            Self::MultiAligner => "Multi-Aligner",
        }
    }

    /// Retourne le chemin relatif du fichier requirements du moteur.
    pub fn requirements_relative_path(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "python/requirements.txt",
            Self::MultiAligner => "python/quran-multi-aligner/requirements.txt",
        }
    }

    /// Retourne le chemin relatif du script Python de segmentation locale.
    pub fn script_relative_path(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "python/local_segmenter.py",
            Self::MultiAligner => "python/local_multi_aligner_segmenter.py",
        }
    }

    /// Retourne les modules Python minimaux attendus pour valider l'installation.
    pub fn required_import_modules(&self) -> &'static [&'static str] {
        match self {
            Self::LegacyWhisper => &["torch", "transformers", "librosa", "numpy", "soundfile"],
            Self::MultiAligner => &[
                "torch",
                "transformers",
                "librosa",
                "numpy",
                "soundfile",
                "recitations_segmenter",
                "gradio",
                "accelerate",
                "pyarrow",
                "requests",
            ],
        }
    }
}
