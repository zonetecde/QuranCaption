use std::path::Path;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::{Entry, Error as KeyringError};
use rand::RngCore;
use reqwest::{header, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const SERVICE_NAME: &str = "QuranCaption";
const REFRESH_TOKEN_KEY: &str = "youtube_refresh_token";
const ACCOUNT_EMAIL_KEY: &str = "youtube_account_email";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(180);
const UPLOAD_CHUNK_SIZE: usize = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeAuthStatus {
    configured: bool,
    connected: bool,
    account_email: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeUploadRequest {
    export_id: u64,
    file_path: String,
    title: String,
    description: String,
    privacy_status: String,
    publish_at: Option<String>,
    thumbnail_path: Option<String>,
    made_for_kids: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeUploadResult {
    video_id: String,
    url: String,
    warning: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct YouTubeUploadProgress {
    export_id: u64,
    progress: u8,
    stage: &'static str,
}

/// Retourne les identifiants OAuth intégrés à la compilation.
fn credentials() -> Result<(&'static str, &'static str), String> {
    let client_id = option_env!("YOUTUBE_CLIENT_ID").unwrap_or("");
    let client_secret = option_env!("YOUTUBE_CLIENT_SECRET").unwrap_or("");
    if client_id.is_empty() || client_secret.is_empty() {
        return Err("YOUTUBE_OAUTH_NOT_CONFIGURED".to_string());
    }
    Ok((client_id, client_secret))
}

/// Ouvre une entrée du coffre-fort du système.
fn secure_entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, key)
        .map_err(|error| format!("Failed to access the OS secure store: {error}"))
}

/// Lit une valeur facultative dans le coffre-fort du système.
fn read_secure_value(key: &str) -> Result<Option<String>, String> {
    match secure_entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read from the OS secure store: {error}")),
    }
}

/// Écrit une valeur dans le coffre-fort du système.
fn write_secure_value(key: &str, value: &str) -> Result<(), String> {
    secure_entry(key)?
        .set_password(value)
        .map_err(|error| format!("Failed to write to the OS secure store: {error}"))
}

/// Supprime une valeur du coffre-fort du système.
fn delete_secure_value(key: &str) -> Result<(), String> {
    match secure_entry(key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete from the OS secure store: {error}"
        )),
    }
}

/// Génère une valeur aléatoire compatible avec une URL.
fn random_url_safe(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

/// Calcule le challenge S256 d'un vérificateur PKCE.
fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Ferme la page de callback OAuth dans le navigateur avec un message de confirmation.
async fn acknowledge_oauth_callback(stream: &mut tokio::net::TcpStream) {
    let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><meta charset=\"utf-8\"><title>Quran Caption</title><script>window.close()</script>";
    let _ = stream.write_all(response).await;
    let _ = stream.shutdown().await;
}

/// Échange le code d'autorisation Google contre des tokens OAuth.
async fn exchange_code(
    client: &Client,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    let (client_id, client_secret) = credentials()?;
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|error| format!("YouTube OAuth token request failed: {error}"))?;
    parse_json_response(response, "YouTube OAuth token exchange").await
}

/// Renouvelle le token d'accès depuis le refresh token sécurisé.
async fn refresh_access_token(client: &Client) -> Result<String, String> {
    let refresh_token =
        read_secure_value(REFRESH_TOKEN_KEY)?.ok_or_else(|| "YOUTUBE_NOT_CONNECTED".to_string())?;
    let (client_id, client_secret) = credentials()?;
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|error| format!("YouTube token refresh failed: {error}"))?;
    let token: TokenResponse = parse_json_response(response, "YouTube token refresh").await?;
    Ok(token.access_token)
}

