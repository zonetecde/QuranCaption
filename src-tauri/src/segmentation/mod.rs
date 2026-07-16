/// Types et constantes du domaine segmentation.
pub mod types;

mod audio_merge;
mod cloud;
mod data_files;
mod hifz;
mod install;
mod local;
mod python_env;
mod requirements;
mod status;

pub use cloud::{
    estimate_duration, mfa_timestamps_session, preload_audio, preload_audio_recitations,
    preload_recitations, preload_segments, segment_quran_audio,
};
pub use hifz::{generate_hifz_audio, GeneratedHifzAudio};
pub use install::install_local_segmentation_deps;
pub use local::{
    align_transcript_words_local_whisperx, segment_quran_audio_local,
    segment_quran_audio_local_muaalem, segment_quran_audio_local_multi,
    segment_quran_audio_local_surah_splitter, transcribe_audio_local_whisperx,
};
pub use status::{check_ai_transcription_ready, check_local_segmentation_ready};
