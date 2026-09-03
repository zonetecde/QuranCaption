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
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (x, y) = window_center(pos.x, pos.y, size.width, size.height);

    capture_screen_at(x, y, image::ImageOutputFormat::Jpeg(92))
}

/// Capture le moniteur contenant Quran Caption en PNG pour préserver les couleurs exactes.
#[tauri::command]
pub async fn capture_screen_for_color_picker(app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let (x, y) = window_center(pos.x, pos.y, size.width, size.height);

    capture_screen_at(x, y, image::ImageOutputFormat::Png)
}

/// Calcule un point intérieur à la fenêtre pour identifier son moniteur.
fn window_center(x: i32, y: i32, width: u32, height: u32) -> (i32, i32) {
    (x + (width / 2) as i32, y + (height / 2) as i32)
}

/// Capture le moniteur situé aux coordonnées données dans le format demandé.
fn capture_screen_at(x: i32, y: i32, format: image::ImageOutputFormat) -> Result<Vec<u8>, String> {
    let screen = screen_for_point(x, y)?;

    let image = screen.capture().map_err(|e| e.to_string())?;

    let mut buffer: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);
    image
        .write_to(&mut cursor, format)
        .map_err(|e| e.to_string())?;

    Ok(buffer)
}

/// Sélectionne un moniteur énuméré sans dépendre de `MonitorFromPoint`.
fn screen_for_point(x: i32, y: i32) -> Result<screenshots::Screen, String> {
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    screens
        .iter()
        .find(|screen| {
            let info = screen.display_info;
            bounds_contain_point(info.x, info.y, info.width, info.height, x, y)
        })
        .or_else(|| screens.iter().find(|screen| screen.display_info.is_primary))
        .or_else(|| screens.first())
        .copied()
        .ok_or_else(|| "No monitor available".to_string())
}

/// Indique si un point appartient aux limites d'un moniteur.
fn bounds_contain_point(left: i32, top: i32, width: u32, height: u32, x: i32, y: i32) -> bool {
    x >= left && x < left + width as i32 && y >= top && y < top + height as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maximized_window_uses_a_point_inside_the_monitor() {
        assert_eq!(window_center(-8, -8, 1936, 1096), (960, 540));
    }

    #[test]
    fn point_is_found_on_a_monitor_with_negative_coordinates() {
        assert!(bounds_contain_point(-1920, 0, 1920, 1080, -960, 540));
    }
}
