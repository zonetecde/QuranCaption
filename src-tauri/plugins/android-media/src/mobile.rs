use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{
    models::{
        CancelFfmpegResponse, ExecuteFfprobeRequest, ExecuteFfprobeResponse, FfmpegSessionRequest,
        FfmpegSessionSnapshot, ImportUriRequest, ImportUriResponse, KeepScreenOnRequest,
        KeepScreenOnResponse, OpenUriRequest, OpenUriResponse, PublishFileRequest,
        PublishFileResponse, StartFfmpegRequest, StartFfmpegResponse,
    },
    Result,
};

const PLUGIN_IDENTIFIER: &str = "com.qurancaption.androidmedia";

/// Enregistre l'implémentation Kotlin du plugin Android.
pub(crate) fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<AndroidMedia<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidMediaPlugin")?;
    Ok(AndroidMedia(handle))
}

/// Donne accès à FFmpegKit et aux URI de documents Android.
pub struct AndroidMedia<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> AndroidMedia<R> {
    /// Démarre une session FFmpegKit sans bloquer le thread appelant.
    pub fn start_ffmpeg(&self, arguments: Vec<String>) -> Result<i64> {
        self.0
            .run_mobile_plugin::<StartFfmpegResponse>(
                "startFfmpeg",
                StartFfmpegRequest { arguments },
            )
            .map(|response| response.session_id)
            .map_err(Into::into)
    }

    /// Lit l'état courant, la progression et le résultat d'une session FFmpegKit.
    pub fn poll_ffmpeg(&self, session_id: i64) -> Result<FfmpegSessionSnapshot> {
        self.0
            .run_mobile_plugin("pollFfmpeg", FfmpegSessionRequest { session_id })
            .map_err(Into::into)
    }

    /// Demande l'annulation d'une session FFmpegKit.
    pub fn cancel_ffmpeg(&self, session_id: i64) -> Result<bool> {
        self.0
            .run_mobile_plugin::<CancelFfmpegResponse>(
                "cancelFfmpeg",
                FfmpegSessionRequest { session_id },
            )
            .map(|response| response.cancelled)
            .map_err(Into::into)
    }

    /// Exécute une sonde FFprobeKit et retourne sa sortie texte.
    pub fn execute_ffprobe(&self, arguments: Vec<String>) -> Result<(bool, String)> {
        self.0
            .run_mobile_plugin::<ExecuteFfprobeResponse>(
                "executeFfprobe",
                ExecuteFfprobeRequest { arguments },
            )
            .map(|response| (response.success, response.output))
            .map_err(Into::into)
    }

    /// Copie un fichier local vers une URI Android ou un chemin de destination.
    pub fn publish_file(&self, source_path: String, destination_uri: String) -> Result<String> {
        self.0
            .run_mobile_plugin::<PublishFileResponse>(
                "publishFile",
                PublishFileRequest {
                    source_path,
                    destination_uri,
                },
            )
            .map(|response| response.uri)
            .map_err(Into::into)
    }

    /// Ouvre une URI Android dans l'application capable de lire son type MIME.
    pub fn open_uri(&self, uri: String, mime_type: String) -> Result<bool> {
        self.0
            .run_mobile_plugin::<OpenUriResponse>("openUri", OpenUriRequest { uri, mime_type })
            .map(|response| response.opened)
            .map_err(Into::into)
    }

    /// Importe le contenu d'une URI Android dans un dossier local.
    pub fn import_uri(&self, uri: String, destination_dir: String) -> Result<String> {
        self.0
            .run_mobile_plugin::<ImportUriResponse>(
                "importUri",
                ImportUriRequest {
                    uri,
                    destination_dir,
                },
            )
            .map(|response| response.path)
            .map_err(Into::into)
    }

    /// Active ou désactive le maintien de l'écran pendant un export.
    pub fn set_keep_screen_on(&self, enabled: bool) -> Result<bool> {
        self.0
            .run_mobile_plugin::<KeepScreenOnResponse>(
                "setKeepScreenOn",
                KeepScreenOnRequest { enabled },
            )
            .map(|response| response.enabled)
            .map_err(Into::into)
    }
}
