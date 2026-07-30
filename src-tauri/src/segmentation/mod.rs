/// Types et constantes du domaine segmentation.
pub mod types;

mod audio_merge;
mod cloud;
mod hifz;

pub use cloud::{
    estimate_duration, mfa_timestamps_direct, mfa_timestamps_session, preload_audio,
    preload_audio_recitations, preload_recitations, preload_segments, segment_quran_audio,
};
pub use hifz::{generate_hifz_audio, GeneratedHifzAudio};
