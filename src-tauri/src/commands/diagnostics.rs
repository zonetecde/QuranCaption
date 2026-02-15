use std::process::Command;

use crate::binaries;
use crate::utils::process::configure_command_no_window;

const FFPROBE_NOT_FOUND_ERROR: &str = "FFPROBE_NOT_FOUND";
const FFPROBE_NOT_EXECUTABLE_ERROR: &str = "FFPROBE_NOT_EXECUTABLE";
const FFPROBE_EXEC_FAILED_ERROR_PREFIX: &str = "FFPROBE_EXEC_FAILED:";

/// Résultat de diagnostic d'un binaire multimédia.
#[derive(serde::Serialize)]
pub struct BinaryDiagnosticResult {
    /// Nom logique du binaire.
    pub name: String,
    /// Chemin résolu si disponible.
    pub resolved_path: Option<String>,
    /// Code d'erreur stable si échec.
    pub error_code: Option<String>,
    /// Détail d'erreur si échec.
    pub error_details: Option<String>,
    /// Historique des tentatives de résolution.
    pub attempts: Vec<binaries::BinaryResolutionAttempt>,
    /// Première ligne de version si exécutable.
    pub version_output: Option<String>,
}

/// Convertit une erreur de résolution ffprobe en message attendu côté frontend.
pub fn map_ffprobe_resolve_error(err: binaries::BinaryResolveError) -> String {
    match err.code.as_str() {
        "BINARY_NOT_FOUND" => FFPROBE_NOT_FOUND_ERROR.to_string(),
        "BINARY_NOT_EXECUTABLE" => format!("{}: {}", FFPROBE_NOT_EXECUTABLE_ERROR, err.details),
        "BINARY_EXEC_FAILED" => format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, err.details),
        _ => format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, err.details),
    }
}

/// Formate une erreur d'exécution ffprobe avec le préfixe contractuel IPC.
pub fn format_ffprobe_exec_failed(details: &str) -> String {
    format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, details.trim())
}

/// Extrait la première ligne de sortie de version d'un binaire.
fn get_binary_version_line(binary_path: &str) -> Option<String> {
    let mut cmd = Command::new(binary_path);
    cmd.arg("-version");
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

/// Commande IPC de diagnostic de résolution des binaires ffmpeg/ffprobe/yt-dlp.
#[tauri::command]
pub fn diagnose_media_binaries() -> Vec<BinaryDiagnosticResult> {
    ["ffmpeg", "ffprobe", "yt-dlp"]
        .iter()
        .map(|name| {
            let debug = binaries::resolve_binary_debug(name);
            let version_output = debug
                .resolved_path
                .as_deref()
                .and_then(get_binary_version_line);
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
