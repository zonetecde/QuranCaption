use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
#[cfg(any(desktop, target_os = "android"))]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(desktop)]
use font_kit::file_type::FileType;
#[cfg(desktop)]
use font_kit::font::Font;
#[cfg(desktop)]
use font_kit::handle::Handle;
#[cfg(desktop)]
use font_kit::properties::Style;
#[cfg(desktop)]
use font_kit::source::SystemSource;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;

const FFPROBE_NOT_FOUND_ERROR: &str = "FFPROBE_NOT_FOUND";
const FFPROBE_NOT_EXECUTABLE_ERROR: &str = "FFPROBE_NOT_EXECUTABLE";
const FFPROBE_EXEC_FAILED_ERROR_PREFIX: &str = "FFPROBE_EXEC_FAILED:";

/// Convertit une erreur de résolution ffprobe en message attendu côté frontend.
fn map_ffprobe_resolve_error(err: binaries::BinaryResolveError) -> String {
    match err.code.as_str() {
        "BINARY_NOT_FOUND" => FFPROBE_NOT_FOUND_ERROR.to_string(),
        "BINARY_NOT_EXECUTABLE" => format!("{}: {}", FFPROBE_NOT_EXECUTABLE_ERROR, err.details),
        _ => format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, err.details),
    }
}

/// Formate une erreur d'exécution ffprobe avec le préfixe contractuel IPC.
fn format_ffprobe_exec_failed(details: &str) -> String {
    format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, details.trim())
}

const TIMELINE_THUMBNAIL_CACHE_VERSION: &str = "v1";
const MAX_TIMELINE_THUMBNAILS_PER_REQUEST: usize = 32;
static TIMELINE_THUMBNAIL_EXTRACTION_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineVideoThumbnail {
    pub timestamp_ms: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontSource {
    pub family: String,
    pub source_family: String,
    pub full_name: String,
    pub postscript_name: Option<String>,
    pub path: String,
    pub font_index: u32,
    pub format: Option<String>,
    pub font_weight: u16,
    pub font_weight_range: Option<String>,
    pub font_style: String,
}

/// Retourne la durée d'un média en millisecondes.
#[tauri::command]
pub fn get_duration(file_path: &str) -> Result<i64, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    if !file_path.exists() {
        return Ok(-1);
    }

    get_duration_from_path(&file_path)
}

/// Retourne la durée d'un média en millisecondes depuis un chemin normalisé.
///
/// @param file_path Chemin normalisé du fichier média.
/// @returns Durée du média en millisecondes.
#[cfg(target_os = "android")]
fn get_duration_from_path(file_path: &std::path::Path) -> Result<i64, String> {
    println!(
        "[android-media] probing duration without ffprobe: {}",
        file_path.to_string_lossy()
    );
    super::android_media::get_duration_ms(file_path)
}

/// Retourne la durée d'un média en millisecondes depuis un chemin normalisé.
///
/// @param file_path Chemin normalisé du fichier média.
/// @returns Durée du média en millisecondes.
#[cfg(not(target_os = "android"))]
fn get_duration_from_path(file_path: &std::path::Path) -> Result<i64, String> {
    let ffprobe_path = match binaries::resolve_binary_detailed("ffprobe") {
        Ok(p) => p,
        Err(err) => return Err(map_ffprobe_resolve_error(err)),
    };

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                let duration_line = output_str.trim();
                if let Ok(duration_seconds) = duration_line.parse::<f64>() {
                    Ok((duration_seconds * 1000.0).round() as i64)
                } else {
                    Err("Unable to parse duration from ffprobe output".to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format_ffprobe_exec_failed(&stderr))
            }
        }
        Err(e) => Err(format_ffprobe_exec_failed(&format!(
            "Unable to execute ffprobe: {}",
            e
        ))),
    }
}

/// Trie, déduplique et borne les timestamps demandés pour protéger le processus FFmpeg.
///
/// # Paramètres
/// * `timestamps_ms` - Positions sources demandées en millisecondes.
///
/// # Retourne
/// Une liste triée contenant au maximum `MAX_TIMELINE_THUMBNAILS_PER_REQUEST` positions.
fn normalize_timeline_thumbnail_timestamps(mut timestamps_ms: Vec<u64>) -> Vec<u64> {
    timestamps_ms.sort_unstable();
    timestamps_ms.dedup();
    timestamps_ms.truncate(MAX_TIMELINE_THUMBNAILS_PER_REQUEST);
    timestamps_ms
}

/// Construit le dossier de cache propre à une version précise du fichier vidéo.
///
/// # Paramètres
/// * `cache_root` - Racine du cache applicatif.
/// * `source_path` - Chemin normalisé de la vidéo source.
/// * `width` - Largeur des miniatures.
/// * `height` - Hauteur des miniatures.
///
/// # Retourne
/// Le dossier de cache invalidé automatiquement si la source change.
fn timeline_thumbnail_cache_dir(
    cache_root: &Path,
    source_path: &Path,
    width: u32,
    height: u32,
) -> Result<PathBuf, String> {
    let metadata = fs::metadata(source_path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis());
    let fingerprint = format!(
        "{}|{}|{}|{}|{}x{}",
        TIMELINE_THUMBNAIL_CACHE_VERSION,
        source_path.to_string_lossy(),
        metadata.len(),
        modified_ms,
        width,
        height
    );
    let cache_key = format!("{:x}", md5::compute(fingerprint.as_bytes()));
    Ok(cache_root.join("timeline-thumbnails").join(cache_key))
}

/// Vérifie qu'une miniature en cache existe et contient des données.
///
/// # Paramètres
/// * `path` - Chemin de la miniature finale.
///
/// # Retourne
/// `true` si le fichier peut être réutilisé sans relancer FFmpeg.
fn is_cached_timeline_thumbnail(path: &str) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

/// Retourne le verrou d'extraction propre à une vidéo source.
///
/// # Paramètres
/// * `source_path` - Chemin normalisé de la vidéo source.
///
/// # Retourne
/// Un verrou partagé qui sérialise uniquement les extractions de cette vidéo.
fn timeline_thumbnail_extraction_lock(source_path: &Path) -> Result<Arc<Mutex<()>>, String> {
    let locks = TIMELINE_THUMBNAIL_EXTRACTION_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .map_err(|_| "Timeline thumbnail lock registry is poisoned".to_string())?;
    Ok(Arc::clone(
        locks
            .entry(source_path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(()))),
    ))
}

