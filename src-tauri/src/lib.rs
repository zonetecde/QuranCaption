//! Entrypoint de la bibliothèque Tauri Minbar Caption.
//!
//! Cette unité reste volontairement mince: elle déclare les modules de domaine
//! puis délègue l'exécution à `app::run()`.

mod app;
mod binaries;
mod commands;
mod exporter;
mod path_utils;
mod utils;

/// Lance l'application Tauri.
pub fn run() {
    app::run();
}
