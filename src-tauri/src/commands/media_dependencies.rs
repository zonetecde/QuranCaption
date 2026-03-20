use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "linux")]
use tar::Archive;
use tauri::Emitter;
#[cfg(target_os = "linux")]
use xz2::read::XzDecoder;
use zip::ZipArchive;

use crate::binaries;

#[derive(Debug, serde::Deserialize)]
pub struct InstallMediaBinariesPayload {
    #[serde(alias = "includeYtDlp")]
    pub include_yt_dlp: Option<bool>,
    #[serde(alias = "onlyMissing")]
    pub only_missing: Option<bool>,
}

#[derive(Debug, serde::Serialize)]
pub struct MediaInstallFailure {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, serde::Serialize)]
pub struct InstallMediaBinariesResult {
    pub installed: Vec<String>,
    pub already_present: Vec<String>,
    pub failed: Vec<MediaInstallFailure>,
}

#[derive(Debug)]
struct TargetState {
    name: &'static str,
    pre_existing: bool,
    attempted_install: bool,
    failure_reason: Option<String>,
}

fn emit_status(app_handle: &tauri::AppHandle, step: &str, message: &str, progress: Option<f64>) {
    let payload = serde_json::json!({
        "step": step,
        "message": message,
        "progress": progress
    });
    let _ = app_handle.emit("media-deps-install-status", payload);
}

fn temp_file_path(prefix: &str, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{prefix}_{timestamp}.{extension}"))
}

fn binary_file_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::metadata(path).map_err(|e| {
        format!(
            "Failed to read metadata for '{}': {}",
            path.to_string_lossy(),
            e
        )
    })?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|e| {
        format!(
            "Failed to set executable permission on '{}': {}",
            path.to_string_lossy(),
            e
        )
    })
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn download_to_path(url: &str, destination: &Path) -> Result<(), String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download '{}': {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download '{}': HTTP {}",
            url,
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read downloaded bytes from '{}': {}", url, e))?;
    if bytes.is_empty() {
        return Err(format!("Downloaded file from '{}' is empty", url));
    }

    fs::write(destination, &bytes)
        .map_err(|e| format!("Failed to write '{}': {}", destination.to_string_lossy(), e))?;
    Ok(())
}

fn extract_binary_from_zip(
    zip_path: &Path,
    expected_name: &str,
    destination: &Path,
) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| {
        format!(
            "Failed to open archive '{}': {}",
            zip_path.to_string_lossy(),
            e
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|e| {
        format!(
            "Failed to parse zip '{}': {}",
            zip_path.to_string_lossy(),
            e
        )
    })?;

    let expected_lower = expected_name.to_ascii_lowercase();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read zip entry #{index}: {}", e))?;
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry.name().replace('\\', "/");
        let entry_file_name = Path::new(&entry_name)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if entry_file_name != expected_lower {
            continue;
        }

        let mut output_file = File::create(destination).map_err(|e| {
            format!(
                "Failed to create extracted file '{}': {}",
                destination.to_string_lossy(),
                e
            )
        })?;
        io::copy(&mut entry, &mut output_file).map_err(|e| {
            format!(
                "Failed to extract '{}' to '{}': {}",
                entry_name,
                destination.to_string_lossy(),
                e
            )
        })?;
        ensure_executable(destination)?;
        return Ok(());
    }

    Err(format!(
        "Archive '{}' does not contain '{}'",
        zip_path.to_string_lossy(),
        expected_name
    ))
}

