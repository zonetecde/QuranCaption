use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Returns a list of candidate paths where the given binary may be found.
///
/// This helper handles platform-specific path resolution logic, including
/// searching in locations relevant to macOS, Linux, and Windows, as well as
/// considering environment variables and build-time directories. This is
/// necessary because binary locations can vary depending on how the application
/// is packaged or run.
fn binary_candidates(bin: &str) -> Vec<PathBuf> {
    let mut paths = vec![Path::new("binaries").join(bin)];

    // Common "resources/binaries" layout used by Tauri on non-Windows targets
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
                paths.push(dir.join(format!("../lib/{}/binaries", env!("CARGO_PKG_NAME"))).join(bin));
                paths.push(dir.join(format!("../lib/{}/resources/binaries", env!("CARGO_PKG_NAME"))).join(bin));
                paths.push(dir.join("../resources/binaries").join(bin)); // AppImage layout
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(appdir) = std::env::var("APPDIR") {
            paths.push(Path::new(&appdir).join(format!("usr/lib/{}/binaries", env!("CARGO_PKG_NAME"))).join(bin));
            paths.push(Path::new(&appdir).join(format!("usr/lib/{}/resources/binaries", env!("CARGO_PKG_NAME"))).join(bin));
            paths.push(Path::new(&appdir).join("usr/resources/binaries").join(bin)); // AppImage when resources sit in usr/resources
        }

        paths.push(Path::new("/usr/lib").join(env!("CARGO_PKG_NAME")).join("binaries").join(bin));
        paths.push(Path::new("/usr/lib").join(env!("CARGO_PKG_NAME")).join("resources").join("binaries").join(bin));
        paths.push(Path::new("/usr/lib/resources/binaries").join(bin)); // Some distro layouts
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        paths.push(Path::new(&manifest_dir).join("binaries").join(bin));
        paths.push(Path::new(&manifest_dir).join("resources").join("binaries").join(bin));
    }

    paths
}

pub fn resolve_binary(name: &str) -> Option<String> {
    let bin = if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    for path in binary_candidates(&bin) {
        if path.exists() {
            let canonical = path.canonicalize().unwrap_or(path);
            return Some(canonical.to_string_lossy().to_string());
        }
    }

    let base = bin.strip_suffix(".exe").unwrap_or(&bin);
    for name in [bin.as_str(), base] {
        if Command::new(name).arg("-version").output().is_ok() {
            return Some(name.to_string());
        }
    }

    None
}
