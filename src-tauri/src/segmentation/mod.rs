/// Types et constantes du domaine segmentation.
pub mod types;

mod audio_merge;
mod cloud;
mod install;
mod local;
mod python_env;
mod requirements;
mod status;

pub use cloud::segment_quran_audio;
pub use install::install_local_segmentation_deps;
pub use local::{segment_quran_audio_local, segment_quran_audio_local_multi};
pub use status::check_local_segmentation_ready;
