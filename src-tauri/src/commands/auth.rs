use tauri::AppHandle;

#[cfg(target_os = "android")]
use tauri_plugin_android_media::AndroidMediaExt;

const SESSION_KEY: &str = "quran_auth_session";
const PENDING_VERIFIER_KEY: &str = "quran_auth_pending_verifier";
const HF_CLOUD_TOKEN_KEY: &str = "hugging_face_cloud_token";

/// Refuse toute clé qui n'appartient pas au flux OAuth Quran.com.
fn normalize_key(key: &str) -> Result<String, String> {
    match key {
        SESSION_KEY | PENDING_VERIFIER_KEY | HF_CLOUD_TOKEN_KEY => Ok(key.to_string()),
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceAccountStatus {
    configured: bool,
    valid: bool,
    username: Option<String>,
}

/// Vérifie le token auprès de Hugging Face sans le persister.
async fn validate_hugging_face_token(token: &str) -> Result<HuggingFaceAccountStatus, String> {
    let response = reqwest::Client::new()
        .get("https://huggingface.co/api/whoami-v2")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("Unable to contact Hugging Face: {error}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(HuggingFaceAccountStatus {
            configured: true,
            valid: false,
            username: None,
        });
    }
    if !response.status().is_success() {
        return Err(format!(
            "Hugging Face token validation failed ({})",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid Hugging Face account response: {error}"))?;
    Ok(HuggingFaceAccountStatus {
        configured: true,
        valid: true,
        username: body
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    })
}

/// Valide et stocke le token Hugging Face dans le coffre-fort Android.
#[tauri::command]
pub async fn hugging_face_account_connect(
    app: AppHandle,
    token: String,
) -> Result<HuggingFaceAccountStatus, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Enter a Hugging Face token.".to_string());
    }
    let status = validate_hugging_face_token(token).await?;
    if !status.valid {
        return Err("This Hugging Face token is invalid or has been revoked.".to_string());
    }
    quran_auth_secure_set(app, HF_CLOUD_TOKEN_KEY.to_string(), token.to_string())?;
    Ok(status)
}

/// Renvoie l'état du compte Hugging Face configuré sur Android.
#[tauri::command]
pub async fn hugging_face_account_status(
    app: AppHandle,
) -> Result<HuggingFaceAccountStatus, String> {
    let Some(token) = hugging_face_cloud_token(&app)? else {
        return Ok(HuggingFaceAccountStatus {
            configured: false,
            valid: false,
            username: None,
        });
    };
    validate_hugging_face_token(&token).await
}

/// Supprime le token Hugging Face du coffre-fort Android.
#[tauri::command]
pub fn hugging_face_account_disconnect(app: AppHandle) -> Result<(), String> {
    quran_auth_secure_delete(app, HF_CLOUD_TOKEN_KEY.to_string())
}

/// Lit le token cloud pour authentifier les appels d'alignement.
pub(crate) fn hugging_face_cloud_token(app: &AppHandle) -> Result<Option<String>, String> {
    quran_auth_secure_get(app.clone(), HF_CLOUD_TOKEN_KEY.to_string())
}
