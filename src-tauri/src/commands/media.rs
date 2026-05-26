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
            args.extend(["-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-bsf:a"].map(String::from));
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
                    "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-af", "asetpts=N/SR/TB",
                    "-c:a", "aac", "-b:a",
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
