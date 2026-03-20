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
            // Prepare local media tools directory and ensure it is available in process PATH.
            if let Err(error) = binaries::prepare_media_tools_path(&app.handle().clone()) {
                eprintln!("[media-deps] unable to prepare tools path: {}", error);
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
