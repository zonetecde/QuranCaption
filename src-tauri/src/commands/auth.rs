use keyring::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "QuranCaption";
const SESSION_KEY: &str = "quran_auth_session";
const PENDING_VERIFIER_KEY: &str = "quran_auth_pending_verifier";
const PENDING_WINDOW_KEY: &str = "quran_auth_pending_window";
const HF_CLOUD_TOKEN_KEY: &str = "hugging_face_cloud_token";
const SESSION_CHUNK_KEY_PREFIX: &str = "quran_auth_session__chunk_";
const CHUNKED_SENTINEL_PREFIX: &str = "__chunked__:";
const MAX_SECURE_VALUE_UTF16_LEN: usize = 2_000;

fn normalize_key(key: &str) -> Result<String, String> {
    match key {
        SESSION_KEY | PENDING_VERIFIER_KEY | PENDING_WINDOW_KEY => Ok(key.to_string()),
        _ if key.starts_with(SESSION_CHUNK_KEY_PREFIX) => Ok(key.to_string()),
        _ => Err("Unsupported secure storage key".to_string()),
    }
}

fn secure_entry(key: &str) -> Result<Entry, String> {
    let normalized = normalize_key(key)?;
    Entry::new(SERVICE_NAME, &normalized)
        .map_err(|error| format!("Failed to access the OS secure store: {error}"))
}

/// Ouvre l'entrée dédiée au token cloud Hugging Face.
fn hugging_face_token_entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, HF_CLOUD_TOKEN_KEY)
        .map_err(|error| format!("Failed to access the OS secure store: {error}"))
}

/// Lit le token cloud Hugging Face depuis le coffre-fort du système.
fn get_hugging_face_token() -> Result<Option<String>, String> {
    match hugging_face_token_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read from the OS secure store: {error}")),
    }
}

fn chunk_key(index: usize) -> String {
    format!("{SESSION_CHUNK_KEY_PREFIX}{index}")
}

fn parse_chunk_count(value: &str) -> Option<usize> {
    value.strip_prefix(CHUNKED_SENTINEL_PREFIX)?.parse().ok()
}

fn split_into_utf16_chunks(value: &str, max_utf16_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for ch in value.chars() {
        let ch_len = ch.len_utf16();
        if !current.is_empty() && current_len + ch_len > max_utf16_len {
            chunks.push(current);
            current = String::new();
            current_len = 0;
        }

        current.push(ch);
        current_len += ch_len;
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

fn set_single_secure_value(key: &str, value: &str) -> Result<(), String> {
    secure_entry(key)?
        .set_password(value)
        .map_err(|error| format!("Failed to write to the OS secure store: {error}"))
}

fn get_single_secure_value(key: &str) -> Result<Option<String>, String> {
    match secure_entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read from the OS secure store: {error}")),
    }
}

fn delete_single_secure_value(key: &str) -> Result<(), String> {
    match secure_entry(key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete from the OS secure store: {error}"
        )),
    }
}

fn clear_chunked_session_parts_if_needed(existing_base_value: Option<&str>) -> Result<(), String> {
    let Some(chunk_count) = existing_base_value.and_then(parse_chunk_count) else {
        return Ok(());
    };

    for index in 0..chunk_count {
        delete_single_secure_value(&chunk_key(index))?;
    }

    Ok(())
}

/// Stocke une valeur sensible dans le coffre-fort du système.
#[tauri::command]
pub fn quran_auth_secure_set(key: String, value: String) -> Result<(), String> {
    let existing_base_value = get_single_secure_value(&key)?;
    clear_chunked_session_parts_if_needed(existing_base_value.as_deref())?;

    if key == SESSION_KEY && value.encode_utf16().count() > MAX_SECURE_VALUE_UTF16_LEN {
        let chunks = split_into_utf16_chunks(&value, MAX_SECURE_VALUE_UTF16_LEN);

        for (index, chunk) in chunks.iter().enumerate() {
            set_single_secure_value(&chunk_key(index), chunk)?;
        }

        set_single_secure_value(&key, &format!("{CHUNKED_SENTINEL_PREFIX}{}", chunks.len()))?;
        return Ok(());
    }

    set_single_secure_value(&key, &value)
}

/// Lit une valeur sensible depuis le coffre-fort du système.
#[tauri::command]
pub fn quran_auth_secure_get(key: String) -> Result<Option<String>, String> {
    let Some(value) = get_single_secure_value(&key)? else {
        return Ok(None);
    };

    if key == SESSION_KEY {
        if let Some(chunk_count) = parse_chunk_count(&value) {
            let mut restored = String::new();
            for index in 0..chunk_count {
                let Some(chunk) = get_single_secure_value(&chunk_key(index))? else {
                    return Err(format!(
                        "Failed to read from the OS secure store: missing session chunk {index}"
                    ));
                };
                restored.push_str(&chunk);
            }

            return Ok(Some(restored));
        }
    }

    Ok(Some(value))
}

/// Supprime une valeur sensible depuis le coffre-fort du système.
#[tauri::command]
pub fn quran_auth_secure_delete(key: String) -> Result<(), String> {
    let existing_base_value = get_single_secure_value(&key)?;
    clear_chunked_session_parts_if_needed(existing_base_value.as_deref())?;
    delete_single_secure_value(&key)
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

/// Valide et stocke le token Hugging Face cloud dans le coffre-fort du système.
#[tauri::command]
pub async fn hugging_face_account_connect(
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
    hugging_face_token_entry()?
        .set_password(token)
        .map_err(|error| format!("Failed to write to the OS secure store: {error}"))?;
    Ok(status)
}

/// Renvoie l'état du compte Hugging Face cloud configuré.
#[tauri::command]
pub async fn hugging_face_account_status() -> Result<HuggingFaceAccountStatus, String> {
    let Some(token) = get_hugging_face_token()? else {
        return Ok(HuggingFaceAccountStatus {
            configured: false,
            valid: false,
            username: None,
        });
    };
    validate_hugging_face_token(&token).await
}

/// Supprime le token Hugging Face cloud du coffre-fort du système.
#[tauri::command]
pub fn hugging_face_account_disconnect() -> Result<(), String> {
    match hugging_face_token_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete from the OS secure store: {error}"
        )),
    }
}

/// Lit le token cloud pour authentifier les appels directs au Space.
pub(crate) fn hugging_face_cloud_token() -> Result<Option<String>, String> {
    get_hugging_face_token()
}
