use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, FfmpegSessionSnapshot, Result};

/// Initialise un substitut explicite sur les plateformes non Android.
pub(crate) fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<AndroidMedia<R>> {
    Ok(AndroidMedia(PhantomData))
}

/// Représente l'API indisponible hors Android.
pub struct AndroidMedia<R: Runtime>(PhantomData<R>);

impl<R: Runtime> AndroidMedia<R> {
    /// Refuse le démarrage de FFmpegKit hors Android.
    pub fn start_ffmpeg(&self, _arguments: Vec<String>) -> Result<i64> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse la lecture d'une session FFmpegKit hors Android.
    pub fn poll_ffmpeg(&self, _session_id: i64) -> Result<FfmpegSessionSnapshot> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse l'annulation d'une session FFmpegKit hors Android.
    pub fn cancel_ffmpeg(&self, _session_id: i64) -> Result<bool> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse l'exécution de FFprobeKit hors Android.
    pub fn execute_ffprobe(&self, _arguments: Vec<String>) -> Result<(bool, String)> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse la publication d'un fichier hors Android.
    pub fn publish_file(&self, _source_path: String, _destination_uri: String) -> Result<String> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse l'ouverture d'une URI Android hors Android.
    pub fn open_uri(&self, _uri: String, _mime_type: String) -> Result<bool> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse le partage d'une URI Android hors Android.
    pub fn share_uri(&self, _uri: String, _mime_type: String) -> Result<bool> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse l'import d'une URI Android hors Android.
    pub fn import_uri(&self, _uri: String, _destination_dir: String) -> Result<String> {
        Err(Error::UnsupportedPlatform)
    }

    /// Refuse la gestion de l'écran Android hors Android.
    pub fn set_keep_screen_on(&self, _enabled: bool) -> Result<bool> {
        Err(Error::UnsupportedPlatform)
    }
}
