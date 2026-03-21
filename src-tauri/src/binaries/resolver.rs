use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use super::diagnostics::{BinaryResolutionAttempt, BinaryResolveDebugInfo, BinaryResolveError};

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Initialise le repertoire de ressources utilise pour resoudre les binaires embarques.
pub fn init_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Retourne la liste ordonnee des emplacements candidats pour un binaire donne.
fn binary_candidates(bin: &str) -> Vec<PathBuf> {
    let mut paths = vec![Path::new("binaries").join(bin)];
    paths.push(Path::new("resources").join("binaries").join(bin));

    if let Some(resource_dir) = RESOURCE_DIR.get() {
        paths.push(resource_dir.join("binaries").join(bin));
        paths.push(resource_dir.join("resources").join("binaries").join(bin));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("binaries").join(bin));
            paths.push(dir.join("resources").join("binaries").join(bin));

            #[cfg(target_os = "macos")]
            {
                paths.push(dir.join("../Resources/binaries").join(bin));
            }

            #[cfg(target_os = "linux")]
            {
                let package = env!("CARGO_PKG_NAME");
                paths.push(dir.join(format!("../lib/{package}/binaries")).join(bin));
                paths.push(
                    dir.join(format!("../lib/{package}/resources/binaries"))
                        .join(bin),
                );
                paths.push(dir.join("../resources/binaries").join(bin));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let package = env!("CARGO_PKG_NAME");
        if let Ok(appdir) = std::env::var("APPDIR") {
            paths.push(
                Path::new(&appdir)
                    .join(format!("usr/lib/{package}/binaries"))
                    .join(bin),
            );
            paths.push(
                Path::new(&appdir)
                    .join(format!("usr/lib/{package}/resources/binaries"))
                    .join(bin),
            );
            paths.push(Path::new(&appdir).join("usr/resources/binaries").join(bin));
        }

        paths.push(
            Path::new("/usr/lib")
                .join(package)
                .join("binaries")
                .join(bin),
        );
        paths.push(
            Path::new("/usr/lib")
                .join(package)
                .join("resources")
                .join("binaries")
                .join(bin),
        );
        paths.push(Path::new("/usr/lib/resources/binaries").join(bin));
        paths.push(Path::new("/usr/local/bin").join(bin));
        paths.push(Path::new("/usr/bin").join(bin));
        paths.push(Path::new("/bin").join(bin));
    }

    #[cfg(target_os = "macos")]
    {
        paths.push(Path::new("/opt/homebrew/bin").join(bin));
        paths.push(Path::new("/usr/local/bin").join(bin));
        paths.push(Path::new("/opt/local/bin").join(bin));
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        paths.push(Path::new(&manifest_dir).join("binaries").join(bin));
        paths.push(
            Path::new(&manifest_dir)
                .join("resources")
                .join("binaries")
                .join(bin),
        );
    }

    dedupe_paths(paths)
}

/// Supprime les chemins dupliques en conservant l'ordre.
fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

/// Retourne la premiere ligne non vide d'un texte.
fn first_non_empty_line(text: &str) -> String {
    text.lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .unwrap_or_else(|| text.trim().to_string())
}

/// Classe une erreur de lancement de process en resultat applicatif stable.
fn classify_spawn_error(error: &std::io::Error) -> (&'static str, String) {
    if error.kind() == ErrorKind::NotFound {
        return ("missing", "Binary not found".to_string());
    }

    if error.kind() == ErrorKind::PermissionDenied {
        return (
            "not_executable",
            "Permission denied while executing binary".to_string(),
        );
    }

    let msg = error.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("exec format error")
        || lower.contains("bad cpu type")
        || lower.contains("cannot execute")
    {
        return ("not_executable", msg);
    }

    ("exec_failed", msg)
}

/// Retourne les arguments de probe appropries pour un binaire donne.
fn probe_args_for(binary_name: &str) -> &'static [&'static str] {
    let normalized = binary_name
        .strip_suffix(".exe")
        .unwrap_or(binary_name)
        .to_ascii_lowercase();

    match normalized.as_str() {
        "yt-dlp" => &["--version"],
        _ => &["-version"],
    }
}