/// Valide et désérialise une réponse JSON HTTP.
async fn parse_json_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, String> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("{context} response read failed: {error}"))?;
    if !status.is_success() {
        return Err(format!("{context} failed ({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|error| format!("{context} response is invalid: {error}"))
}

/// Valide les métadonnées et fichiers d'une demande d'envoi.
fn validate_upload_request(request: &YouTubeUploadRequest) -> Result<(), String> {
    if request.title.trim().is_empty() || request.title.chars().count() > 100 {
        return Err("YOUTUBE_INVALID_TITLE".to_string());
    }
    if request.description.chars().count() > 5_000 {
        return Err("YOUTUBE_INVALID_DESCRIPTION".to_string());
    }
    if !matches!(
        request.privacy_status.as_str(),
        "public" | "private" | "unlisted"
    ) {
        return Err("YOUTUBE_INVALID_VISIBILITY".to_string());
    }
    if request.publish_at.is_some() && request.privacy_status != "private" {
        return Err("YOUTUBE_SCHEDULE_REQUIRES_PRIVATE".to_string());
    }
    if !Path::new(&request.file_path).is_file() {
        return Err("YOUTUBE_VIDEO_NOT_FOUND".to_string());
    }
    if let Some(path) = request.thumbnail_path.as_deref() {
        if !path.is_empty() {
            let thumbnail = Path::new(path);
            if !thumbnail.is_file() {
                return Err("YOUTUBE_THUMBNAIL_NOT_FOUND".to_string());
            }
            if thumbnail
                .metadata()
                .map(|value| value.len())
                .unwrap_or(u64::MAX)
                > 2 * 1024 * 1024
            {
                return Err("YOUTUBE_THUMBNAIL_TOO_LARGE".to_string());
            }
            if !matches!(
                thumbnail
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("png" | "jpg" | "jpeg")
            ) {
                return Err("YOUTUBE_INVALID_THUMBNAIL".to_string());
            }
        }
    }
    Ok(())
}

/// Initialise une session d'envoi reprenable auprès de YouTube.
async fn initiate_upload(
    client: &Client,
    access_token: &str,
    request: &YouTubeUploadRequest,
    file_size: u64,
) -> Result<String, String> {
    let mut status = serde_json::json!({
        "privacyStatus": request.privacy_status,
        "selfDeclaredMadeForKids": request.made_for_kids
    });
    if let Some(publish_at) = request.publish_at.as_deref() {
        status["publishAt"] = serde_json::Value::String(publish_at.to_string());
    }
    let body = serde_json::json!({
        "snippet": {
            "title": request.title.trim(),
            "description": request.description,
            "categoryId": "22"
        },
        "status": status
    });
    let response = client
        .post("https://www.googleapis.com/upload/youtube/v3/videos")
        .query(&[("uploadType", "resumable"), ("part", "snippet,status")])
        .bearer_auth(access_token)
        .header("X-Upload-Content-Type", "video/mp4")
        .header("X-Upload-Content-Length", file_size)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("YouTube upload initialization failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "YouTube upload initialization failed ({status}): {body}"
        ));
    }
    response
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| "YouTube did not return a resumable upload URL".to_string())
}

/// Envoie la vidéo par blocs dans la session YouTube.
async fn upload_file(
    app: &AppHandle,
    client: &Client,
    upload_url: &str,
    request: &YouTubeUploadRequest,
    file_size: u64,
) -> Result<String, String> {
    let mut file = tokio::fs::File::open(&request.file_path)
        .await
        .map_err(|error| format!("Failed to open exported video: {error}"))?;
    let mut uploaded = 0_u64;
    let mut buffer = vec![0_u8; UPLOAD_CHUNK_SIZE];

    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Failed to read exported video: {error}"))?;
        if read == 0 {
            return Err("YouTube upload ended without a video response".to_string());
        }
        let start = uploaded;
        let end = start + read as u64 - 1;
        let response = client
            .put(upload_url)
            .header(header::CONTENT_TYPE, "video/mp4")
            .header(header::CONTENT_LENGTH, read)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{file_size}"),
            )
            .body(buffer[..read].to_vec())
            .send()
            .await
            .map_err(|error| format!("YouTube video upload failed: {error}"))?;
        uploaded = end + 1;
        let _ = app.emit(
            "youtube-upload-progress",
            YouTubeUploadProgress {
                export_id: request.export_id,
                progress: ((uploaded * 95 / file_size.max(1)) as u8).min(95),
                stage: "uploading",
            },
        );

        if response.status().is_success() {
            let payload: serde_json::Value =
                parse_json_response(response, "YouTube video upload").await?;
            return payload
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| "YouTube upload response did not contain a video ID".to_string());
        }
        if response.status() != StatusCode::PERMANENT_REDIRECT {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("YouTube video upload failed ({status}): {body}"));
        }
    }
}