/// Extrait en une seule commande FFmpeg toutes les miniatures absentes du cache.
///
/// # Paramètres
/// * `source_path` - Vidéo source normalisée.
/// * `timestamps_ms` - Positions sources triées et dédupliquées.
/// * `cache_dir` - Dossier de cache propre à la vidéo.
/// * `width` - Largeur de sortie.
/// * `height` - Hauteur de sortie.
///
/// # Retourne
/// Les chemins de miniatures associés à chaque timestamp demandé.
fn extract_timeline_video_thumbnails(
    source_path: &Path,
    timestamps_ms: &[u64],
    cache_dir: &Path,
    width: u32,
    height: u32,
) -> Result<Vec<TimelineVideoThumbnail>, String> {
    fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;
    let thumbnails: Vec<TimelineVideoThumbnail> = timestamps_ms
        .iter()
        .map(|timestamp_ms| TimelineVideoThumbnail {
            timestamp_ms: *timestamp_ms,
            path: cache_dir
                .join(format!("{}.jpg", timestamp_ms))
                .to_string_lossy()
                .to_string(),
        })
        .collect();
    let mut missing: Vec<&TimelineVideoThumbnail> = thumbnails
        .iter()
        .filter(|thumbnail| !is_cached_timeline_thumbnail(&thumbnail.path))
        .collect();
    if missing.is_empty() {
        return Ok(thumbnails);
    }

    let extraction_lock = timeline_thumbnail_extraction_lock(source_path)?;
    let _guard = extraction_lock
        .lock()
        .map_err(|_| "Timeline thumbnail extraction lock is poisoned".to_string())?;
    missing.retain(|thumbnail| !is_cached_timeline_thumbnail(&thumbnail.path));
    if missing.is_empty() {
        return Ok(thumbnails);
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let source = source_path.to_string_lossy();
    let mut command = Command::new(ffmpeg_path);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    for thumbnail in &missing {
        command
            .arg("-ss")
            .arg(format!("{:.3}", thumbnail.timestamp_ms as f64 / 1000.0))
            .arg("-i")
            .arg(source.as_ref());
    }
    let video_filter = format!(
        "scale={}:{}:force_original_aspect_ratio=increase,crop={}:{}",
        width, height, width, height
    );
    let temporary_paths: Vec<String> = missing
        .iter()
        .map(|thumbnail| format!("{}.tmp.jpg", thumbnail.path.trim_end_matches(".jpg")))
        .collect();
    for (input_index, temporary_path) in temporary_paths.iter().enumerate() {
        command
            .arg("-map")
            .arg(format!("{}:v:0", input_index))
            .args(["-frames:v", "1", "-vf"])
            .arg(&video_filter)
            .args(["-q:v", "5"])
            .arg(temporary_path);
    }
    configure_command_no_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Unable to execute ffmpeg: {error}"))?;
    for (thumbnail, temporary_path) in missing.iter().zip(&temporary_paths) {
        if !is_cached_timeline_thumbnail(temporary_path) {
            continue;
        }
        if let Err(error) = fs::rename(temporary_path, &thumbnail.path) {
            for path in &temporary_paths {
                fs::remove_file(path).ok();
            }
            return Err(format!("Unable to cache timeline thumbnail: {error}"));
        }
    }
    for temporary_path in &temporary_paths {
        fs::remove_file(temporary_path).ok();
    }

    let available_thumbnails: Vec<TimelineVideoThumbnail> = thumbnails
        .into_iter()
        .filter(|thumbnail| is_cached_timeline_thumbnail(&thumbnail.path))
        .collect();
    if !available_thumbnails.is_empty() {
        return Ok(available_thumbnails);
    }
    if !output.status.success() {
        return Err(format!(
            "ffmpeg thumbnail error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Err("ffmpeg did not create any timeline thumbnail".to_string())
}

/// Retourne les miniatures nécessaires à la portion visible d'un clip vidéo.
///
/// Les images déjà présentes dans le cache applicatif ne sont pas réextraites.
///
/// # Paramètres
/// * `app` - Handle Tauri utilisé pour résoudre le cache applicatif.
/// * `file_path` - Chemin de la vidéo source.
/// * `timestamps_ms` - Positions sources visibles à extraire.
/// * `width` - Largeur demandée, entre 48 et 320 pixels.
/// * `height` - Hauteur demandée, entre 32 et 180 pixels.
///
/// # Retourne
/// Les timestamps et chemins locaux des miniatures mises en cache.
#[tauri::command]
pub async fn get_video_timeline_thumbnails(
    app: AppHandle,
    file_path: String,
    timestamps_ms: Vec<u64>,
    width: u32,
    height: u32,
) -> Result<Vec<TimelineVideoThumbnail>, String> {
    if !(48..=320).contains(&width) || !(32..=180).contains(&height) {
        return Err("Invalid timeline thumbnail dimensions".to_string());
    }
    let source_path = path_utils::normalize_existing_path(&file_path);
    if !source_path.is_file() {
        return Err(format!("Source file not found: {}", source_path.display()));
    }
    let timestamps_ms = normalize_timeline_thumbnail_timestamps(timestamps_ms);
    if timestamps_ms.is_empty() {
        return Ok(Vec::new());
    }
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let cache_dir = timeline_thumbnail_cache_dir(&cache_root, &source_path, width, height)?;

    tokio::task::spawn_blocking(move || {
        extract_timeline_video_thumbnails(&source_path, &timestamps_ms, &cache_dir, width, height)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Retourne la liste des polices système disponibles (noms de familles uniques).
#[tauri::command]
#[cfg(desktop)]
pub fn get_system_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    // all_families() is the most portable API and avoids loading every single font file.
    if let Ok(mut families) = source.all_families() {
        families.sort();
        families.dedup();
        return Ok(families);
    }

    // Fallback path: enumerate handles and ignore fonts that fail to load.
    let fonts = source.all_fonts().map_err(|e| e.to_string())?;
    let mut font_names = Vec::new();
    let mut seen_names = HashSet::new();

    for font in fonts {
        if let Ok(handle) = font.load() {
            let family = handle.family_name();
            if seen_names.insert(family.clone()) {
                font_names.push(family);
            }
        }
    }

    font_names.sort();
    Ok(font_names)
}

/// Retourne les familles de polices installées dans les dossiers système Android.
#[tauri::command]
#[cfg(target_os = "android")]
pub fn get_system_fonts() -> Result<Vec<String>, String> {
    let mut families = HashSet::new();
    for directory in [
        "/system/fonts",
        "/product/fonts",
        "/system_ext/fonts",
        "/vendor/fonts",
        "/data/fonts",
    ] {
        collect_android_font_families(Path::new(directory), &mut families);
    }

    let mut families: Vec<String> = families.into_iter().collect();
    families.sort();
    Ok(families)
}

/// Retourne une liste vide sur les plateformes mobiles autres qu'Android.
#[tauri::command]
#[cfg(all(mobile, not(target_os = "android")))]
pub fn get_system_fonts() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Parcourt un dossier Android et collecte les familles déclarées par chaque fichier de police.
///
/// @param directory Dossier de polices à parcourir.
/// @param families Ensemble des familles déjà trouvées.
/// @returns Rien.
#[cfg(target_os = "android")]
fn collect_android_font_families(directory: &Path, families: &mut HashSet<String>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_android_font_families(&path, families);
        } else if is_android_font_path(&path) {
            collect_font_file_families(&path, families);
        }
    }
}

/// Lit les métadonnées OpenType d'un fichier et ajoute ses noms de famille.
///
/// @param path Fichier de police Android.
/// @param families Ensemble des familles déjà trouvées.
/// @returns Rien.
#[cfg(target_os = "android")]
fn collect_font_file_families(path: &Path, families: &mut HashSet<String>) {
    let Ok(data) = fs::read(path) else {
        return;
    };
    let face_count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);

    for face_index in 0..face_count {
        let Ok(face) = ttf_parser::Face::parse(&data, face_index) else {
            continue;
        };
        families.extend(font_face_family_names(&face));
    }
}

/// Retourne les noms de famille CSS déclarés par une face OpenType.
///
/// @param face Face de police analysée.
/// @returns Noms typographiques, ou anciens noms de famille en repli.
#[cfg(target_os = "android")]
fn font_face_family_names(face: &ttf_parser::Face<'_>) -> Vec<String> {
    let mut legacy_families = Vec::new();
    let mut typographic_families = Vec::new();

    for name in face.names() {
        let Some(value) = name.to_string() else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }

        if name.name_id == ttf_parser::name_id::TYPOGRAPHIC_FAMILY {
            typographic_families.push(value.to_string());
        } else if name.name_id == ttf_parser::name_id::FAMILY {
            legacy_families.push(value.to_string());
        }
    }

    if typographic_families.is_empty() {
        legacy_families
    } else {
        typographic_families
    }
}

/// Retourne la première valeur Unicode d'un champ de nom OpenType.
///
/// @param face Face de police analysée.
/// @param name_id Identifiant OpenType du champ demandé.
/// @returns Nom décodé lorsqu'il existe.
#[cfg(target_os = "android")]
fn font_face_name(face: &ttf_parser::Face<'_>, name_id: u16) -> Option<String> {
    face.names()
        .into_iter()
        .find(|name| name.name_id == name_id)
        .and_then(|name| name.to_string())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

/// Indique si un chemin Android correspond à un format de police OpenType pris en charge.
///
/// @param path Chemin à vérifier.
/// @returns `true` pour une police TTF, TTC, OTF ou OTC.
#[cfg(target_os = "android")]
fn is_android_font_path(path: &Path) -> bool {
    path.extension()
        .map(|extension| {
            matches!(
                extension.to_string_lossy().to_ascii_lowercase().as_str(),
                "ttf" | "ttc" | "otf" | "otc"
            )
        })
        .unwrap_or(false)
}

/// Resolves selected system font families to concrete font files.
///
/// The preview renderer can use `font-family: Some Installed Font` directly, but the export
/// screenshotter needs URL-backed @font-face rules so it can embed the font in the cloned SVG.
#[tauri::command]
#[cfg(desktop)]
pub fn get_system_font_sources(
    font_families: Vec<String>,
) -> Result<Vec<SystemFontSource>, String> {
    let mut sources = Vec::new();
    let mut requested_families = HashSet::new();
    let mut seen_sources = HashSet::new();

    let requested: Vec<String> = font_families
        .into_iter()
        .filter_map(|family| {
            let family = family.trim().to_string();
            if family.is_empty() || !requested_families.insert(family.clone()) {
                None
            } else {
                Some(family)
            }
        })
        .collect();

    if requested.is_empty() {
        return Ok(sources);
    }

    for directory in default_system_font_directories() {
        collect_font_sources_from_directory(
            &directory,
            &requested,
            &mut seen_sources,
            &mut sources,
        );
    }

    sources.sort_by(|a, b| {
        a.family
            .cmp(&b.family)
            .then(a.font_style.cmp(&b.font_style))
            .then(a.font_weight.cmp(&b.font_weight))
            .then(a.full_name.cmp(&b.full_name))
            .then(a.path.cmp(&b.path))
    });

    Ok(sources)
}

/// Résout les familles Android demandées vers leurs fichiers de police système.
#[tauri::command]
#[cfg(target_os = "android")]
pub fn get_system_font_sources(
    font_families: Vec<String>,
) -> Result<Vec<SystemFontSource>, String> {
    let requested: HashSet<String> = font_families
        .into_iter()
        .map(|family| family.trim().to_string())
        .filter(|family| !family.is_empty())
        .collect();
    let mut sources = Vec::new();
    let mut seen_sources = HashSet::new();

    for directory in [
        "/system/fonts",
        "/product/fonts",
        "/system_ext/fonts",
        "/vendor/fonts",
        "/data/fonts",
    ] {
        collect_android_font_sources(
            Path::new(directory),
            &requested,
            &mut seen_sources,
            &mut sources,
        );
    }

    sources.sort_by(|a, b| {
        a.family
            .cmp(&b.family)
            .then(a.font_weight.cmp(&b.font_weight))
            .then(a.font_style.cmp(&b.font_style))
            .then(a.path.cmp(&b.path))
    });
    Ok(sources)
}

/// Retourne une liste vide sur les plateformes mobiles autres qu'Android.
#[tauri::command]
#[cfg(all(mobile, not(target_os = "android")))]
pub fn get_system_font_sources(
    _font_families: Vec<String>,
) -> Result<Vec<SystemFontSource>, String> {
    Ok(Vec::new())
}

/// Parcourt les dossiers Android pour retrouver les fichiers des familles demandées.
///
/// @param directory Dossier de polices à parcourir.
/// @param requested Familles demandées par le navigateur.
/// @param seen_sources Identifiants des faces déjà ajoutées.
/// @param sources Sources résolues.
/// @returns Rien.
#[cfg(target_os = "android")]
fn collect_android_font_sources(
    directory: &Path,
    requested: &HashSet<String>,
    seen_sources: &mut HashSet<String>,
    sources: &mut Vec<SystemFontSource>,
) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_android_font_sources(&path, requested, seen_sources, sources);
        } else if is_android_font_path(&path) {
            collect_android_font_file_sources(&path, requested, seen_sources, sources);
        }
    }
}

