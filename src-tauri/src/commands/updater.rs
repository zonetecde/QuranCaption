use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: u32,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// Vérifie une mise à jour depuis la release desktop correspondant exactement au tag `QC-*` fourni.
#[cfg(desktop)]
#[tauri::command]
pub async fn check_qc_update(
    webview: tauri::Webview<tauri::Wry>,
    tag: String,
) -> Result<Option<UpdateMetadata>, String> {
    use tauri::Manager;
    use tauri_plugin_updater::UpdaterExt;

    if !tag.strip_prefix("QC-").is_some_and(|version| {
        !version.is_empty()
            && version
                .chars()
                .all(|char| char.is_ascii_digit() || char == '.')
    }) {
        return Err("Invalid desktop release tag".into());
    }

    let endpoint =
        format!("https://github.com/zonetecde/QuranCaption/releases/download/{tag}/latest.json")
            .parse()
            .map_err(|error| format!("Invalid updater endpoint: {error}"))?;
    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };

    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|date| date.to_string()),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };

    Ok(Some(metadata))
}

/// Ignore la vérification des mises à jour desktop sur mobile.
#[cfg(mobile)]
#[tauri::command]
pub async fn check_qc_update(_tag: String) -> Result<Option<UpdateMetadata>, String> {
    Ok(None)
}
