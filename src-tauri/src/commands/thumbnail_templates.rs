use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CACHE_TTL_SECONDS: u64 = 24 * 60 * 60;

#[derive(Clone, Deserialize, Serialize)]
pub struct ThumbnailTemplate {
    hash: String,
    name: String,
    preview: String,
}

#[derive(Deserialize, Serialize)]
struct TemplateCache {
    fetched_at: u64,
    templates: Vec<ThumbnailTemplate>,
}

impl TemplateCache {
    /// Vérifie que le cache contient des modèles et date de moins de 24 heures.
    fn is_fresh(&self, now: u64) -> bool {
        !self.templates.is_empty()
            && now >= self.fetched_at
            && now - self.fetched_at < CACHE_TTL_SECONDS
    }
}

/// Charge les modèles et leurs aperçus rendus depuis le site, avec un cache disque de 24 heures.
#[tauri::command]
pub async fn get_thumbnail_templates(
    app: tauri::AppHandle,
) -> Result<Vec<ThumbnailTemplate>, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    // Renouvelle les aperçus capturés avant l'activation du stockage DOM de la galerie.
    let cache_path = cache_dir.join("thumbnail-templates-v2.json");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    if let Ok(contents) = tokio::fs::read(&cache_path).await {
        if let Ok(cache) = serde_json::from_slice::<TemplateCache>(&contents) {
            if cache.is_fresh(now) {
                return Ok(cache.templates);
            }
        }
    }

    let data = tauri::async_runtime::spawn_blocking(|| {
        crate::commands::android_media::load_thumbnail_templates(include_str!(
            "thumbnail_templates.js"
        ))
    })
    .await
    .map_err(|error| error.to_string())??;
    let templates: Vec<ThumbnailTemplate> =
        serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if templates.is_empty() {
        return Err("No thumbnail templates found".to_string());
    }
    let cache = TemplateCache {
        fetched_at: now,
        templates: templates.clone(),
    };
    let contents = serde_json::to_vec(&cache).map_err(|e| e.to_string())?;
    if let Err(error) = async {
        tokio::fs::create_dir_all(&cache_dir).await?;
        tokio::fs::write(&cache_path, contents).await
    }
    .await
    {
        log::warn!("Failed to cache thumbnail templates: {error}");
    }
    Ok(templates)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vérifie l'expiration à 24 heures et rejette les dates futures.
    #[test]
    fn cache_expires_after_24_hours() {
        let cache = TemplateCache {
            fetched_at: 100,
            templates: vec![ThumbnailTemplate {
                hash: "#new".into(),
                name: "New".into(),
                preview: "data:image/png;base64,example".into(),
            }],
        };
        assert!(cache.is_fresh(100 + CACHE_TTL_SECONDS - 1));
        assert!(!cache.is_fresh(100 + CACHE_TTL_SECONDS));
        assert!(!cache.is_fresh(99));
    }

    /// Vérifie qu'un cache vide déclenche une nouvelle récupération.
    #[test]
    fn empty_cache_is_not_reused() {
        assert!(!TemplateCache {
            fetched_at: 100,
            templates: vec![]
        }
        .is_fresh(100));
    }
}
