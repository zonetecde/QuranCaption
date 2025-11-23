use std::path::{Path, PathBuf};

fn binary_candidates(bin: &str) -> Vec<PathBuf> {
    let mut paths = vec![Path::new("binaries").join(bin)];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("binaries").join(bin));

            #[cfg(target_os = "macos")]
            {
                paths.push(dir.join("../Resources/binaries").join(bin));
            }

            #[cfg(target_os = "linux")]
            {
                paths.push(dir.join(format!("../lib/{}/binaries", env!("CARGO_PKG_NAME"))).join(bin));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(appdir) = std::env::var("APPDIR") {
            paths.push(Path::new(&appdir).join(format!("usr/lib/{}/binaries", env!("CARGO_PKG_NAME"))).join(bin));
        }

        paths.push(Path::new("/usr/lib").join(env!("CARGO_PKG_NAME")).join("binaries").join(bin));
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        paths.push(Path::new(&manifest_dir).join("binaries").join(bin));
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

    None
}
