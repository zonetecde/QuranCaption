#[cfg(unix)]
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{path::BaseDirectory, Manager, Runtime};

#[derive(Clone, Debug)]
pub struct BinaryCommand {
    pub command: String,
    pub directory: Option<PathBuf>,
}

fn exe_name(base: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("{}.exe", base)
    }
    #[cfg(not(target_os = "windows"))]
    {
        base.to_string()
    }
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::metadata(path)?;
    let mut permissions = metadata.permissions();
    let mode = permissions.mode();

    if mode & 0o111 == 0 {
        permissions.set_mode(mode | 0o755);
        fs::set_permissions(path, permissions)?;
    }

    Ok(())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn resource_candidate<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    relative: &str,
) -> Option<PathBuf> {
    app_handle
        .path()
        .resolve(relative, BaseDirectory::Resource)
        .ok()
}

fn manifest_dir_candidate(file_name: &str) -> Option<PathBuf> {
    std::env::var("CARGO_MANIFEST_DIR")
        .ok()
        .map(PathBuf::from)
        .map(|p| p.join("binaries").join(file_name))
}

fn current_exe_candidate(file_name: &str) -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("binaries").join(file_name)))
}

fn workspace_candidate(file_name: &str) -> Vec<PathBuf> {
    vec![
        PathBuf::from("binaries").join(file_name),
        PathBuf::from("src-tauri").join("binaries").join(file_name),
    ]
}

fn command_available(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok()
}

pub fn resolve_binary<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    base: &str,
) -> Result<BinaryCommand, String> {
    let file_name = exe_name(base);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(resolved) = resource_candidate(app_handle, &format!("binaries/{}", file_name)) {
        candidates.push(resolved);
    }

    if let Some(from_manifest) = manifest_dir_candidate(&file_name) {
        candidates.push(from_manifest);
    }

    if let Some(from_exe) = current_exe_candidate(&file_name) {
        candidates.push(from_exe);
    }

    candidates.extend(workspace_candidate(&file_name));

    for candidate in candidates {
        if candidate.exists() {
            let canonical = candidate.canonicalize().unwrap_or(candidate.clone());
            if let Err(err) = ensure_executable(&canonical) {
                eprintln!("Failed to adjust permissions on {:?}: {}", canonical, err);
            }

            let parent = canonical.parent().map(|p| p.to_path_buf());
            return Ok(BinaryCommand {
                command: canonical.to_string_lossy().to_string(),
                directory: parent,
            });
        }
    }

    // Fallback to system PATH
    if command_available(base) {
        return Ok(BinaryCommand {
            command: base.to_string(),
            directory: None,
        });
    }

    Err(format!(
        "Unable to locate binary '{}' in bundled resources or system PATH",
        file_name
    ))
}

pub fn resolve_ffmpeg<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<BinaryCommand, String> {
    resolve_binary(app_handle, "ffmpeg")
}

pub fn resolve_ffprobe<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<BinaryCommand, String> {
    resolve_binary(app_handle, "ffprobe")
}

pub fn resolve_yt_dlp<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<BinaryCommand, String> {
    resolve_binary(app_handle, "yt-dlp")
}

#[allow(dead_code)]
pub fn resolve_binaries_dir<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<PathBuf> {
    resolve_ffmpeg(app_handle)
        .ok()
        .and_then(|bin| bin.directory)
}