/// Verifie qu'un binaire peut etre execute et renvoie un diagnostic exploitable.
fn test_binary_version(binary: &str, binary_name: &str) -> Result<(), (String, String)> {
    let probe_args = probe_args_for(binary_name);
    match Command::new(binary).args(probe_args).output() {
        Ok(output) => {
            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let detail = first_non_empty_line(&stderr);
                let detail = if detail.is_empty() {
                    first_non_empty_line(&stdout)
                } else {
                    detail
                };
                Err((
                    "exec_failed".to_string(),
                    if detail.is_empty() {
                        "Binary returned non-zero exit status".to_string()
                    } else {
                        detail
                    },
                ))
            }
        }
        Err(error) => {
            let (outcome, detail) = classify_spawn_error(&error);
            Err((outcome.to_string(), detail))
        }
    }
}

/// Tente de resoudre un binaire et retourne le chemin retenu plus les tentatives.
fn resolve_binary_with_attempts(
    name: &str,
) -> Result<(String, Vec<BinaryResolutionAttempt>), BinaryResolveError> {
    let bin = if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    let mut attempts = Vec::new();

    for path in binary_candidates(&bin) {
        if path.exists() {
            let canonical = path.canonicalize().unwrap_or(path);
            let candidate = canonical.to_string_lossy().to_string();
            match test_binary_version(&candidate, name) {
                Ok(()) => {
                    attempts.push(BinaryResolutionAttempt {
                        candidate: candidate.clone(),
                        source: "bundled_or_known_path".to_string(),
                        outcome: "ok".to_string(),
                        detail: None,
                    });
                    return Ok((candidate, attempts));
                }
                Err((outcome, detail)) => {
                    attempts.push(BinaryResolutionAttempt {
                        candidate,
                        source: "bundled_or_known_path".to_string(),
                        outcome,
                        detail: Some(detail),
                    });
                }
            }
        } else {
            attempts.push(BinaryResolutionAttempt {
                candidate: path.to_string_lossy().to_string(),
                source: "bundled_or_known_path".to_string(),
                outcome: "missing".to_string(),
                detail: None,
            });
        }
    }

    let base = bin.strip_suffix(".exe").unwrap_or(&bin);
    for candidate in [bin.as_str(), base] {
        match test_binary_version(candidate, name) {
            Ok(()) => {
                attempts.push(BinaryResolutionAttempt {
                    candidate: candidate.to_string(),
                    source: "system_path".to_string(),
                    outcome: "ok".to_string(),
                    detail: None,
                });
                return Ok((candidate.to_string(), attempts));
            }
            Err((outcome, detail)) => {
                attempts.push(BinaryResolutionAttempt {
                    candidate: candidate.to_string(),
                    source: "system_path".to_string(),
                    outcome,
                    detail: Some(detail),
                });
            }
        }
    }

    let has_not_executable = attempts.iter().any(|a| a.outcome == "not_executable");
    let has_exec_failed = attempts.iter().any(|a| a.outcome == "exec_failed");
    let details = attempts
        .iter()
        .find_map(|a| a.detail.clone())
        .unwrap_or_else(|| format!("No usable binary found for {name}"));
    let code = if has_not_executable {
        "BINARY_NOT_EXECUTABLE"
    } else if has_exec_failed {
        "BINARY_EXEC_FAILED"
    } else {
        "BINARY_NOT_FOUND"
    };

    Err(BinaryResolveError {
        code: code.to_string(),
        details,
        attempts,
    })
}

/// Retourne le chemin du binaire ou une erreur structuree.
pub fn resolve_binary_detailed(name: &str) -> Result<String, BinaryResolveError> {
    resolve_binary_with_attempts(name).map(|(path, _)| path)
}

/// Retourne le chemin du binaire quand il est resolu, sinon `None`.
pub fn resolve_binary(name: &str) -> Option<String> {
    resolve_binary_detailed(name).ok()
}

/// Retourne un diagnostic complet de resolution d'un binaire.
pub fn resolve_binary_debug(name: &str) -> BinaryResolveDebugInfo {
    match resolve_binary_with_attempts(name) {
        Ok((path, attempts)) => BinaryResolveDebugInfo {
            name: name.to_string(),
            resolved_path: Some(path),
            error_code: None,
            error_details: None,
            attempts,
        },
        Err(err) => BinaryResolveDebugInfo {
            name: name.to_string(),
            resolved_path: None,
            error_code: Some(err.code),
            error_details: Some(err.details),
            attempts: err.attempts,
        },
    }
}
