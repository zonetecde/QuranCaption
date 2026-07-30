use tauri::Manager;

#[cfg(target_os = "android")]
use tauri_plugin_android_media::AndroidMediaExt;

/// Publie un rendu privé vers la destination choisie par le sélecteur Android.
///
/// @param app_handle Handle de l'application.
/// @param source_path Chemin réel du rendu FFmpeg.
/// @param destination_uri URI SAF ou chemin final.
/// @returns URI ou chemin effectivement publié.
#[tauri::command]
pub async fn publish_android_export(
    app_handle: tauri::AppHandle,
    source_path: String,
    destination_uri: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        return tokio::task::spawn_blocking(move || {
            app_handle
                .android_media()
                .publish_file(source_path, destination_uri)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| format!("Android publication task failed: {}", error))?;
    }

    #[cfg(not(target_os = "android"))]
    {
        let destination_path = destination_uri
            .strip_prefix("file://")
            .unwrap_or(&destination_uri);
        std::fs::copy(&source_path, destination_path)
            .map_err(|error| format!("Unable to publish export: {}", error))?;
        Ok(destination_path.to_string())
    }
}

/// Ouvre une URI de média publiée avec une application Android compatible.
///
/// @param app_handle Handle de l'application.
/// @param uri URI du média.
/// @param mime_type Type MIME transmis à ACTION_VIEW.
/// @returns `true` lorsqu'une application a été ouverte.
#[tauri::command]
pub async fn open_android_export(
    app_handle: tauri::AppHandle,
    uri: String,
    mime_type: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .open_uri(uri, mime_type)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app_handle, uri, mime_type);
        Ok(false)
    }
}

/// Copie un média SAF vers un chemin privé persistant utilisable par FFmpeg.
///
/// @param app_handle Handle de l'application.
/// @param uri URI renvoyée par le fournisseur de documents Android.
/// @param project_id Identifiant du projet propriétaire.
/// @returns Chemin absolu du fichier importé.
#[tauri::command]
pub async fn import_android_media(
    app_handle: tauri::AppHandle,
    uri: String,
    project_id: i64,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let destination_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("media")
            .join(project_id.to_string())
            .to_string_lossy()
            .to_string();
        return tokio::task::spawn_blocking(move || {
            app_handle
                .android_media()
                .import_uri(uri, destination_dir)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| format!("Android import task failed: {}", error))?;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app_handle, project_id);
        Ok(uri)
    }
}

/// Maintient l'écran Android allumé pendant le rendu visible.
///
/// @param app_handle Handle de l'application.
/// @param enabled État souhaité du drapeau Android.
/// @returns État effectivement appliqué.
#[tauri::command]
pub async fn set_android_export_keep_screen_on(
    app_handle: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .set_keep_screen_on(enabled)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app_handle;
        Ok(enabled)
    }
}