#[cfg(target_os = "linux")]
fn extract_ffmpeg_and_ffprobe_from_tar_xz(
    archive_path: &Path,
    ffmpeg_destination: Option<&Path>,
    ffprobe_destination: Option<&Path>,
) -> Result<(), String> {
    let input = File::open(archive_path).map_err(|e| {
        format!(
            "Failed to open tar.xz archive '{}': {}",
            archive_path.to_string_lossy(),
            e
        )
    })?;
    let decoder = XzDecoder::new(input);
    let mut archive = Archive::new(decoder);

    let mut ffmpeg_written = ffmpeg_destination.is_none();
    let mut ffprobe_written = ffprobe_destination.is_none();

    for entry_result in archive.entries().map_err(|e| {
        format!(
            "Failed to read entries from '{}': {}",
            archive_path.to_string_lossy(),
            e
        )
    })? {
        let mut entry = entry_result.map_err(|e| format!("Failed to read archive entry: {}", e))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }

        let entry_path = entry
            .path()
            .map_err(|e| format!("Failed to read archive entry path: {}", e))?
            .to_path_buf();
        let name = entry_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default();

        if !ffmpeg_written && name == "ffmpeg" {
            let destination = ffmpeg_destination.expect("checked above");
            let mut output = File::create(destination).map_err(|e| {
                format!(
                    "Failed to create extracted file '{}': {}",
                    destination.to_string_lossy(),
                    e
                )
            })?;
            io::copy(&mut entry, &mut output).map_err(|e| {
                format!(
                    "Failed to extract ffmpeg to '{}': {}",
                    destination.to_string_lossy(),
                    e
                )
            })?;
            ensure_executable(destination)?;
            ffmpeg_written = true;
            continue;
        }

        if !ffprobe_written && name == "ffprobe" {
            let destination = ffprobe_destination.expect("checked above");
            let mut output = File::create(destination).map_err(|e| {
                format!(
                    "Failed to create extracted file '{}': {}",
                    destination.to_string_lossy(),
                    e
                )
            })?;
            io::copy(&mut entry, &mut output).map_err(|e| {
                format!(
                    "Failed to extract ffprobe to '{}': {}",
                    destination.to_string_lossy(),
                    e
                )
            })?;
            ensure_executable(destination)?;
            ffprobe_written = true;
        }
    }

    if !ffmpeg_written {
        return Err("Archive does not contain ffmpeg".to_string());
    }
    if !ffprobe_written {
        return Err("Archive does not contain ffprobe".to_string());
    }

    Ok(())
}

