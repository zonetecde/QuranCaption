use tauri::Manager;

/// Capture l'intégralité du contenu de la fenêtre principale via l'API native du système.
///
/// Passe la fenêtre en plein écran au préalable pour que la preview vidéo occupe
/// tout l'espace, puis capture l'intégralité du moniteur avec DXGI (Windows) / CGDisplay (macOS).
#[tauri::command]
pub async fn capture_window_screenshot(app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let pos = window.outer_position().map_err(|e| e.to_string())?;

    let screen = screenshots::Screen::from_point(pos.x, pos.y).map_err(|e| e.to_string())?;

    let image = screen.capture().map_err(|e| e.to_string())?;

    let mut buffer: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);
    image
        .write_to(&mut cursor, image::ImageOutputFormat::Jpeg(92))
        .map_err(|e| e.to_string())?;

    Ok(buffer)
}