/// Envoie la miniature facultative de la vidéo.
async fn upload_thumbnail(
    client: &Client,
    access_token: &str,
    video_id: &str,
    path: &str,
) -> Result<(), String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Failed to read YouTube thumbnail: {error}"))?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("YOUTUBE_THUMBNAIL_TOO_LARGE".to_string());
    }
    let content_type = match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        _ => return Err("YOUTUBE_INVALID_THUMBNAIL".to_string()),
    };
    let response = client
        .post("https://www.googleapis.com/upload/youtube/v3/thumbnails/set")
        .query(&[("videoId", video_id), ("uploadType", "media")])
        .bearer_auth(access_token)
        .header(header::CONTENT_TYPE, content_type)
        .body(bytes)
        .send()
        .await
        .map_err(|error| format!("YouTube thumbnail upload failed: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "YouTube thumbnail upload failed ({status}): {body}"
        ));
    }
    Ok(())
}

/// Retourne l'état de connexion YouTube conservé dans le coffre-fort du système.
#[tauri::command]
pub fn youtube_auth_status() -> Result<YouTubeAuthStatus, String> {
    let configured = credentials().is_ok();
    let connected = read_secure_value(REFRESH_TOKEN_KEY)?.is_some();
    Ok(YouTubeAuthStatus {
        configured,
        connected,
        account_email: read_secure_value(ACCOUNT_EMAIL_KEY)?,
    })
}

/// Ouvre le consentement Google et conserve le refresh token dans le coffre-fort du système.
#[tauri::command]
pub async fn youtube_connect(app: AppHandle) -> Result<YouTubeAuthStatus, String> {
    let (client_id, _) = credentials()?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Failed to start YouTube OAuth callback: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to resolve YouTube OAuth callback: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/youtube/callback");
    let state = random_url_safe(24);
    let verifier = random_url_safe(64);
    let mut authorization_url =
        Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|e| e.to_string())?;
    authorization_url
        .query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair(
            "scope",
            "openid email https://www.googleapis.com/auth/youtube.upload",
        )
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge(&verifier))
        .append_pair("code_challenge_method", "S256");
    app.opener()
        .open_url(authorization_url.as_str(), None::<String>)
        .map_err(|error| format!("Failed to open YouTube authorization: {error}"))?;

    let (mut stream, _) = tokio::time::timeout(OAUTH_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "YOUTUBE_OAUTH_TIMEOUT".to_string())?
        .map_err(|error| format!("YouTube OAuth callback failed: {error}"))?;
    let mut buffer = vec![0_u8; 16 * 1024];
    let read = stream
        .read(&mut buffer)
        .await
        .map_err(|error| format!("YouTube OAuth callback read failed: {error}"))?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "Invalid YouTube OAuth callback".to_string())?;
    let callback = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|error| format!("Invalid YouTube OAuth callback: {error}"))?;
    let parameters: std::collections::HashMap<_, _> = callback.query_pairs().into_owned().collect();
    let callback_state = parameters.get("state").map(String::as_str).unwrap_or("");
    if callback_state != state {
        return Err("YOUTUBE_OAUTH_STATE_MISMATCH".to_string());
    }
    if let Some(error) = parameters.get("error") {
        return Err(format!("YouTube authorization failed: {error}"));
    }
    let code = parameters
        .get("code")
        .ok_or_else(|| "YouTube authorization did not return a code".to_string())?;
    acknowledge_oauth_callback(&mut stream).await;
    let client = Client::new();
    let token = exchange_code(&client, code, &verifier, &redirect_uri).await?;
    let refresh_token = token
        .refresh_token
        .ok_or_else(|| "YouTube did not return a refresh token".to_string())?;
    let user_info_response = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|error| format!("Failed to read connected Google account: {error}"))?;
    let user_info: GoogleUserInfo =
        parse_json_response(user_info_response, "Google account lookup").await?;
    let email = user_info
        .email
        .unwrap_or_else(|| "YouTube account".to_string());
    write_secure_value(REFRESH_TOKEN_KEY, &refresh_token)?;
    write_secure_value(ACCOUNT_EMAIL_KEY, &email)?;
    youtube_auth_status()
}

