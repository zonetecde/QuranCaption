use tauri::Emitter;
use tauri_plugin_android_media::AndroidMediaExt;

/// Émet la progression du téléchargement YouTube vers le frontend.
fn emit_youtube_download_progress(
    app_handle: &tauri::AppHandle,
    download_request_id: &str,
    progress: f64,
    status: &str,
) {
    let _ = app_handle.emit(
        "youtube-download-progress",
        serde_json::json!({
            "downloadRequestId": download_request_id,
            "progress": progress,
            "status": status
        }),
    );
}

/// Émet une erreur de téléchargement YouTube vers le frontend.
fn emit_youtube_download_error(
    app_handle: &tauri::AppHandle,
    download_request_id: &str,
    error: &str,
) {
    let _ = app_handle.emit(
        "youtube-download-error",
        serde_json::json!({
            "downloadRequestId": download_request_id,
            "error": error
        }),
    );
}

/// Télécharge un média YouTube avec le moteur yt-dlp natif Android.
#[tauri::command]
pub async fn download_from_youtube(
    url: String,
    download_type: String,
    download_path: String,
    download_request_id: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let download_request_id = download_request_id.unwrap_or_else(|| {
        format!(
            "req-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or(0)
        )
    });
    let started = app_handle
        .android_media()
        .start_youtube_download(
            url,
            download_type,
            download_path,
            download_request_id.clone(),
        )
        .map_err(|error| error.to_string())?;
    if !started {
        return Err("Unable to start yt-dlp".to_string());
    }

    loop {
        let snapshot = app_handle
            .android_media()
            .poll_youtube_download(download_request_id.clone())
            .map_err(|error| error.to_string())?;
        emit_youtube_download_progress(
            &app_handle,
            &download_request_id,
            snapshot.progress.clamp(0.0, 100.0),
            "downloading",
        );

        match snapshot.state.as_str() {
            "COMPLETED" => return Ok(snapshot.path),
            "FAILED" => {
                emit_youtube_download_error(&app_handle, &download_request_id, &snapshot.error);
                return Err(snapshot.error);
            }
            _ => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
        }
    }
}
