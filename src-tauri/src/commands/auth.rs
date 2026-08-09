use tauri::AppHandle;

#[cfg(target_os = "android")]
use tauri_plugin_android_media::AndroidMediaExt;

const SESSION_KEY: &str = "quran_auth_session";
const PENDING_VERIFIER_KEY: &str = "quran_auth_pending_verifier";

/// Refuse toute clé qui n'appartient pas au flux OAuth Quran.com.
fn normalize_key(key: &str) -> Result<String, String> {
    match key {
        SESSION_KEY | PENDING_VERIFIER_KEY => Ok(key.to_string()),
        _ => Err("Unsupported secure storage key".to_string()),
    }
}

/// Stocke une valeur OAuth dans le coffre-fort Android natif.
#[tauri::command]
pub fn quran_auth_secure_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let key = normalize_key(&key)?;

    #[cfg(target_os = "android")]
    return app
        .android_media()
        .secure_set(key, value)
        .map_err(|error| error.to_string());

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, key, value);
        Err("Secure storage is only available on Android.".to_string())
    }
}

/// Lit une valeur OAuth depuis le coffre-fort Android natif.
#[tauri::command]
pub fn quran_auth_secure_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let key = normalize_key(&key)?;

    #[cfg(target_os = "android")]
    return app
        .android_media()
        .secure_get(key)
        .map_err(|error| error.to_string());

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, key);
        Err("Secure storage is only available on Android.".to_string())
    }
}

/// Supprime une valeur OAuth du coffre-fort Android natif.
#[tauri::command]
pub fn quran_auth_secure_delete(app: AppHandle, key: String) -> Result<(), String> {
    let key = normalize_key(&key)?;

    #[cfg(target_os = "android")]
    return app
        .android_media()
        .secure_delete(key)
        .map_err(|error| error.to_string());

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, key);
        Err("Secure storage is only available on Android.".to_string())
    }
}