/// Extrait les faces demandées d'un fichier de police Android.
///
/// @param path Fichier de police à analyser.
/// @param requested Familles demandées par le navigateur.
/// @param seen_sources Identifiants des faces déjà ajoutées.
/// @param sources Sources résolues.
/// @returns Rien.
#[cfg(target_os = "android")]
fn collect_android_font_file_sources(
    path: &Path,
    requested: &HashSet<String>,
    seen_sources: &mut HashSet<String>,
    sources: &mut Vec<SystemFontSource>,
) {
    let Ok(data) = fs::read(path) else {
        return;
    };
    let face_count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);

    for face_index in 0..face_count {
        let Ok(face) = ttf_parser::Face::parse(&data, face_index) else {
            continue;
        };
        let Some(family) = font_face_family_names(&face)
            .into_iter()
            .find(|family| requested.contains(family))
        else {
            continue;
        };
        let key = format!("{}:{}:{}", family, path.display(), face_index);
        if !seen_sources.insert(key) {
            continue;
        }

        let full_name =
            font_face_name(&face, ttf_parser::name_id::FULL_NAME).unwrap_or_else(|| family.clone());
        let postscript_name = font_face_name(&face, ttf_parser::name_id::POST_SCRIPT_NAME);
        let font_style = if face.is_italic() {
            "italic"
        } else if face.is_oblique() {
            "oblique"
        } else {
            "normal"
        };

        sources.push(SystemFontSource {
            family: family.clone(),
            source_family: family,
            full_name,
            postscript_name,
            path: path.to_string_lossy().to_string(),
            font_index: face_index,
            format: font_format_for_path(path),
            font_weight: face.weight().to_number(),
            font_weight_range: None,
            font_style: font_style.to_string(),
        });
    }
}