async fn install_ffmpeg_and_ffprobe(
    app_handle: &tauri::AppHandle,
    tools_bin_dir: &Path,
    write_ffmpeg: bool,
    write_ffprobe: bool,
) -> Result<(), String> {
    if !write_ffmpeg && !write_ffprobe {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        emit_status(
            app_handle,
            "download_ffmpeg",
            "Downloading FFmpeg package for Windows...",
            Some(25.0),
        );
        let archive_path = temp_file_path("qurancaption_ffmpeg_win", "zip");
        download_to_path(
            "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
            &archive_path,
        )
        .await?;

        emit_status(
            app_handle,
            "extract_ffmpeg",
            "Extracting FFmpeg binaries...",
            Some(45.0),
        );
        if write_ffmpeg {
            extract_binary_from_zip(
                &archive_path,
                "ffmpeg.exe",
                &tools_bin_dir.join(binary_file_name("ffmpeg")),
            )?;
        }
        if write_ffprobe {
            extract_binary_from_zip(
                &archive_path,
                "ffprobe.exe",
                &tools_bin_dir.join(binary_file_name("ffprobe")),
            )?;
        }
        let _ = fs::remove_file(&archive_path);
    }

    #[cfg(target_os = "linux")]
    {
        emit_status(
            app_handle,
            "download_ffmpeg",
            "Downloading FFmpeg package for Linux...",
            Some(25.0),
        );
        let archive_path = temp_file_path("qurancaption_ffmpeg_linux", "tar.xz");
        download_to_path(
            "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
            &archive_path,
        )
        .await?;

        emit_status(
            app_handle,
            "extract_ffmpeg",
            "Extracting FFmpeg binaries...",
            Some(45.0),
        );
        let ffmpeg_output_path = tools_bin_dir.join(binary_file_name("ffmpeg"));
        let ffprobe_output_path = tools_bin_dir.join(binary_file_name("ffprobe"));
        extract_ffmpeg_and_ffprobe_from_tar_xz(
            &archive_path,
            if write_ffmpeg {
                Some(ffmpeg_output_path.as_path())
            } else {
                None
            },
            if write_ffprobe {
                Some(ffprobe_output_path.as_path())
            } else {
                None
            },
        )?;
        let _ = fs::remove_file(&archive_path);
    }

    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        let ffmpeg_zip_url = "https://www.osxexperts.net/ffmpeg6arm.zip";
        #[cfg(target_arch = "aarch64")]
        let ffprobe_zip_url = "https://www.osxexperts.net/ffprobe6arm.zip";

        #[cfg(target_arch = "x86_64")]
        let ffmpeg_zip_url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
        #[cfg(target_arch = "x86_64")]
        let ffprobe_zip_url = "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip";

        if write_ffmpeg {
            emit_status(
                app_handle,
                "download_ffmpeg",
                "Downloading ffmpeg for macOS...",
                Some(25.0),
            );
            let ffmpeg_zip = temp_file_path("qurancaption_ffmpeg_macos", "zip");
            download_to_path(ffmpeg_zip_url, &ffmpeg_zip).await?;
            emit_status(
                app_handle,
                "extract_ffmpeg",
                "Extracting ffmpeg...",
                Some(45.0),
            );
            extract_binary_from_zip(
                &ffmpeg_zip,
                "ffmpeg",
                &tools_bin_dir.join(binary_file_name("ffmpeg")),
            )?;
            let _ = fs::remove_file(&ffmpeg_zip);
        }

        if write_ffprobe {
            emit_status(
                app_handle,
                "download_ffprobe",
                "Downloading ffprobe for macOS...",
                Some(55.0),
            );
            let ffprobe_zip = temp_file_path("qurancaption_ffprobe_macos", "zip");
            download_to_path(ffprobe_zip_url, &ffprobe_zip).await?;
            emit_status(
                app_handle,
                "extract_ffprobe",
                "Extracting ffprobe...",
                Some(70.0),
            );
            extract_binary_from_zip(
                &ffprobe_zip,
                "ffprobe",
                &tools_bin_dir.join(binary_file_name("ffprobe")),
            )?;
            let _ = fs::remove_file(&ffprobe_zip);
        }
    }

    Ok(())
}

async fn install_yt_dlp(
    app_handle: &tauri::AppHandle,
    tools_bin_dir: &Path,
    destination: &Path,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    #[cfg(target_os = "linux")]
    let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    #[cfg(target_os = "macos")]
    let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";

    emit_status(
        app_handle,
        "download_yt_dlp",
        "Downloading yt-dlp...",
        Some(80.0),
    );
    download_to_path(url, destination).await?;
    ensure_executable(destination)?;

    // Ensure process PATH includes local tools after writing file.
    binaries::prepend_to_process_path(tools_bin_dir);
    Ok(())
}

fn map_binary_error_prefix(name: &str, code: &str, details: &str) -> String {
    let prefix = match name {
        "ffmpeg" => "FFMPEG",
        "ffprobe" => "FFPROBE",
        "yt-dlp" => "YTDLP",
        _ => "BINARY",
    };

    match code {
        "BINARY_NOT_FOUND" => format!("{}_NOT_FOUND", prefix),
        "BINARY_NOT_EXECUTABLE" => format!("{}_NOT_EXECUTABLE: {}", prefix, details),
        "BINARY_EXEC_FAILED" => format!("{}_EXEC_FAILED: {}", prefix, details),
        _ => format!("{}_EXEC_FAILED: {}", prefix, details),
    }
}

