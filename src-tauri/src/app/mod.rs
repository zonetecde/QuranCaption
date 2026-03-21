use tauri::Manager;

use crate::binaries;

mod invoke;

/// Construit et lance l'application Tauri avec plugins, setup et commandes IPC.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());
    let builder = invoke::register_invoke_handler(builder);

    builder
        .setup(|app| {
            // Initialisation de la résolution des binaires embarqués.
            if let Ok(resource_dir) = app.path().resource_dir() {
                binaries::init_resource_dir(resource_dir);
            }

            // Activation du logging Tauri en debug pour faciliter le diagnostic local.
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