#[cfg(desktop)]
fn collect_font_sources_from_directory(
    directory: &Path,
    requested_families: &[String],
    seen_sources: &mut HashSet<String>,
    sources: &mut Vec<SystemFontSource>,
) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_font_sources_from_directory(&path, requested_families, seen_sources, sources);
            continue;
        }

        if !is_supported_font_path(&path) {
            continue;
        }

        let mut file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(_) => continue,
        };

        let file_type = match Font::analyze_file(&mut file) {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        match file_type {
            FileType::Single => {
                add_font_source_if_requested(&path, 0, requested_families, seen_sources, sources);
            }
            FileType::Collection(font_count) => {
                for font_index in 0..font_count {
                    add_font_source_if_requested(
                        &path,
                        font_index,
                        requested_families,
                        seen_sources,
                        sources,
                    );
                }
            }
        }
    }
}

#[cfg(desktop)]
fn add_font_source_if_requested(
    path: &Path,
    font_index: u32,
    requested_families: &[String],
    seen_sources: &mut HashSet<String>,
    sources: &mut Vec<SystemFontSource>,
) {
    let handle = Handle::from_path(path.to_owned(), font_index);
    let font = match handle.load() {
        Ok(font) => font,
        Err(_) => return,
    };

    let source_family = font.family_name();
    let Some(requested_family) = requested_families
        .iter()
        .find(|family| family.as_str() == source_family.as_str())
    else {
        return;
    };

    let properties = font.properties();
    let full_name = font.full_name();
    let postscript_name = font.postscript_name();
    let font_style = match properties.style {
        Style::Normal => "normal",
        Style::Italic => "italic",
        Style::Oblique => "oblique",
    }
    .to_string();
    let font_weight = properties.weight.0.round().clamp(1.0, 1000.0) as u16;
    let font_weight_range =
        font_weight_range_for_source(path, &full_name, postscript_name.as_deref());
    let path_string = path.to_string_lossy().to_string();
    let key = format!(
        "{}:{}:{}:{}:{:?}:{}",
        requested_family, path_string, font_index, font_weight, font_weight_range, font_style
    );

    if !seen_sources.insert(key) {
        return;
    }

    sources.push(SystemFontSource {
        family: requested_family.to_string(),
        source_family,
        full_name,
        postscript_name,
        path: path_string,
        font_index,
        format: font_format_for_path(path),
        font_weight,
        font_weight_range,
        font_style,
    });
}

#[cfg(desktop)]
fn font_weight_range_for_source(
    path: &Path,
    full_name: &str,
    postscript_name: Option<&str>,
) -> Option<String> {
    let path_text = path.to_string_lossy().to_ascii_lowercase();
    let full_name = full_name.to_ascii_lowercase();
    let postscript_name = postscript_name.unwrap_or_default().to_ascii_lowercase();

    let has_weight_axis = (path_text.contains("variablefont") && path_text.contains("wght"))
        || path_text.contains("[wght]")
        || full_name.contains("variable")
        || postscript_name.contains("variable");

    if has_weight_axis {
        Some("100 900".to_string())
    } else {
        None
    }
}

