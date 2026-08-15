//! Pont natif persistant entre Tauri et les services multimédias Android.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(not(target_os = "android"))]
mod desktop;
mod error;
#[cfg(target_os = "android")]
mod mobile;
mod models;

#[cfg(not(target_os = "android"))]
pub use desktop::AndroidMedia;
pub use error::{Error, Result};
#[cfg(target_os = "android")]
pub use mobile::AndroidMedia;
pub use models::FfmpegSessionSnapshot;

/// Ajoute l'accès aux services multimédias Android aux gestionnaires Tauri.
pub trait AndroidMediaExt<R: Runtime> {
    /// Retourne le pont Android natif enregistré dans l'application.
    fn android_media(&self) -> &AndroidMedia<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidMediaExt<R> for T {
    /// Retourne le pont Android natif enregistré dans l'application.
    fn android_media(&self) -> &AndroidMedia<R> {
        self.state::<AndroidMedia<R>>().inner()
    }
}

/// Initialise et enregistre le plugin Android Media.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-media")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let android_media = mobile::init(app, api)?;
            #[cfg(not(target_os = "android"))]
            let android_media = desktop::init(app, api)?;
            app.manage(android_media);
            Ok(())
        })
        .build()
}
