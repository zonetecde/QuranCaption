use std::sync::{Arc, Mutex};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

lazy_static::lazy_static! {
    /// Instance globale du client Discord RPC pour les commandes IPC.
    static ref DISCORD_CLIENT: Arc<Mutex<Option<DiscordIpcClient>>> = Arc::new(Mutex::new(None));
}

/// Paramètres de présence Discord reçus depuis le frontend.
#[derive(serde::Deserialize)]
pub struct DiscordActivity {
    /// Ligne de détails principale.
    details: Option<String>,
    /// État secondaire.
    state: Option<String>,
    /// Clé d'image large.
    large_image_key: Option<String>,
    /// Texte image large.
    large_image_text: Option<String>,
    /// Clé d'image petite.
    small_image_key: Option<String>,
    /// Texte image petite.
    small_image_text: Option<String>,
    /// Taille de party courante.
    party_size: Option<u32>,
    /// Taille maximale de party.
    party_max: Option<u32>,
    /// Timestamp Unix de début.
    start_timestamp: Option<i64>,
}

/// Initialise la connexion Discord Rich Presence.
#[tauri::command]
pub async fn init_discord_rpc(app_id: String) -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *client_guard {
        let _ = client.close();
    }

    let mut client = DiscordIpcClient::new(&app_id).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    *client_guard = Some(client);
    Ok(())
}

/// Met à jour la présence Discord active.
#[tauri::command]
pub async fn update_discord_activity(activity_data: DiscordActivity) -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *client_guard {
        let mut activity_builder = activity::Activity::new();

        // Construction progressive des champs selon les données disponibles.
        if let Some(ref details) = activity_data.details {
            activity_builder = activity_builder.details(details);
        }
        if let Some(ref state) = activity_data.state {
            activity_builder = activity_builder.state(state);
        }
        let start_time = activity_data.start_timestamp.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
        });
        activity_builder =
            activity_builder.timestamps(activity::Timestamps::new().start(start_time));

        let has_large_image = activity_data.large_image_key.is_some();
        let has_small_image = activity_data.small_image_key.is_some();
        if has_large_image || has_small_image {
            let mut assets_builder = activity::Assets::new();
            if let Some(ref key) = activity_data.large_image_key {
                assets_builder = assets_builder.large_image(key);
                if let Some(ref text) = activity_data.large_image_text {
                    assets_builder = assets_builder.large_text(text);
                }
            }
            if let Some(ref key) = activity_data.small_image_key {
                assets_builder = assets_builder.small_image(key);
                if let Some(ref text) = activity_data.small_image_text {
                    assets_builder = assets_builder.small_text(text);
                }
            }
            activity_builder = activity_builder.assets(assets_builder);
        }

        if let (Some(party_size), Some(party_max)) =
            (activity_data.party_size, activity_data.party_max)
        {
            let party = activity::Party::new().size([party_size as i32, party_max as i32]);
            activity_builder = activity_builder.party(party);
        }

        client
            .set_activity(activity_builder)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Discord client not initialized. Call init_discord_rpc first.".to_string())
    }
}

/// Efface la présence Discord en cours.
#[tauri::command]
pub async fn clear_discord_activity() -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *client_guard {
        client.clear_activity().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Discord client not initialized.".to_string())
    }
}

/// Ferme la connexion Discord RPC.
#[tauri::command]
pub async fn close_discord_rpc() -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *client_guard {
        client.close().map_err(|e| e.to_string())?;
        *client_guard = None;
    }
    Ok(())
}
