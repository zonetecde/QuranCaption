use reqwest::header::{AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

use crate::binaries;
use crate::utils::process::configure_command_no_window;

const USER_AGENT_VALUE: &str = "QuranCaption/3";

#[derive(Debug, Serialize, Deserialize)]
pub struct StockMediaItem {
    pub id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub media_type: String,
    #[serde(rename = "previewUrl")]
    pub preview_url: String,
    #[serde(rename = "thumbnailUrl")]
    pub thumbnail_url: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    #[serde(rename = "previewVideoUrl")]
    pub preview_video_url: String,
    pub width: u32,
    pub height: u32,
    pub duration: Option<f64>,
    #[serde(rename = "authorName")]
    pub author_name: String,
    #[serde(rename = "authorUrl")]
    pub author_url: String,
    #[serde(rename = "pageUrl")]
    pub page_url: String,
}

#[derive(Debug, Serialize)]
pub struct StockMediaResponse {
    pub results: Vec<StockMediaItem>,
    pub page: u32,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
    #[serde(rename = "totalResults")]
    pub total_results: u32,
    #[serde(rename = "pinterestBookmarks", skip_serializing_if = "Option::is_none")]
    pub pinterest_bookmarks: Option<[Option<String>; 2]>,
}

/// Recherche des medias depuis Pexels.
///
/// @param query Termes de recherche.
/// @param api_key Cle API Pexels.
/// @param page Numero de page (1-based).
/// @param per_page Nombre de resultats par page.
/// @param media_type Type de media (`photos` ou `videos`).
async fn search_pexels(
    query: &str,
    api_key: &str,
    page: u32,
    per_page: u32,
    media_type: &str,
) -> Result<StockMediaResponse, String> {
    let client = reqwest::Client::new();
    let has_query = !query.trim().is_empty();
    let url = if media_type == "videos" {
        if has_query {
            format!(
                "https://api.pexels.com/videos/search?query={}&per_page={}&page={}",
                urlencoding(query),
                per_page,
                page
            )
        } else {
            format!(
                "https://api.pexels.com/videos/popular?per_page={}&page={}",
                per_page, page
            )
        }
    } else {
        if has_query {
            format!(
                "https://api.pexels.com/v1/search?query={}&per_page={}&page={}",
                urlencoding(query),
                per_page,
                page
            )
        } else {
            format!(
                "https://api.pexels.com/v1/curated?per_page={}&page={}",
                per_page, page
            )
        }
    };

    let resp = client
        .get(&url)
        .header(AUTHORIZATION, api_key)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .await
        .map_err(|e| format!("Pexels request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        let preview = if body_text.len() > 300 {
            &body_text[..300]
        } else {
            &body_text
        };
        return Err(format!("Pexels API error: {} — {}", status, preview));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Pexels response: {}", e))?;

    let items: Vec<StockMediaItem> = if media_type == "videos" {
        let videos = body["videos"].as_array().ok_or("Pexels: no videos array")?;
        videos
            .iter()
            .map(|v| {
                let video_files = v["video_files"].as_array();
                let best_file = video_files
                    .and_then(|files| {
                        files
                            .iter()
                            .filter(|f| {
                                f["quality"].as_str() == Some("hd")
                                    || f["quality"].as_str() == Some("sd")
                            })
                            .max_by_key(|f| {
                                if f["quality"].as_str() == Some("hd") {
                                    2
                                } else {
                                    1
                                }
                            })
                            .or_else(|| files.last())
                    })
                    .or(video_files.and_then(|f| f.first()));

                let preview_file = video_files
                    .and_then(|files| {
                        files
                            .iter()
                            .filter(|f| {
                                f["quality"].as_str() == Some("sd")
                                    || f["quality"].as_str() == Some("hd")
                            })
                            .min_by_key(|f| {
                                if f["quality"].as_str() == Some("sd") {
                                    0
                                } else {
                                    1
                                }
                            })
                            .or_else(|| files.first())
                    })
                    .or(video_files.and_then(|f| f.first()));

                StockMediaItem {
                    id: format!("pexels-video-{}", v["id"].as_u64().unwrap_or(0)),
                    source: "pexels".to_string(),
                    media_type: "video".to_string(),
                    preview_url: v["image"].as_str().unwrap_or("").to_string(),
                    thumbnail_url: v["image"].as_str().unwrap_or("").to_string(),
                    download_url: best_file
                        .and_then(|f| f["link"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    preview_video_url: preview_file
                        .and_then(|f| f["link"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    width: v["width"].as_u64().unwrap_or(0) as u32,
                    height: v["height"].as_u64().unwrap_or(0) as u32,
                    duration: v["duration"].as_f64(),
                    author_name: v["user"]["name"].as_str().unwrap_or("").to_string(),
                    author_url: v["user"]["url"].as_str().unwrap_or("").to_string(),
                    page_url: v["url"].as_str().unwrap_or("").to_string(),
                }
            })
            .collect()
    } else {
        let photos = body["photos"].as_array().ok_or("Pexels: no photos array")?;
        photos
            .iter()
            .map(|p| {
                let src = &p["src"];
                StockMediaItem {
                    id: format!("pexels-photo-{}", p["id"].as_u64().unwrap_or(0)),
                    source: "pexels".to_string(),
                    media_type: "photo".to_string(),
                    preview_url: src["large"].as_str().unwrap_or("").to_string(),
                    thumbnail_url: src["medium"].as_str().unwrap_or("").to_string(),
                    download_url: src["original"].as_str().unwrap_or("").to_string(),
                    preview_video_url: String::new(),
                    width: p["width"].as_u64().unwrap_or(0) as u32,
                    height: p["height"].as_u64().unwrap_or(0) as u32,
                    duration: None,
                    author_name: p["photographer"].as_str().unwrap_or("").to_string(),
                    author_url: p["photographer_url"].as_str().unwrap_or("").to_string(),
                    page_url: p["url"].as_str().unwrap_or("").to_string(),
                }
            })
            .collect()
    };

    let total = if media_type == "videos" {
        body["total_results"].as_u64().unwrap_or(0) as u32
    } else {
        body["total_results"].as_u64().unwrap_or(0) as u32
    };

    let has_more = (page * per_page) < total;

    Ok(StockMediaResponse {
        results: items,
        page,
        has_more,
        total_results: total,
        pinterest_bookmarks: None,
    })
}

/// Recherche des medias depuis Pixabay.
///
/// @param query Termes de recherche.
/// @param api_key Cle API Pixabay.
/// @param page Numero de page (1-based).
/// @param per_page Nombre de resultats par page.
/// @param media_type Type de media (`photo` ou `video`). Pixabay a des endpoints separes.
async fn search_pixabay(
    query: &str,
    api_key: &str,
    page: u32,
    per_page: u32,
    media_type: &str,
) -> Result<StockMediaResponse, String> {
    let client = reqwest::Client::new();
    let has_query = !query.trim().is_empty();
    let url = if media_type == "video" {
        if has_query {
            format!(
                "https://pixabay.com/api/videos/?key={}&q={}&per_page={}&page={}",
                api_key,
                urlencoding(query),
                per_page,
                page
            )
        } else {
            format!(
                "https://pixabay.com/api/videos/?key={}&per_page={}&page={}&order=popular",
                api_key, per_page, page
            )
        }
    } else {
        if has_query {
            format!(
                "https://pixabay.com/api/?key={}&q={}&per_page={}&page={}&image_type=photo",
                api_key,
                urlencoding(query),
                per_page,
                page
            )
        } else {
            format!(
                "https://pixabay.com/api/?key={}&per_page={}&page={}&order=popular&image_type=photo",
                api_key,
                per_page,
                page
            )
        }
    };

    let resp = client
        .get(&url)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .await
        .map_err(|e| format!("Pixabay request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        let preview = if body_text.len() > 300 {
            &body_text[..300]
        } else {
            &body_text
        };
        return Err(format!("Pixabay API error: {} — {}", status, preview));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Pixabay response: {}", e))?;

    let hits = body["hits"].as_array().ok_or("Pixabay: no hits array")?;

    let items: Vec<StockMediaItem> = if media_type == "video" {
        hits.iter()
            .map(|v| {
                let best_video = v["videos"].as_object().and_then(|videos_obj| {
                    let large = videos_obj.get("large");
                    let medium = videos_obj.get("medium");
                    let small = videos_obj.get("small");
                    large.or(medium).or(small)
                });

                StockMediaItem {
                    id: format!("pixabay-video-{}", v["id"].as_u64().unwrap_or(0)),
                    source: "pixabay".to_string(),
                    media_type: "video".to_string(),
                    preview_url: v["videos"]["large"]["thumbnail"]
                        .as_str()
                        .or(v["videos"]["medium"]["thumbnail"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    thumbnail_url: v["videos"]["large"]["thumbnail"]
                        .as_str()
                        .or(v["videos"]["medium"]["thumbnail"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    download_url: best_video
                        .and_then(|bv| bv["url"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    preview_video_url: v["videos"]["small"]["url"]
                        .as_str()
                        .or(v["videos"]["tiny"]["url"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    width: best_video.and_then(|bv| bv["width"].as_u64()).unwrap_or(0) as u32,
                    height: best_video.and_then(|bv| bv["height"].as_u64()).unwrap_or(0) as u32,
                    duration: v["duration"].as_f64(),
                    author_name: v["user"].as_str().unwrap_or("").to_string(),
                    author_url: format!(
                        "https://pixabay.com/users/{}/",
                        v["user"].as_str().unwrap_or("")
                    ),
                    page_url: v["pageURL"].as_str().unwrap_or("").to_string(),
                }
            })
            .collect()
    } else {
        hits.iter()
            .map(|p| StockMediaItem {
                id: format!("pixabay-photo-{}", p["id"].as_u64().unwrap_or(0)),
                source: "pixabay".to_string(),
                media_type: "photo".to_string(),
                preview_url: p["largeImageURL"].as_str().unwrap_or("").to_string(),
                thumbnail_url: p["webformatURL"].as_str().unwrap_or("").to_string(),
                download_url: p["largeImageURL"].as_str().unwrap_or("").to_string(),
                preview_video_url: String::new(),
                width: p["imageWidth"].as_u64().unwrap_or(0) as u32,
                height: p["imageHeight"].as_u64().unwrap_or(0) as u32,
                duration: None,
                author_name: p["user"].as_str().unwrap_or("").to_string(),
                author_url: format!(
                    "https://pixabay.com/users/{}/",
                    p["user"].as_str().unwrap_or("")
                ),
                page_url: p["pageURL"].as_str().unwrap_or("").to_string(),
            })
            .collect()
    };

    let total = body["totalHits"].as_u64().unwrap_or(0) as u32;
    let has_more = (page * per_page) < total;

    Ok(StockMediaResponse {
        results: items,
        page,
        has_more,
        total_results: total,
        pinterest_bookmarks: None,
    })
}

/// Verifie le CDN et le format avant de proposer un media Pinterest a l'import.
fn pinterest_media_url(media: &Value, video: bool) -> Option<&str> {
    let url = media["url"].as_str()?;
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    let extension = parsed.path().rsplit_once('.')?.1.to_ascii_lowercase();
    let supported = if video {
        matches!(host, "v.pinimg.com" | "v1.pinimg.com")
            && matches!(extension.as_str(), "mp4" | "m3u8")
    } else {
        host == "i.pinimg.com"
            && matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif")
    };
    (parsed.scheme() == "https"
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && supported)
        .then_some(url)
}

/// Accepte les identifiants numeriques et opaques utilises dans les liens et noms de fichier.
fn valid_pinterest_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

/// Convertit un pin public en resultat importable, avec son lien d'origine.
fn pinterest_item(pin: &Value, video: bool) -> Option<StockMediaItem> {
    let id = pin["id"].as_str()?;
    if !valid_pinterest_id(id) {
        return None;
    }

    let images = ["orig", "736x", "474x", "236x"].map(|size| &pin["images"][size]);
    let image = images
        .into_iter()
        .find(|image| pinterest_media_url(image, false).is_some());
    let thumbnail = pinterest_media_url(&pin["images"]["236x"], false)
        .or_else(|| image.and_then(|image| pinterest_media_url(image, false)));
    let media = if video {
        let story_videos = pin["story_pin_data"]["pages"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|page| page["blocks"].as_array().into_iter().flatten())
            .map(|block| &block["video"]["video_list"]);
        std::iter::once(&pin["videos"]["video_list"])
            .chain(story_videos)
            .filter_map(Value::as_object)
            .flat_map(|formats| formats.values())
            .filter_map(|format| Some((format, pinterest_media_url(format, true)?)))
            .max_by_key(|(format, url)| {
                (!pinterest_hls(url), format["width"].as_u64().unwrap_or(0))
            })
            .map(|(format, _)| format)
    } else {
        if pin["is_video"].as_bool() == Some(true) || !pin["videos"].is_null() {
            return None;
        }
        image
    }?;
    let download_url = pinterest_media_url(media, video)?;
    let thumbnail = thumbnail.or_else(|| pinterest_media_url(&media["thumbnail"], false));
    let username = pin["pinner"]["username"].as_str().filter(|name| {
        !name.is_empty()
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    });

    Some(StockMediaItem {
        id: format!("pinterest-{}-{id}", if video { "video" } else { "photo" }),
        source: "pinterest".into(),
        media_type: if video { "video" } else { "photo" }.into(),
        preview_url: thumbnail.unwrap_or_default().into(),
        thumbnail_url: thumbnail.unwrap_or_default().into(),
        download_url: download_url.into(),
        preview_video_url: if video && !pinterest_hls(download_url) {
            download_url
        } else {
            ""
        }
        .into(),
        width: media["width"].as_u64().unwrap_or(0) as u32,
        height: media["height"].as_u64().unwrap_or(0) as u32,
        duration: media["duration"].as_f64().map(|ms| ms / 1000.0),
        author_name: pin["pinner"]["full_name"]
            .as_str()
            .or(username)
            .unwrap_or_default()
            .into(),
        author_url: username
            .map(|name| format!("https://www.pinterest.com/{name}/"))
            .unwrap_or_default(),
        page_url: format!("https://www.pinterest.com/pin/{id}/"),
    })
}

/// Identifie une playlist HLS a partir du chemin de son URL.
fn pinterest_hls(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|url| {
        url.path()
            .rsplit_once('.')
            .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("m3u8"))
    })
}

/// Enregistre une playlist Pinterest en MP4 dans le cache des medias du projet.
#[tauri::command]
pub async fn download_pinterest_hls(
    app: tauri::AppHandle,
    url: String,
    id: String,
    expected_duration: Option<f64>,
) -> Result<String, String> {
    if !id
        .strip_prefix("pinterest-video-")
        .is_some_and(valid_pinterest_id)
        || !pinterest_hls(&url)
        || pinterest_media_url(&json!({ "url": url }), true).is_none()
    {
        return Err("Pinterest: invalid video".into());
    }

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("downloads")
        .join("stock-media");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;
    let path = directory.join(format!("{id}.mp4"));
    static TEMP_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sequence = TEMP_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = directory.join(format!("{id}.{}.{sequence}.part", std::process::id()));
    let ffmpeg = binaries::resolve_binary("ffmpeg").ok_or("FFmpeg")?;
    let mut command = std::process::Command::new(ffmpeg);
    configure_command_no_window(&mut command);
    let mut output = tokio::process::Command::from(command);
    output
        .kill_on_drop(true)
        .args([
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-rw_timeout",
            "15000000",
            "-protocol_whitelist",
            "https,tls,tcp,crypto",
            // Pinterest utilise plusieurs plages dans un meme fichier fragmente.
            "-http_seekable",
            "0",
            "-i",
            &url,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(&temp);
    let result = async {
        let output = tokio::time::timeout(std::time::Duration::from_secs(120), output.output())
            .await
            .map_err(|error| format!("FFmpeg: {error}"))?
            .map_err(|error| format!("FFmpeg: {error}"))?;
        if !output.status.success() {
            return Err(format!("FFmpeg: {}", output.status));
        }

        let probe_path = temp.clone();
        let duration_ms = tokio::task::spawn_blocking(move || {
            super::media::get_duration(&probe_path.to_string_lossy())
        })
        .await
        .map_err(|error| error.to_string())??;
        let expected_ms = (expected_duration.unwrap_or(0.0) * 1000.0).round() as i64;
        if duration_ms <= 0 || duration_ms < expected_ms.saturating_sub(1000) {
            return Err(format!(
                "Pinterest HLS: {duration_ms} ms / {expected_ms} ms"
            ));
        }

        tokio::fs::rename(&temp, &path)
            .await
            .map_err(|error| error.to_string())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
    }
    result?;
    Ok(path.to_string_lossy().into_owned())
}

/// Recherche une page de pins publics selon le protocole de x7007x/PinterestDownloader.
/// https://github.com/x7007x/PinterestDownloader/blob/main/pinterest_downloader/pinterest.py
async fn search_pinterest_page(
    client: &reqwest::Client,
    query: &str,
    video: bool,
    page_size: u32,
    bookmark: Option<&str>,
) -> Result<(Vec<StockMediaItem>, Option<String>), String> {
    let Some(bookmark) = bookmark else {
        return Ok((Vec::new(), None));
    };
    let scope = if video { "videos" } else { "pins" };
    let source_url = format!("/search/{scope}/?q={}", urlencoding(query));
    let bookmarks = if bookmark.is_empty() {
        &[][..]
    } else {
        std::slice::from_ref(&bookmark)
    };
    let data = json!({
        "options": { "query": query, "scope": scope, "page_size": page_size, "bookmarks": bookmarks },
        "context": {},
    });
    let body: Value = client
        .get("https://www.pinterest.com/resource/BaseSearchResource/get/")
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .header("X-Pinterest-PWS-Handler", "www/[username]/search/pins.js")
        .query(&[("source_url", source_url), ("data", data.to_string())])
        .timeout(std::time::Duration::from_secs(20))
        .send().await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Pinterest: {}", error.without_url()))?
        .json().await
        .map_err(|error| format!("Pinterest: {error}"))?;
    let response = &body["resource_response"];
    let results = response["data"]["results"].as_array().ok_or("Pinterest")?;
    let mut seen = std::collections::HashSet::new();
    let items = results
        .iter()
        .filter_map(|pin| pinterest_item(pin, video))
        .filter(|item| seen.insert(item.id.clone()))
        .collect();
    let next = response["bookmark"]
        .as_str()
        .filter(|next| !next.is_empty() && *next != "-end-" && *next != bookmark)
        .map(str::to_owned);
    Ok((items, next))
}

/// Fusionne les recherches photo et video en gardant un curseur par filtre.
async fn search_pinterest(
    query: &str,
    media_type: &str,
    page: u32,
    per_page: u32,
    bookmarks: Option<[Option<String>; 2]>,
) -> Result<StockMediaResponse, String> {
    let query = if query.is_empty() {
        "nature landscapes"
    } else {
        query
    };
    let [photos, videos] = bookmarks.unwrap_or_else(|| {
        if page == 1 {
            [
                (media_type != "video").then(String::new),
                (media_type != "photo").then(String::new),
            ]
        } else {
            [None, None]
        }
    });
    let page_size = if media_type == "all" {
        per_page / 2
    } else {
        per_page
    }
    .clamp(1, 25);
    let client = reqwest::Client::new();
    let ((mut results, photos), (videos_results, videos)) = tokio::try_join!(
        search_pinterest_page(&client, query, false, page_size, photos.as_deref()),
        search_pinterest_page(&client, query, true, page_size, videos.as_deref()),
    )?;
    results.extend(videos_results);
    Ok(StockMediaResponse {
        total_results: results.len() as u32,
        results,
        page,
        has_more: photos.is_some() || videos.is_some(),
        pinterest_bookmarks: Some([photos, videos]),
    })
}

/// Encode une chaine pour une URL de requete.
fn urlencoding(s: &str) -> String {
    let mut result = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            b' ' => result.push('+'),
            _ => {
                result.push('%');
                result.push_str(&format!("{:02X}", byte));
            }
        }
    }
    result
}

/// Commande Tauri pour rechercher des medias sur Pexels, Pixabay ou Pinterest.
///
/// @param query Termes de recherche.
/// @param source Source (`pexels`, `pixabay` ou `pinterest`).
/// @param media_type Type de media (`photo`, `video` ou `all`).
/// @param api_key Cle API pour la source choisie.
/// @param page Numero de page (1-based).
/// @param per_page Nombre de resultats par page (max 80 pour Pexels, 200 pour Pixabay).
/// @param pinterest_bookmarks Curseurs photo et video renvoyes par la page precedente.
#[tauri::command]
pub async fn search_stock_media(
    query: String,
    source: String,
    media_type: String,
    api_key: String,
    page: u32,
    per_page: u32,
    pinterest_bookmarks: Option<[Option<String>; 2]>,
) -> Result<StockMediaResponse, String> {
    let per_page = per_page.min(80);

    let api_key = api_key.trim();
    match source.as_str() {
        "pexels" => {
            if api_key.is_empty() {
                return Err("Pexels API key is required".to_string());
            }
            if media_type == "video" {
                search_pexels(&query, api_key, page, per_page, "videos").await
            } else if media_type == "photo" {
                search_pexels(&query, api_key, page, per_page, "photos").await
            } else {
                let photos_fut = search_pexels(&query, api_key, page, per_page / 2, "photos");
                let videos_fut = search_pexels(&query, &api_key, page, per_page / 2, "videos");
                let (photos_result, videos_result) = tokio::join!(photos_fut, videos_fut);

                match (photos_result, videos_result) {
                    (Ok(mut photos), Ok(videos)) => {
                        photos.results.extend(videos.results);
                        photos.has_more = photos.has_more || videos.has_more;
                        photos.total_results += videos.total_results;
                        Ok(photos)
                    }
                    (Ok(photos), Err(_)) => Ok(photos),
                    (Err(_), Ok(videos)) => Ok(videos),
                    (Err(e), Err(_)) => Err(e),
                }
            }
        }
        "pixabay" => {
            if api_key.is_empty() {
                return Err("Pixabay API key is required".to_string());
            }
            if media_type == "video" {
                search_pixabay(&query, &api_key, page, per_page, "video").await
            } else if media_type == "photo" {
                search_pixabay(&query, &api_key, page, per_page, "photo").await
            } else {
                // "all": chercher les deux et fusionner
                let photos_fut = search_pixabay(&query, &api_key, page, per_page / 2, "photo");
                let videos_fut = search_pixabay(&query, &api_key, page, per_page / 2, "video");
                let (photos_result, videos_result) = tokio::join!(photos_fut, videos_fut);

                match (photos_result, videos_result) {
                    (Ok(mut photos), Ok(videos)) => {
                        photos.results.extend(videos.results);
                        photos.has_more = photos.has_more || videos.has_more;
                        photos.total_results += videos.total_results;
                        Ok(photos)
                    }
                    (Ok(photos), Err(_)) => Ok(photos),
                    (Err(_), Ok(videos)) => Ok(videos),
                    (Err(e), Err(_)) => Err(e),
                }
            }
        }
        "pinterest" => {
            search_pinterest(
                query.trim(),
                &media_type,
                page,
                per_page,
                pinterest_bookmarks,
            )
            .await
        }
        _ => Err(format!("Unknown source: {}", source)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifie les identifiants opaques et les videos sans MP4 direct.
    #[test]
    fn pinterest_accepts_opaque_ids_and_hls() {
        let pin = json!({
            "id": "e1_test-pin",
            "images": { "orig": { "url": "https://i.pinimg.com/originals/pin.jpg" } }
        });
        let photo = pinterest_item(&pin, false).unwrap();
        assert_eq!(photo.id, "pinterest-photo-e1_test-pin");

        let mut pin = pin;
        let hls = "https://v1.pinimg.com/videos/iht/hls/pin.m3u8";
        pin["videos"] = json!({ "video_list": { "HLS": { "url": hls, "width": 720 } } });
        let video = pinterest_item(&pin, true).unwrap();
        assert_eq!(video.download_url, hls);
        assert!(video.preview_video_url.is_empty());

        let mp4 = "https://v1.pinimg.com/videos/pin.mp4";
        pin["videos"]["video_list"]["MP4"] = json!({ "url": mp4, "width": 480 });
        assert_eq!(pinterest_item(&pin, true).unwrap().download_url, mp4);

        pin["id"] = json!("../pin");
        assert!(pinterest_item(&pin, true).is_none());
    }
}
