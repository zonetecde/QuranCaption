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
    estimate_duration, mfa_timestamps_direct, mfa_timestamps_session, segment_quran_audio,
};
pub use hifz::{generate_hifz_audio, GeneratedHifzAudio};
pub use install::install_local_segmentation_deps;
pub use local::{
    segment_quran_audio_local, segment_quran_audio_local_multi,
    segment_quran_audio_local_muaalem,
};
pub use status::check_local_segmentation_ready;
