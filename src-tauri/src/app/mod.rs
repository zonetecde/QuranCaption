use std::sync::atomic::{AtomicU64, Ordering};

use tauri::Manager;

use crate::binaries;

mod invoke;

static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

/// Indique si le second lancement correspond à un deep link Quran Caption.
fn is_deep_link_launch(argv: &[String]) -> bool {
    argv.iter()
        .any(|arg| arg.to_ascii_lowercase().starts_with("qurancaption://"))
}

/// Ouvre une nouvelle fenêtre principale en réutilisant la configuration Tauri existante.
fn open_additional_window(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(base_config) = app.config().app.windows.first() else {
            return;
        };
        let mut config = base_config.clone();
        config.label = format!(
            "main{}",
            NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
        );

        if let Ok(builder) = tauri::WebviewWindowBuilder::from_config(&app, &config) {
            let _ = builder.build();
        }
    });
}

/// Construit et lance l'application Tauri avec plugins, setup et commandes IPC.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    let builder = if cfg!(debug_assertions) {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Le plugin deep-link traite déjà le callback avant cette closure.
            if !is_deep_link_launch(&argv) {
                open_additional_window(app);
            }
        }))
    };
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());
    let builder = invoke::register_invoke_handler(builder);

    builder
        .setup(|app| {
            // Initialisation de la résolution des binaires embarqués.
            if let Ok(resource_dir) = app.path().resource_dir() {
                binaries::init_resource_dir(resource_dir);
            }

            // Initialisation du plugin updater (desktop uniquement).
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

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
