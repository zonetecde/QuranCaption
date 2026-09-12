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

/// Moteur de segmentation locale supporte.
#[derive(Clone, Copy, Debug)]
pub enum LocalSegmentationEngine {
    /// Moteur historique base sur Whisper.
    LegacyWhisper,
    /// Nouveau moteur multi-aligner prive.
    MultiAligner,
    /// Pipeline locale Surah Splitter basee sur WhisperX et detection d'ayahs.
    SurahSplitter,
    /// Pipeline locale hors-ligne WordTiming basee sur FastConformer et CTC.
    QuranWordTiming,
}

impl LocalSegmentationEngine {
    /// Construit le moteur depuis la valeur brute recue du frontend.
    pub fn from_raw(raw: &str) -> Result<Self, String> {
        match raw {
            "legacy" | "legacy_whisper" => Ok(Self::LegacyWhisper),
            "multi" | "multi_aligner" => Ok(Self::MultiAligner),
            "surah_splitter" | "surah-splitter" => Ok(Self::SurahSplitter),
            "word_timing" | "word_timing_offline" | "quran_word_timing" => Ok(Self::QuranWordTiming),
            _ => Err(format!(
                "Unknown local segmentation engine '{}'. Expected 'legacy', 'multi', 'surah_splitter', or 'word_timing_offline'.",
                raw
            )),
        }
    }

    /// Retourne la cle technique courte du moteur.
    pub fn as_key(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "legacy",
            Self::MultiAligner => "multi",
            Self::SurahSplitter => "surah_splitter",
            Self::QuranWordTiming => "word_timing_offline",
        }
    }

    /// Retourne le label humain du moteur.
    pub fn as_label(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "Legacy Whisper",
            Self::MultiAligner => "Multi-Aligner",
            Self::SurahSplitter => "Surah Splitter",
            Self::QuranWordTiming => "Quran Karim words alignment",
        }
    }

    /// Retourne le chemin relatif du fichier requirements du moteur.
    pub fn requirements_relative_path(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "python/requirements.txt",
            Self::MultiAligner => "python/quran-multi-aligner/requirements.txt",
            Self::SurahSplitter => "python/surah_splitter_requirements.txt",
            Self::QuranWordTiming => "python/word_timing_requirements.txt",
        }
    }

    /// Retourne le chemin relatif du script Python de segmentation locale.
    pub fn script_relative_path(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "python/local_segmenter.py",
            Self::MultiAligner => "python/local_multi_aligner_segmenter.py",
            Self::SurahSplitter => "python/local_surah_splitter_segmenter.py",
            Self::QuranWordTiming => "python/local_word_timing_segmenter.py",
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
            Self::SurahSplitter => &[
                "torch",
                "torchaudio",
                "whisperx",
                "huggingface_hub",
                "numpy",
                "loguru",
                "rich",
                "pydub",
            ],
            Self::QuranWordTiming => &[
                "numpy",
                "librosa",
                "pyloudnorm",
                "onnxruntime",
                "kaldi_native_fbank",
                "sherpa_onnx",
                "qua_sdk",
            ],
        }
    }
}
