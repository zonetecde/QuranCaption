use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use font_kit::file_type::FileType;
use font_kit::font::Font;
use font_kit::handle::Handle;
use font_kit::properties::Style;
use font_kit::source::SystemSource;
use serde::Serialize;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;

use super::diagnostics::{format_ffprobe_exec_failed, map_ffprobe_resolve_error};

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

/// Retourne la durée d'un média en millisecondes via ffprobe.
#[tauri::command]
pub fn get_duration(file_path: &str) -> Result<i64, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    if !file_path.exists() {
        return Ok(-1);
    }

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

/// Retourne la liste des polices système disponibles (noms de familles uniques).
#[tauri::command]
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

/// Resolves selected system font families to concrete font files.
///
/// The preview renderer can use `font-family: Some Installed Font` directly, but the export
/// screenshotter needs URL-backed @font-face rules so it can embed the font in the cloned SVG.
#[tauri::command]
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

fn is_supported_font_path(path: &Path) -> bool {
    let Some(extension) = path.extension() else {
        return false;
    };
    matches!(
        extension.to_string_lossy().to_ascii_lowercase().as_str(),
        "ttf" | "ttc" | "otf" | "otc" | "woff" | "woff2"
    )
}

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

/// Convertit un média en débit constant (CBR) en remplaçant le fichier original.
#[tauri::command]
pub fn convert_audio_to_cbr(file_path: String) -> Result<(), String> {
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
        parent_dir.join(format!("{}_temp.{}", file_stem, extension))
    } else {
        PathBuf::from(format!("{}_temp.{}", file_stem, extension))
    };

    // Paramètres ffmpeg distincts pour flux audio pur vs conteneur vidéo.
    let mut cmd = Command::new(&ffmpeg_path);
    let is_audio_only = matches!(
        extension.to_lowercase().as_str(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a"
    );
    if is_audio_only {
        cmd.args([
            "-i",
            &file_path_str,
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-cbr",
            "1",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-f",
            "mp3",
            "-y",
            temp_path.to_string_lossy().as_ref(),
        ]);
    } else {
        cmd.args([
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
            "libx264",
            "-acodec",
            "aac",
            "-strict",
            "-2",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-s",
            "320x240",
            "-y",
            temp_path.to_string_lossy().as_ref(),
        ]);
    }
    configure_command_no_window(&mut cmd);

    match cmd.output() {
        Ok(result) => {
            if result.status.success() {
                if let Err(e) = std::fs::remove_file(&file_path) {
                    return Err(format!("Failed to remove original file: {}", e));
                }
                if let Err(e) = std::fs::rename(&temp_path, &file_path) {
                    return Err(format!("Failed to replace original file: {}", e));
                }
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
