use std::process::Command;

use crate::binaries;
use crate::utils::process::configure_command_no_window;

const FFPROBE_NOT_FOUND_ERROR: &str = "FFPROBE_NOT_FOUND";
const FFPROBE_NOT_EXECUTABLE_ERROR: &str = "FFPROBE_NOT_EXECUTABLE";
const FFPROBE_EXEC_FAILED_ERROR_PREFIX: &str = "FFPROBE_EXEC_FAILED:";

/// Resultat de diagnostic d'un binaire multimedia.
#[derive(serde::Serialize)]
pub struct BinaryDiagnosticResult {
    /// Nom logique du binaire.
    pub name: String,
    /// Chemin resolu si disponible.
    pub resolved_path: Option<String>,
    /// Code d'erreur stable si echec.
    pub error_code: Option<String>,
    /// Detail d'erreur si echec.
    pub error_details: Option<String>,
    /// Historique des tentatives de resolution.
    pub attempts: Vec<binaries::BinaryResolutionAttempt>,
    /// Premiere ligne de version si executable.
    pub version_output: Option<String>,
}

fn media_error_tokens(name: &str) -> (&'static str, &'static str, &'static str) {
    match name {
        "ffmpeg" => (
            "FFMPEG_NOT_FOUND",
            "FFMPEG_NOT_EXECUTABLE",
            "FFMPEG_EXEC_FAILED:",
        ),
        "yt-dlp" => (
            "YTDLP_NOT_FOUND",
            "YTDLP_NOT_EXECUTABLE",
            "YTDLP_EXEC_FAILED:",
        ),
        _ => (
            FFPROBE_NOT_FOUND_ERROR,
            FFPROBE_NOT_EXECUTABLE_ERROR,
            FFPROBE_EXEC_FAILED_ERROR_PREFIX,
        ),
    }
}

/// Convertit une erreur de resolution en message stable cote frontend.
pub fn map_media_binary_resolve_error(name: &str, err: binaries::BinaryResolveError) -> String {
    let (not_found, not_executable, exec_failed_prefix) = media_error_tokens(name);
    match err.code.as_str() {
        "BINARY_NOT_FOUND" => not_found.to_string(),
        "BINARY_NOT_EXECUTABLE" => format!("{not_executable}: {}", err.details),
        "BINARY_EXEC_FAILED" => format!("{exec_failed_prefix}{}", err.details),
        _ => format!("{exec_failed_prefix}{}", err.details),
    }
}

/// Convertit une erreur de resolution ffprobe en message attendu cote frontend.
pub fn map_ffprobe_resolve_error(err: binaries::BinaryResolveError) -> String {
    map_media_binary_resolve_error("ffprobe", err)
}

/// Formate une erreur d'execution ffprobe avec le prefixe contractuel IPC.
pub fn format_ffprobe_exec_failed(details: &str) -> String {
    format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, details.trim())
}

fn version_args_for(binary_name: &str) -> &'static [&'static str] {
    if binary_name == "yt-dlp" {
        &["--version"]
    } else {
        &["-version"]
    }
}

/// Extrait la premiere ligne de sortie de version d'un binaire.
fn get_binary_version_line(binary_name: &str, binary_path: &str) -> Option<String> {
    let mut cmd = Command::new(binary_path);
    cmd.args(version_args_for(binary_name));
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.lines().next().map(|line| line.trim().to_string())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let line = stderr.lines().next().unwrap_or("").trim().to_string();
            if line.is_empty() {
                None
            } else {
                Some(line)
            }
        }
        Err(_) => None,
    }
}

/// Commande IPC de diagnostic de resolution des binaires ffmpeg/ffprobe/yt-dlp.
#[tauri::command]
pub fn diagnose_media_binaries() -> Vec<BinaryDiagnosticResult> {
    ["ffmpeg", "ffprobe", "yt-dlp"]
        .iter()
        .map(|name| {
            let debug = binaries::resolve_binary_debug(name);
            let version_output = debug
                .resolved_path
                .as_deref()
                .and_then(|path| get_binary_version_line(name, path));
            BinaryDiagnosticResult {
                name: debug.name,
                resolved_path: debug.resolved_path,
                error_code: debug.error_code,
                error_details: debug.error_details,
                attempts: debug.attempts,
                version_output,
            }
        })
        .collect()
}
