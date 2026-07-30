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

/// Démarre le service Android au premier plan et sa notification de progression.
///
/// @param app_handle Handle de l'application.
/// @param export_id Identifiant de l'export actif.
/// @param file_name Nom affiché dans la notification.
/// @param state État initial brut.
/// @param state_labels Table JSON des états localisés.
/// @param capturing_hint Consigne affichée pendant les captures WebView.
/// @param background_hint Consigne affichée pendant le rendu natif.
/// @param completion_hint Message affiché après publication.
/// @param cancel_label Libellé de l'action d'annulation.
/// @param cancelling_label Libellé affiché après annulation.
/// @param channel_name Nom localisé du canal Android.
/// @returns `true` lorsque le service a été demandé.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_android_export_foreground_service(
    app_handle: tauri::AppHandle,
    export_id: String,
    file_name: String,
    state: String,
    state_labels: String,
    capturing_hint: String,
    background_hint: String,
    completion_hint: String,
    cancel_label: String,
    cancelling_label: String,
    channel_name: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .start_export_service(
                export_id,
                file_name,
                state,
                state_labels,
                capturing_hint,
                background_hint,
                completion_hint,
                cancel_label,
                cancelling_label,
                channel_name,
            )
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (
            app_handle,
            export_id,
            file_name,
            state,
            state_labels,
            capturing_hint,
            background_hint,
            completion_hint,
            cancel_label,
            cancelling_label,
            channel_name,
        );
        Ok(true)
    }
}

/// Met à jour la notification et renvoie une éventuelle annulation Android.
///
/// @param app_handle Handle de l'application.
/// @param export_id Identifiant de l'export actif.
/// @param progress Pourcentage de la phase courante.
/// @param state État brut utilisé pour la traduction native.
/// @returns `true` lorsqu'une annulation a été demandée depuis la notification.
#[tauri::command]
pub async fn update_android_export_foreground_service(
    app_handle: tauri::AppHandle,
    export_id: String,
    progress: i32,
    state: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .update_export_service(export_id, progress.clamp(0, 100), state)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app_handle, export_id, progress, state);
        Ok(false)
    }
}

/// Autorise la mise en arrière-plan après la dernière capture WebView.
///
/// @param app_handle Handle de l'application.
/// @param export_id Identifiant de l'export actif.
/// @returns `true` lorsque le service a reçu la bascule.
#[tauri::command]
pub async fn mark_android_export_background_ready(
    app_handle: tauri::AppHandle,
    export_id: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .mark_export_background_ready(export_id)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app_handle, export_id);
        Ok(true)
    }
}

/// Arrête le service Android lorsque l'export a terminé son nettoyage.
///
/// @param app_handle Handle de l'application.
/// @param export_id Identifiant de l'export terminé.
/// @returns `true` lorsque l'arrêt a été demandé.
#[tauri::command]
pub async fn stop_android_export_foreground_service(
    app_handle: tauri::AppHandle,
    export_id: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .stop_export_service(export_id)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app_handle, export_id);
        Ok(true)
    }
}

/// Lit le marqueur d'annulation posé depuis la notification.
///
/// @param app_handle Handle de l'application.
/// @param export_id Identifiant de l'export actif.
/// @returns `true` si l'utilisateur a utilisé l'action Android.
#[tauri::command]
pub async fn is_android_export_notification_cancelled(
    app_handle: tauri::AppHandle,
    export_id: String,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        return app_handle
            .android_media()
            .is_export_cancellation_requested(export_id)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app_handle, export_id);
        Ok(false)
    }
}