/// Supprime la connexion YouTube locale.
#[tauri::command]
pub fn youtube_disconnect() -> Result<YouTubeAuthStatus, String> {
    delete_secure_value(REFRESH_TOKEN_KEY)?;
    delete_secure_value(ACCOUNT_EMAIL_KEY)?;
    youtube_auth_status()
}

/// Publie une vidéo exportée sur YouTube et émet sa progression.
#[tauri::command]
pub async fn youtube_upload_video(
    app: AppHandle,
    request: YouTubeUploadRequest,
) -> Result<YouTubeUploadResult, String> {
    validate_upload_request(&request)?;
    let file_size = tokio::fs::metadata(&request.file_path)
        .await
        .map_err(|error| format!("Failed to inspect exported video: {error}"))?
        .len();
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to initialize YouTube upload: {error}"))?;
    let access_token = refresh_access_token(&client).await?;
    let _ = app.emit(
        "youtube-upload-progress",
        YouTubeUploadProgress {
            export_id: request.export_id,
            progress: 0,
            stage: "preparing",
        },
    );
    let upload_url = initiate_upload(&client, &access_token, &request, file_size).await?;
    let video_id = upload_file(&app, &client, &upload_url, &request, file_size).await?;
    let mut warning = None;
    if let Some(thumbnail_path) = request
        .thumbnail_path
        .as_deref()
        .filter(|path| !path.is_empty())
    {
        let _ = app.emit(
            "youtube-upload-progress",
            YouTubeUploadProgress {
                export_id: request.export_id,
                progress: 97,
                stage: "thumbnail",
            },
        );
        warning = upload_thumbnail(&client, &access_token, &video_id, thumbnail_path)
            .await
            .err();
    }
    let _ = app.emit(
        "youtube-upload-progress",
        YouTubeUploadProgress {
            export_id: request.export_id,
            progress: 100,
            stage: "completed",
        },
    );
    Ok(YouTubeUploadResult {
        url: format!("https://youtu.be/{video_id}"),
        video_id,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    /// Vérifie qu'une publication programmée reste privée.
    fn validates_scheduled_uploads_as_private() {
        let request = YouTubeUploadRequest {
            export_id: 1,
            file_path: std::env::current_exe()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            title: "Title".to_string(),
            description: String::new(),
            privacy_status: "public".to_string(),
            publish_at: Some("2030-01-01T10:00:00Z".to_string()),
            thumbnail_path: None,
            made_for_kids: false,
        };

        assert_eq!(
            validate_upload_request(&request),
            Err("YOUTUBE_SCHEDULE_REQUIRES_PRIVATE".to_string())
        );
    }

    #[test]
    /// Vérifie la génération déterministe du challenge PKCE.
    fn creates_pkce_challenges() {
        assert_eq!(
            code_challenge("test-verifier"),
            "JBbiqONGWPaAmwXk_8bT6UnlPfrn65D32eZlJS-zGG0"
        );
    }

    #[test]
    /// Vérifie que la limite de description compte les caractères Unicode.
    fn accepts_multibyte_descriptions_by_character_count() {
        let request = YouTubeUploadRequest {
            export_id: 1,
            file_path: std::env::current_exe()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            title: "Title".to_string(),
            description: "ق".repeat(5_000),
            privacy_status: "private".to_string(),
            publish_at: None,
            thumbnail_path: None,
            made_for_kids: false,
        };

        assert_eq!(validate_upload_request(&request), Ok(()));
    }
}