#[cfg(desktop)]
fn default_system_font_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from("/System/Library/Fonts"));
        directories.push(PathBuf::from("/Library/Fonts"));
        directories.push(PathBuf::from("/Network/Library/Fonts"));
        if let Some(home_dir) = dirs::home_dir() {
            directories.push(home_dir.join("Library").join("Fonts"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(windir) = std::env::var_os("WINDIR") {
            directories.push(PathBuf::from(windir).join("Fonts"));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        directories.push(PathBuf::from("/usr/share/fonts"));
        directories.push(PathBuf::from("/usr/local/share/fonts"));
        directories.push(PathBuf::from("/run/host/fonts"));
        directories.push(PathBuf::from("/run/host/local-fonts"));
        directories.push(PathBuf::from("/run/host/user-fonts"));
        if let Some(home_dir) = dirs::home_dir() {
            directories.push(home_dir.join(".fonts"));
            directories.push(home_dir.join(".local").join("share").join("fonts"));
        }
        if let Some(data_dir) = dirs::data_dir() {
            directories.push(data_dir.join("fonts"));
        }
    }

    directories.sort();
    directories.dedup();
    directories
}

#[cfg(desktop)]
fn is_supported_font_path(path: &Path) -> bool {
    let Some(extension) = path.extension() else {
        return false;
    };
    matches!(
        extension.to_string_lossy().to_ascii_lowercase().as_str(),
        "ttf" | "ttc" | "otf" | "otc" | "woff" | "woff2"
    )
}

#[cfg(any(desktop, target_os = "android"))]
fn font_format_for_path(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match extension.as_str() {
        "ttf" | "ttc" => Some("truetype".to_string()),
        "otf" | "otc" => Some("opentype".to_string()),
        "woff" => Some("woff".to_string()),
        "woff2" => Some("woff2".to_string()),
        _ => None,
    }
}

/// Ouvre l'explorateur de fichiers en sélectionnant le fichier donné.
#[tauri::command]
pub fn open_explorer_with_file_selected(file_path: String) -> Result<(), String> {
    let path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = path.to_string_lossy().to_string();
    if !path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    // Branchements OS pour ouvrir le gestionnaire de fichiers natif.
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        cmd.args(["/select,", &file_path_str]);
        configure_command_no_window(&mut cmd);
        return cmd
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to execute explorer command: {}", e));
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open").args(["-R", &file_path_str]).output();
        return match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else if let Some(parent) = path.parent() {
                    let fallback_output = Command::new("open").arg(parent).output();
                    match fallback_output {
                        Ok(fallback_result) if fallback_result.status.success() => Ok(()),
                        Ok(_) => Err("Failed to open Finder".to_string()),
                        Err(e) => Err(format!("Failed to execute open command: {}", e)),
                    }
                } else {
                    Err("Failed to open Finder and no parent directory found".to_string())
                }
            }
            Err(e) => Err(format!("Failed to execute open command: {}", e)),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let file_managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja"];
        let parent_dir = path.parent().ok_or("No parent directory found")?;

        for manager in &file_managers {
            if Command::new(manager)
                .arg(parent_dir)
                .output()
                .map(|result| result.status.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }

        let output = Command::new("xdg-open").arg(parent_dir).output();
        return match output {
            Ok(result) if result.status.success() => Ok(()),
            Ok(_) => Err("Failed to open file manager".to_string()),
            Err(e) => Err(format!("Failed to execute xdg-open command: {}", e)),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported operating system".to_string())
    }
}

/// Ouvre un dossier dans le gestionnaire de fichiers natif.
#[tauri::command]
pub fn open_directory(directory_path: String) -> Result<(), String> {
    let path = path_utils::normalize_existing_path(&directory_path);
    let path_str = path.to_string_lossy().to_string();
    if !path.exists() {
        return Err(format!("Directory not found: {}", path_str));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", path_str));
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        cmd.arg(&path_str);
        configure_command_no_window(&mut cmd);
        return cmd
            .output()
            .map(|_| ())
            .map_err(|e| format!("Failed to execute explorer command: {}", e));
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open").arg(&path_str).output();
        return match output {
            Ok(result) if result.status.success() => Ok(()),
            Ok(_) => Err("Failed to open Finder".to_string()),
            Err(e) => Err(format!("Failed to execute open command: {}", e)),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let file_managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja"];

        for manager in &file_managers {
            if Command::new(manager)
                .arg(&path)
                .output()
                .map(|result| result.status.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }

        let output = Command::new("xdg-open").arg(&path).output();
        return match output {
            Ok(result) if result.status.success() => Ok(()),
            Ok(_) => Err("Failed to open directory".to_string()),
            Err(e) => Err(format!("Failed to execute xdg-open command: {}", e)),
        };
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported operating system".to_string())
    }
}

/// Retourne les dimensions vidéo (width/height) du premier stream vidéo.
#[tauri::command]
pub fn get_video_dimensions(file_path: &str) -> Result<serde_json::Value, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    #[cfg(target_os = "android")]
    match super::android_media::get_video_dimensions(&file_path) {
        Ok((width, height)) => {
            return Ok(serde_json::json!({ "width": width, "height": height }));
        }
        Err(error) => println!(
            "[android-media] video dimension probe failed for {}: {}. Falling back to ffprobe.",
            file_path_str, error
        ),
    }

    let ffprobe_path =
        binaries::resolve_binary_detailed("ffprobe").map_err(map_ffprobe_resolve_error)?;
    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "v:0",
        &file_path_str,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                let json_value: serde_json::Value = serde_json::from_str(&output_str)
                    .map_err(|e| format!("Failed to parse ffprobe JSON output: {}", e))?;
                if let Some(stream) = json_value.get("streams").and_then(|s| s.get(0)) {
                    let width = stream.get("width").and_then(|w| w.as_i64()).unwrap_or(0);
                    let height = stream.get("height").and_then(|h| h.as_i64()).unwrap_or(0);
                    Ok(serde_json::json!({ "width": width, "height": height }))
                } else {
                    Err("No video stream found in file".to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format_ffprobe_exec_failed(&stderr))
            }
        }
        Err(e) => Err(format_ffprobe_exec_failed(&format!(
            "Unable to execute ffprobe: {}",
            e
        ))),
    }
}

/// Detects whether the primary media stream uses a near-constant bitrate.
///
/// For video containers, this checks audio stream `a:0` first (subtitle sync issue is audio-driven),
/// then falls back to video stream `v:0` if no audio packets are available.
#[tauri::command]
pub fn is_constant_bitrate(file_path: String) -> Result<bool, String> {
    let file_path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    #[cfg(target_os = "android")]
    let skip_ffprobe_on_android = true;
    #[cfg(not(target_os = "android"))]
    let skip_ffprobe_on_android = false;
    if skip_ffprobe_on_android {
        println!(
            "[android-media] Skipping ffprobe CBR probe on Android for {}.",
            file_path_str
        );
        return Ok(true);
    }

    let ffprobe_path =
        binaries::resolve_binary_detailed("ffprobe").map_err(map_ffprobe_resolve_error)?;

    fn probe_stream_variation(
        ffprobe_path: &str,
        file_path_str: &str,
        stream_selector: &str,
    ) -> Result<Option<f64>, String> {
        let mut cmd = Command::new(ffprobe_path);
        cmd.args([
            "-v",
            "error",
            "-select_streams",
            stream_selector,
            "-show_entries",
            "packet=size,duration_time",
            "-of",
            "csv=p=0",
            file_path_str,
        ]);
        configure_command_no_window(&mut cmd);

        let output = cmd.output().map_err(|e| {
            format_ffprobe_exec_failed(&format!("Unable to execute ffprobe: {}", e))
        })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format_ffprobe_exec_failed(&stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut bitrates: Vec<f64> = Vec::new();

        for line in stdout.lines() {
            let mut parts = line.split(',');
            let size = parts.next().and_then(|v| v.trim().parse::<f64>().ok());
            let duration = parts.next().and_then(|v| v.trim().parse::<f64>().ok());
            let (Some(size_bytes), Some(duration_seconds)) = (size, duration) else {
                continue;
            };
            if duration_seconds <= 0.0 {
                continue;
            }
            let bitrate = (size_bytes * 8.0) / duration_seconds;
            if bitrate.is_finite() && bitrate > 0.0 {
                bitrates.push(bitrate);
            }
        }

        if bitrates.len() < 20 {
            return Ok(None);
        }

        let mean = bitrates.iter().sum::<f64>() / bitrates.len() as f64;
        if mean <= 0.0 {
            return Ok(None);
        }
        let variance = bitrates
            .iter()
            .map(|v| {
                let d = v - mean;
                d * d
            })
            .sum::<f64>()
            / bitrates.len() as f64;
        let stddev = variance.sqrt();
        Ok(Some(stddev / mean))
    }

    let variation = probe_stream_variation(&ffprobe_path, &file_path_str, "a:0")?.or(
        probe_stream_variation(&ffprobe_path, &file_path_str, "v:0")?,
    );

    // If we cannot reliably sample enough packets, avoid false warnings.
    let Some(relative_stddev) = variation else {
        return Ok(true);
    };

    // <= 5% relative stddev is considered "near CBR" for practical subtitle sync guidance.
    Ok(relative_stddev <= 0.05)
}

/// Coupe une portion audio sans ré-encodage (copie de flux).
#[tauri::command]
pub fn cut_audio(
    source_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<(), String> {
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;
    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-ss",
        &start_secs.to_string(),
        "-t",
        &duration_secs.to_string(),
        "-i",
        &source_path,
        "-c",
        "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&result.stderr)
        )),
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

/// Coupe une portion vidéo sans ré-encodage (copie de flux).
#[tauri::command]
pub fn cut_video(
    source_path: String,
    start_ms: u64,
    end_ms: u64,
    output_path: String,
) -> Result<(), String> {
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;
    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-ss",
        &start_secs.to_string(),
        "-t",
        &duration_secs.to_string(),
        "-i",
        &source_path,
        "-map",
        "0",
        "-c",
        "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&result.stderr)
        )),
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

/// Concatène plusieurs fichiers audio à l'aide du demuxer concat de ffmpeg.
#[tauri::command]
pub fn concat_audio(source_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if source_paths.is_empty() {
        return Err("No source files provided".to_string());
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let temp_dir = std::env::temp_dir();
    let list_file_path = temp_dir.join(format!(
        "concat_audio_{}.txt",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    ));

    let mut list_content = String::new();
    for path in &source_paths {
        let escaped_path = path.replace("'", "'\\''");
        list_content.push_str(&format!("file '{}'\n", escaped_path));
    }
    fs::write(&list_file_path, list_content)
        .map_err(|e| format!("Failed to write concat list: {}", e))?;

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        &list_file_path.to_string_lossy(),
        "-c",
        "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();
    let _ = fs::remove_file(&list_file_path);

    match output {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&result.stderr)
        )),
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

/// Emet la progression d'une conversion CBR vers le frontend.
///
/// @param app_handle Gestionnaire Tauri utilise pour publier l'evenement.
/// @param conversion_request_id Identifiant de correlation de la conversion.
/// @param progress Pourcentage de progression entre 0 et 100.
/// @param current_time_s Temps traite par ffmpeg en secondes.
/// @param total_time_s Duree totale estimee en secondes.
/// @param status Etat textuel de la conversion.
fn emit_cbr_conversion_progress(
    app_handle: &AppHandle,
    conversion_request_id: &str,
    progress: f64,
    current_time_s: f64,
    total_time_s: f64,
    status: &str,
) {
    let _ = app_handle.emit(
        "cbr-conversion-progress",
        serde_json::json!({
            "conversionRequestId": conversion_request_id,
            "progress": progress,
            "currentTime": current_time_s,
            "totalTime": total_time_s,
            "status": status
        }),
    );
}

/// Extrait le temps courant depuis la sortie `-progress` de ffmpeg.
///
/// @param line Ligne brute emise par ffmpeg.
/// @returns Le temps courant en secondes, ou `None` si la ligne ne contient pas de temps.
fn parse_ffmpeg_progress_time_s(line: &str) -> Option<f64> {
    if let Some(value) = line.strip_prefix("out_time_ms=") {
        return value.trim().parse::<f64>().ok().map(|ms| ms / 1_000_000.0);
    }
    if let Some(value) = line.strip_prefix("out_time_us=") {
        return value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    if let Some(value) = line.strip_prefix("out_time=") {
        let parts: Vec<&str> = value.trim().split(':').collect();
        if parts.len() != 3 {
            return None;
        }

        let hours = parts[0].parse::<f64>().ok()?;
        let minutes = parts[1].parse::<f64>().ok()?;
        let seconds = parts[2].parse::<f64>().ok()?;
        return Some(hours * 3600.0 + minutes * 60.0 + seconds);
    }
    None
}

/// Lance une conversion CBR asynchrone sans bloquer le thread principal.
///
/// @param file_path Chemin du fichier a convertir.
/// @param conversion_request_id Identifiant optionnel pour relayer la progression.
/// @param app_handle Gestionnaire Tauri utilise pour emettre les evenements.
/// @returns Resultat de la conversion.
#[tauri::command]
pub async fn convert_audio_to_cbr(
    file_path: String,
    conversion_request_id: Option<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_audio_to_cbr_blocking(file_path, conversion_request_id, app_handle)
    })
    .await
    .map_err(|e| format!("Unable to join CBR conversion task: {}", e))?
}

