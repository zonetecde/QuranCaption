use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use keyring::{Entry, Error as KeyringError};
use serde_json::Value;

const SERVICE_NAME: &str = "QuranCaption";
const SESSION_KEY: &str = "quran_auth_session";
const LEGACY_PENDING_VERIFIER_KEY: &str = "quran_auth_pending_verifier";
const PENDING_VERIFIER_KEY_PREFIX: &str = "quran_auth_pending_verifier__";
const PENDING_FLOW_KEY: &str = "quran_auth_pending_flow";
const SESSION_CHUNK_KEY_PREFIX: &str = "quran_auth_session__chunk_";
const CHUNKED_SENTINEL_PREFIX: &str = "__chunked__:";
const MAX_SECURE_VALUE_UTF16_LEN: usize = 2_000;
const PENDING_FLOW_MAX_AGE_MS: u64 = 10 * 60 * 1_000;

static PENDING_FLOW_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn normalize_key(key: &str) -> Result<String, String> {
    match key {
        SESSION_KEY | LEGACY_PENDING_VERIFIER_KEY | PENDING_FLOW_KEY => Ok(key.to_string()),
        _ if key.starts_with(PENDING_VERIFIER_KEY_PREFIX) => Ok(key.to_string()),
        _ if key.starts_with(SESSION_CHUNK_KEY_PREFIX) => Ok(key.to_string()),
        _ => Err("Unsupported secure storage key".to_string()),
    }
}

fn secure_entry(key: &str) -> Result<Entry, String> {
    let normalized = normalize_key(key)?;
    Entry::new(SERVICE_NAME, &normalized)
        .map_err(|error| format!("Failed to access the OS secure store: {error}"))
}

fn chunk_key(index: usize) -> String {
    format!("{SESSION_CHUNK_KEY_PREFIX}{index}")
}

fn pending_verifier_key(window_label: &str) -> String {
    format!("{PENDING_VERIFIER_KEY_PREFIX}{window_label}")
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("System clock error: {error}"))
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

fn read_pending_flow() -> Result<Option<(String, u64)>, String> {
    let Some(raw) = get_single_secure_value(PENDING_FLOW_KEY)? else {
        return Ok(None);
    };
    let parsed = match serde_json::from_str::<Value>(&raw) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(None),
    };
    let Some(window_label) = parsed.get("windowLabel").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(started_at) = parsed.get("startedAt").and_then(Value::as_u64) else {
        return Ok(None);
    };
    Ok(Some((window_label.to_string(), started_at)))
}

/// Réserve atomiquement l'unique flow OAuth Quran.com du processus.
/// Retourne `Some(window_label)` si un autre flow non expiré existe déjà.
#[tauri::command]
pub fn quran_auth_claim_pending_flow(
    window_label: String,
    verifier: String,
) -> Result<Option<String>, String> {
    let lock = PENDING_FLOW_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Failed to lock Quran auth pending flow".to_string())?;

    let current_time = now_ms()?;
    if let Some((owner, started_at)) = read_pending_flow()? {
        if current_time.saturating_sub(started_at) <= PENDING_FLOW_MAX_AGE_MS {
            return Ok(Some(owner));
        }
        delete_single_secure_value(&pending_verifier_key(&owner))?;
        delete_single_secure_value(PENDING_FLOW_KEY)?;
    } else {
        // Nettoie aussi une valeur mal formée qui ne peut plus être utilisée.
        delete_single_secure_value(PENDING_FLOW_KEY)?;
    }

    delete_single_secure_value(LEGACY_PENDING_VERIFIER_KEY)?;
    set_single_secure_value(&pending_verifier_key(&window_label), &verifier)?;
    set_single_secure_value(
        PENDING_FLOW_KEY,
        &serde_json::json!({
            "windowLabel": window_label,
            "startedAt": current_time,
        })
        .to_string(),
    )?;
    Ok(None)
}

/// Libère le flow OAuth seulement si la fenêtre appelante en est propriétaire.
#[tauri::command]
pub fn quran_auth_clear_pending_flow(window_label: String) -> Result<(), String> {
    let lock = PENDING_FLOW_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Failed to lock Quran auth pending flow".to_string())?;

    delete_single_secure_value(&pending_verifier_key(&window_label))?;
    delete_single_secure_value(LEGACY_PENDING_VERIFIER_KEY)?;
    if read_pending_flow()?
        .map(|(owner, _)| owner == window_label)
        .unwrap_or(false)
    {
        delete_single_secure_value(PENDING_FLOW_KEY)?;
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
