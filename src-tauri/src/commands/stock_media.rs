use reqwest::header::{AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};

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

/// Commande Tauri pour rechercher des medias sur Pexels ou Pixabay.
///
/// @param query Termes de recherche.
/// @param source Source (`pexels` ou `pixabay`).
/// @param media_type Type de media (`photo`, `video` ou `all`).
/// @param api_key Cle API pour la source choisie.
/// @param page Numero de page (1-based).
/// @param per_page Nombre de resultats par page (max 80 pour Pexels, 200 pour Pixabay).
#[tauri::command]
pub async fn search_stock_media(
    query: String,
    source: String,
    media_type: String,
    api_key: String,
    page: u32,
    per_page: u32,
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
        _ => Err(format!("Unknown source: {}", source)),
    }
}