#[tauri::command]
pub async fn install_media_binaries(
    app_handle: tauri::AppHandle,
    payload: Option<InstallMediaBinariesPayload>,
) -> Result<InstallMediaBinariesResult, String> {
    let include_yt_dlp = payload
        .as_ref()
        .and_then(|p| p.include_yt_dlp)
        .unwrap_or(true);
    let only_missing = payload
        .as_ref()
        .and_then(|p| p.only_missing)
        .unwrap_or(true);

    emit_status(
        &app_handle,
        "prepare",
        "Preparing media dependencies installation...",
        Some(5.0),
    );
    let tools_bin_dir = binaries::prepare_media_tools_path(&app_handle)?;

    let mut targets = vec![
        TargetState {
            name: "ffmpeg",
            pre_existing: binaries::resolve_binary("ffmpeg").is_some(),
            attempted_install: false,
            failure_reason: None,
        },
        TargetState {
            name: "ffprobe",
            pre_existing: binaries::resolve_binary("ffprobe").is_some(),
            attempted_install: false,
            failure_reason: None,
        },
    ];

    if include_yt_dlp {
        targets.push(TargetState {
            name: "yt-dlp",
            pre_existing: binaries::resolve_binary("yt-dlp").is_some(),
            attempted_install: false,
            failure_reason: None,
        });
    }

    let ffmpeg_needs_install = targets
        .iter()
        .find(|target| target.name == "ffmpeg")
        .map(|target| !only_missing || !target.pre_existing)
        .unwrap_or(false);
    let ffprobe_needs_install = targets
        .iter()
        .find(|target| target.name == "ffprobe")
        .map(|target| !only_missing || !target.pre_existing)
        .unwrap_or(false);

    if ffmpeg_needs_install || ffprobe_needs_install {
        if let Some(target) = targets.iter_mut().find(|target| target.name == "ffmpeg") {
            target.attempted_install = ffmpeg_needs_install;
        }
        if let Some(target) = targets.iter_mut().find(|target| target.name == "ffprobe") {
            target.attempted_install = ffprobe_needs_install;
        }

        if let Err(error) = install_ffmpeg_and_ffprobe(
            &app_handle,
            &tools_bin_dir,
            ffmpeg_needs_install,
            ffprobe_needs_install,
        )
        .await
        {
            if ffmpeg_needs_install {
                if let Some(target) = targets.iter_mut().find(|target| target.name == "ffmpeg") {
                    target.failure_reason = Some(error.clone());
                }
            }
            if ffprobe_needs_install {
                if let Some(target) = targets.iter_mut().find(|target| target.name == "ffprobe") {
                    target.failure_reason = Some(error.clone());
                }
            }
        }
    }

    if include_yt_dlp {
        let yt_dlp_needs_install = targets
            .iter()
            .find(|target| target.name == "yt-dlp")
            .map(|target| !only_missing || !target.pre_existing)
            .unwrap_or(false);
        if yt_dlp_needs_install {
            if let Some(target) = targets.iter_mut().find(|target| target.name == "yt-dlp") {
                target.attempted_install = true;
            }
            let yt_dlp_path = tools_bin_dir.join(binary_file_name("yt-dlp"));
            if let Err(error) = install_yt_dlp(&app_handle, &tools_bin_dir, &yt_dlp_path).await {
                if let Some(target) = targets.iter_mut().find(|target| target.name == "yt-dlp") {
                    target.failure_reason = Some(error);
                }
            }
        }
    }

    emit_status(
        &app_handle,
        "verify",
        "Verifying installed media dependencies...",
        Some(95.0),
    );
    binaries::prepend_to_process_path(&tools_bin_dir);

    let mut installed = Vec::new();
    let mut already_present = Vec::new();
    let mut failed = Vec::new();

    for target in targets {
        match binaries::resolve_binary_detailed(target.name) {
            Ok(_) => {
                if target.attempted_install {
                    installed.push(target.name.to_string());
                } else {
                    already_present.push(target.name.to_string());
                }
            }
            Err(err) => {
                let reason = if let Some(reason) = target.failure_reason {
                    reason
                } else {
                    map_binary_error_prefix(target.name, &err.code, &err.details)
                };
                failed.push(MediaInstallFailure {
                    name: target.name.to_string(),
                    reason,
                });
            }
        }
    }

    emit_status(
        &app_handle,
        "done",
        "Media dependencies installation finished.",
        Some(100.0),
    );

    Ok(InstallMediaBinariesResult {
        installed,
        already_present,
        failed,
    })
}