/// Execute la conversion CBR bloquante hors du thread principal.
///
/// @param file_path Chemin du fichier a convertir.
/// @param conversion_request_id Identifiant optionnel pour relayer la progression.
/// @param app_handle Gestionnaire Tauri utilise pour emettre les evenements.
/// @returns Resultat de la conversion.
fn convert_audio_to_cbr_blocking(
    file_path: String,
    conversion_request_id: Option<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let file_path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    #[cfg(not(target_os = "android"))]
    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4");
    let file_stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("temp");
    let temp_path = if let Some(parent_dir) = file_path.parent() {
        parent_dir.join(format!("{}_temp.{}", file_stem, extension))
    } else {
        PathBuf::from(format!("{}_temp.{}", file_stem, extension))
    };
    let conversion_request_id = conversion_request_id.unwrap_or_else(|| {
        format!(
            "cbr-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or(0)
        )
    });
    let total_duration_s = (get_duration(&file_path_str).unwrap_or(0).max(0) as f64) / 1000.0;
    emit_cbr_conversion_progress(
        &app_handle,
        &conversion_request_id,
        0.0,
        0.0,
        total_duration_s,
        "converting",
    );

    // Paramètres ffmpeg distincts pour flux audio pur vs conteneur vidéo.
    let is_audio_only = matches!(
        extension.to_lowercase().as_str(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a"
    );
    #[cfg(target_os = "android")]
    let video_codec = "libopenh264";
    #[cfg(not(target_os = "android"))]
    let video_codec = "libx264";
    let temp_path_str = temp_path.to_string_lossy().to_string();
    let ffmpeg_arguments = if is_audio_only {
        vec![
            "-nostdin",
            "-hide_banner",
            "-i",
            &file_path_str,
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-f",
            "mp3",
            "-progress",
            "pipe:1",
            "-y",
            &temp_path_str,
        ]
    } else {
        vec![
            "-nostdin",
            "-hide_banner",
            "-i",
            &file_path_str,
            "-b:v",
            "1200k",
            "-minrate",
            "1200k",
            "-maxrate",
            "1200k",
            "-bufsize",
            "1200k",
            "-b:a",
            "64k",
            "-vcodec",
            video_codec,
            "-acodec",
            "aac",
            "-strict",
            "-2",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-y",
            &temp_path_str,
        ]
    };

    #[cfg(target_os = "android")]
    let (conversion_succeeded, stderr) = {
        let arguments = ffmpeg_arguments
            .iter()
            .map(|argument| (*argument).to_string())
            .collect::<Vec<String>>();
        let output =
            super::android_media::execute_ffmpeg_with_progress(&arguments, |current_time_ms| {
                let current_time_s = current_time_ms / 1000.0;
                let progress = if total_duration_s > 0.0 {
                    (current_time_s / total_duration_s * 100.0).clamp(0.0, 99.5)
                } else {
                    0.0
                };
                emit_cbr_conversion_progress(
                    &app_handle,
                    &conversion_request_id,
                    progress,
                    current_time_s,
                    total_duration_s,
                    "converting",
                );
            })?;
        (output.success, output.output)
    };

    #[cfg(not(target_os = "android"))]
    let (conversion_succeeded, stderr) = {
        let mut cmd = Command::new(&ffmpeg_path);
        cmd.args(&ffmpeg_arguments);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        configure_command_no_window(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture ffmpeg progress".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture ffmpeg stderr".to_string())?;
        let stderr_handle = thread::spawn(move || {
            let reader = BufReader::new(stderr);
            reader
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<String>>()
                .join("\n")
        });

        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(current_time_s) = parse_ffmpeg_progress_time_s(&line) {
                let progress = if total_duration_s > 0.0 {
                    (current_time_s / total_duration_s * 100.0).clamp(0.0, 99.5)
                } else {
                    0.0
                };
                emit_cbr_conversion_progress(
                    &app_handle,
                    &conversion_request_id,
                    progress,
                    current_time_s,
                    total_duration_s,
                    "converting",
                );
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Unable to wait for ffmpeg: {}", e))?;
        (status.success(), stderr_handle.join().unwrap_or_default())
    };

    if conversion_succeeded {
        if let Err(e) = std::fs::remove_file(&file_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to remove original file: {}", e));
        }
        if let Err(e) = std::fs::rename(&temp_path, &file_path) {
            return Err(format!("Failed to replace original file: {}", e));
        }
        emit_cbr_conversion_progress(
            &app_handle,
            &conversion_request_id,
            100.0,
            total_duration_s,
            total_duration_s,
            "finished",
        );
        Ok(())
    } else {
        let _ = std::fs::remove_file(&temp_path);
        Err(format!("ffmpeg error: {}", stderr))
    }
}

/// Estime l'écart (en millisecondes) entre la durée du flux audio (basée sur
/// les timestamps de présentation) et la durée réelle du contenu audio décodé.
/// Un écart positif notable signale des timestamps "étirés" :
/// le lecteur avance plus vite que le son réel, ce qui désynchronise les
/// sous-titres générés par alignement (de plus en plus vers la fin du média).
///
/// Détection bon marché : aucune décode complète, on s'appuie sur l'index des
/// paquets (ffprobe `-count_packets`). Retourne 0 quand l'estimation n'est pas
/// fiable, afin d'éviter les faux positifs.
#[tauri::command]
pub fn audio_timestamp_stretch_ms(file_path: String) -> Result<i64, String> {
    let file_path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    #[cfg(target_os = "android")]
    let skip_ffprobe_on_android = true;
    #[cfg(not(target_os = "android"))]
    let skip_ffprobe_on_android = false;
    if skip_ffprobe_on_android {
        println!(
            "[android-media] Skipping ffprobe timestamp stretch probe on Android for {}.",
            file_path_str
        );
        return Ok(0);
    }

    let ffprobe_path =
        binaries::resolve_binary_detailed("ffprobe").map_err(map_ffprobe_resolve_error)?;

    // Caractéristiques du flux AUDIO : durée (PTS), codec, sample rate, nb paquets.
    // On compare la durée du flux audio — et non celle du conteneur, qui suit la
    // vidéo — à la durée réelle du contenu audio décodé. (Crucial pour les
    // conteneurs vidéo : la vidéo n'est pas re-timée, donc `format=duration`
    // resterait "étiré" même après correction de l'audio.)
    let mut stream_cmd = Command::new(&ffprobe_path);
    stream_cmd.args([
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-count_packets",
        "-show_entries",
        "stream=codec_name,profile,sample_rate,nb_read_packets,duration",
        "-of",
        "default=noprint_wrappers=1",
        &file_path_str,
    ]);
    configure_command_no_window(&mut stream_cmd);
    let stream_out = stream_cmd
        .output()
        .map_err(|e| format_ffprobe_exec_failed(&format!("Unable to execute ffprobe: {}", e)))?;
    if !stream_out.status.success() {
        return Err(format_ffprobe_exec_failed(&String::from_utf8_lossy(
            &stream_out.stderr,
        )));
    }

    let stdout = String::from_utf8_lossy(&stream_out.stdout);
    let mut codec_name = String::new();
    let mut profile = String::new();
    let mut sample_rate: f64 = 0.0;
    let mut packets: f64 = 0.0;
    let mut audio_duration_s: f64 = 0.0;
    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("codec_name=") {
            codec_name = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("profile=") {
            profile = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("sample_rate=") {
            sample_rate = v.trim().parse().unwrap_or(0.0);
        } else if let Some(v) = line.strip_prefix("nb_read_packets=") {
            packets = v.trim().parse().unwrap_or(0.0);
        } else if let Some(v) = line.strip_prefix("duration=") {
            audio_duration_s = v.trim().parse().unwrap_or(0.0);
        }
    }

    if sample_rate <= 0.0 || packets <= 0.0 || audio_duration_s <= 0.0 {
        // Estimation impossible : on s'abstient plutôt que de risquer un faux positif.
        return Ok(0);
    }

    // Échantillons par trame selon le codec (1024 par défaut, AAC-LC).
    let is_he_aac = profile.contains("HE");
    let samples_per_frame: f64 = match codec_name.as_str() {
        "aac" if is_he_aac => 2048.0,
        "aac" => 1024.0,
        "mp3" => 1152.0,
        "ac3" | "eac3" => 1536.0,
        "opus" => 960.0,
        _ => 1024.0,
    };

    let content_duration_s = packets * samples_per_frame / sample_rate;
    let stretch_s = audio_duration_s - content_duration_s;

    // Garde-fou : un écart > 25% de la durée trahit presque toujours une mauvaise
    // hypothèse de taille de trame (ex. variante de codec), pas un vrai étirement.
    if stretch_s.abs() > audio_duration_s * 0.25 {
        return Ok(0);
    }

    Ok((stretch_s * 1000.0).round() as i64)
}

/// Sonde le flux audio `a:0` pour décider de la stratégie de re-timing.
/// Retourne `(codec_name, profile, sample_rate, tb_num, tb_den, bit_rate)`.
/// En cas d'échec de ffprobe, retourne des valeurs nulles, ce qui force le
/// repli sûr (ré-encodage) côté appelant.
fn probe_audio_for_retime(file_path_str: &str) -> (String, String, u32, u32, u32, u32) {
    let empty = (String::new(), String::new(), 0u32, 0u32, 0u32, 0u32);
    let ffprobe_path = match binaries::resolve_binary("ffprobe") {
        Some(p) => p,
        None => return empty,
    };
    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,profile,sample_rate,time_base,bit_rate",
        "-of",
        "default=noprint_wrappers=1",
        file_path_str,
    ]);
    configure_command_no_window(&mut cmd);
    let out = match cmd.output() {
        Ok(o) if o.status.success() => o,
        _ => return empty,
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut codec = String::new();
    let mut profile = String::new();
    let mut sample_rate: u32 = 0;
    let mut tb_num: u32 = 0;
    let mut tb_den: u32 = 0;
    let mut bit_rate: u32 = 0;
    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("codec_name=") {
            codec = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("profile=") {
            profile = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("sample_rate=") {
            sample_rate = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("time_base=") {
            if let Some((n, d)) = v.trim().split_once('/') {
                tb_num = n.parse().unwrap_or(0);
                tb_den = d.parse().unwrap_or(0);
            }
        } else if let Some(v) = line.strip_prefix("bit_rate=") {
            bit_rate = v.trim().parse().unwrap_or(0);
        }
    }
    (codec, profile, sample_rate, tb_num, tb_den, bit_rate)
}

/// Régénère des timestamps audio contigus (PTS == temps réel du contenu) en
/// remuxant le fichier sur place. Le flux vidéo éventuel est toujours copié tel
/// quel (jamais de ré-encodage vidéo).
///
/// Deux stratégies :
/// - **Sans perte (préférée)** : pour l'AAC (taille de trame fixe) avec une base
///   de temps audio `1/sample_rate` — cas dominant (mp4/m4a) — on réécrit
///   uniquement les timestamps des paquets via le bitstream filter `setts`, en
///   COPIANT le flux (`-c copy`). Aucun ré-encodage : pas de perte, pas de
///   gonflement du débit, quasi instantané.
/// - **Repli (ré-encodage)** : sinon, on ré-encode l'audio avec `asetpts=N/SR/TB`
///   en PRÉSERVANT le débit source (pas de gonflement).
///
/// Volontairement distinct de `convert_audio_to_cbr` (qui ne touche pas aux
/// timestamps). Remplacement sur place (temp -> rename), comme `convert_audio_to_cbr`.
#[tauri::command]
pub fn normalize_audio_timestamps(file_path: String) -> Result<(), String> {
    let file_path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4");
    let file_stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("temp");
    let temp_path = if let Some(parent_dir) = file_path.parent() {
        parent_dir.join(format!("{}_retime_temp.{}", file_stem, extension))
    } else {
        PathBuf::from(format!("{}_retime_temp.{}", file_stem, extension))
    };
    let backup_path = if let Some(parent_dir) = file_path.parent() {
        parent_dir.join(format!("{}_retime_backup.{}", file_stem, extension))
    } else {
        PathBuf::from(format!("{}_retime_backup.{}", file_stem, extension))
    };

    let is_audio_only = matches!(
        extension.to_lowercase().as_str(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "opus" | "weba"
    );

    // Décision de stratégie d'après les caractéristiques du flux audio.
    let (codec_name, profile, sample_rate, tb_num, tb_den, source_bitrate) =
        probe_audio_for_retime(&file_path_str);

    // Sans perte uniquement si la taille de trame est fixe ET connue, et si la
    // base de temps audio est exactement 1/sample_rate (alors PTS_paquet = N*trame).
    let samples_per_frame: u32 = if profile.contains("HE") { 2048 } else { 1024 };
    // Sans perte réservé à l'AAC-LC (trame fixe de 1024) avec base de temps
    // 1/sample_rate. On exclut explicitement HE-AAC (SBR) : sa taille de trame
    // effective ne se déduit pas de façon fiable du nombre de paquets.
    let can_lossless = codec_name == "aac"
        && !profile.contains("HE")
        && sample_rate > 0
        && tb_num == 1
        && tb_den == sample_rate;

    let temp_str = temp_path.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["-i".into(), file_path_str.clone()];

    if can_lossless {
        // Réécriture des timestamps sans ré-encodage : on copie le(s) flux et on
        // applique `setts` sur l'audio (PTS/DTS = index_paquet * échantillons/trame).
        let setts = format!("setts=pts=N*{spf}:dts=N*{spf}", spf = samples_per_frame);
        if is_audio_only {
            args.extend(["-map", "0:a:0", "-c", "copy", "-bsf:a"].map(String::from));
            args.push(setts);
        } else {
            args.extend(
                ["-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-bsf:a"].map(String::from),
            );
            args.push(setts);
            args.extend(["-movflags", "+faststart"].map(String::from));
        }
    } else {
        // Repli : ré-encodage audio en PRÉSERVANT le débit source (pas de gonflement).
        // Débit source inconnu -> 128k par défaut (raisonnable pour de la voix).
        let bitrate = if source_bitrate > 0 {
            source_bitrate.to_string()
        } else {
            "128k".to_string()
        };
        if is_audio_only {
            // Pas de `-c:a` : ffmpeg choisit l'encodeur par défaut du conteneur de
            // sortie (mp3 -> mp3, m4a -> aac, etc.), ce qui évite tout codec invalide.
            args.extend(["-map", "0:a:0", "-af", "asetpts=N/SR/TB", "-b:a"].map(String::from));
            args.push(bitrate);
        } else {
            args.extend(
                [
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0",
                    "-c:v",
                    "copy",
                    "-af",
                    "asetpts=N/SR/TB",
                    "-c:a",
                    "aac",
                    "-b:a",
                ]
                .map(String::from),
            );
            args.push(bitrate);
            args.extend(["-movflags", "+faststart"].map(String::from));
        }
    }
    args.push("-y".into());
    args.push(temp_str);

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&args);
    configure_command_no_window(&mut cmd);

    match cmd.output() {
        Ok(result) => {
            if result.status.success() {
                // Échange sûr : déplacer l'original de côté (backup) AVANT de le
                // remplacer, afin de ne jamais laisser le fichier source manquant
                // (cette opération tourne automatiquement pendant la segmentation).
                let _ = std::fs::remove_file(&backup_path); // nettoie un résidu éventuel
                if let Err(e) = std::fs::rename(&file_path, &backup_path) {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(format!("Failed to back up original file: {}", e));
                }
                if let Err(e) = std::fs::rename(&temp_path, &file_path) {
                    // Restaure l'original depuis le backup.
                    let _ = std::fs::rename(&backup_path, &file_path);
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(format!("Failed to replace original file: {}", e));
                }
                let _ = std::fs::remove_file(&backup_path);
                Ok(())
            } else {
                let _ = std::fs::remove_file(&temp_path);
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(format!("Unable to execute ffmpeg: {}", e))
        }
    }
}

#[cfg(test)]
mod timeline_thumbnail_tests {
    use super::*;

    /// Vérifie que les timestamps envoyés à FFmpeg sont triés, uniques et bornés.
    #[test]
    fn normalizes_timeline_thumbnail_timestamps() {
        let timestamps = (0..40).rev().chain([5, 5, 7]).collect();
        let normalized = normalize_timeline_thumbnail_timestamps(timestamps);

        assert_eq!(normalized.len(), MAX_TIMELINE_THUMBNAILS_PER_REQUEST);
        assert_eq!(normalized[0], 0);
        assert_eq!(normalized[31], 31);
    }

    /// Vérifie qu'un remplacement de la vidéo invalide son dossier de miniatures.
    #[test]
    fn invalidates_timeline_thumbnail_cache_when_source_changes() {
        let test_root = std::env::temp_dir().join(format!(
            "qurancaption-thumbnail-cache-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&test_root).unwrap();
        let source_path = test_root.join("source.mp4");
        fs::write(&source_path, b"first").unwrap();
        let first_cache = timeline_thumbnail_cache_dir(&test_root, &source_path, 160, 72).unwrap();

        fs::write(&source_path, b"a different source").unwrap();
        let second_cache = timeline_thumbnail_cache_dir(&test_root, &source_path, 160, 72).unwrap();

        assert_ne!(first_cache, second_cache);
        fs::remove_dir_all(test_root).unwrap();
    }

    /// Vérifie qu'un fichier vide ou absent n'est jamais accepté comme cache valide.
    #[test]
    fn rejects_empty_timeline_thumbnail_cache_files() {
        let path = std::env::temp_dir().join(format!(
            "qurancaption-empty-thumbnail-test-{}.jpg",
            std::process::id()
        ));
        fs::write(&path, []).unwrap();

        assert!(!is_cached_timeline_thumbnail(
            path.to_string_lossy().as_ref()
        ));
        fs::remove_file(path).unwrap();
    }

    /// Vérifie que seules les extractions d'une même vidéo partagent leur verrou.
    #[test]
    fn isolates_timeline_thumbnail_extraction_locks_by_source() {
        let first_path = Path::new("first-video.mp4");
        let second_path = Path::new("second-video.mp4");
        let first_lock = timeline_thumbnail_extraction_lock(first_path).unwrap();
        let repeated_first_lock = timeline_thumbnail_extraction_lock(first_path).unwrap();
        let second_lock = timeline_thumbnail_extraction_lock(second_path).unwrap();

        assert!(Arc::ptr_eq(&first_lock, &repeated_first_lock));
        assert!(!Arc::ptr_eq(&first_lock, &second_lock));
    }
}
