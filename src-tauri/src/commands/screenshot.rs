use tauri::Manager;

/// Capture l'intégralité du contenu du moniteur contenant la fenêtre Quran Caption appelante.
///
/// La fenêtre est passée en plein écran au préalable côté frontend pour que la preview vidéo
/// occupe tout l'espace, puis le moniteur correspondant est capturé via l'API native du système.
#[tauri::command]
pub async fn capture_window_screenshot(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<Vec<u8>, String> {
    let window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("Window {window_label} not found"))?;

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