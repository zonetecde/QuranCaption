/// Indique que le stockage sécurisé Quran.com n'est pas disponible sur mobile.
#[tauri::command]
pub fn quran_auth_secure_set(_key: String, _value: String) -> Result<(), String> {
    Err("Secure storage is not available on Android yet.".to_string())
}

/// Retourne une session absente tant que le stockage sécurisé mobile est désactivé.
#[tauri::command]
pub fn quran_auth_secure_get(_key: String) -> Result<Option<String>, String> {
    Ok(None)
}

/// Ignore la suppression tant que le stockage sécurisé mobile est désactivé.
#[tauri::command]
pub fn quran_auth_secure_delete(_key: String) -> Result<(), String> {
    Ok(())
}
