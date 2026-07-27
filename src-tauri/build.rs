use std::{env, fs, path::Path};

/// Charge les credentials YouTube locaux lorsqu'ils ne viennent pas du CI.
fn load_youtube_credentials() {
    let path = Path::new("../.env");
    println!("cargo:rerun-if-changed={}", path.display());
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };

    for line in content.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if matches!(key, "YOUTUBE_CLIENT_ID" | "YOUTUBE_CLIENT_SECRET")
            && env::var_os(key).is_none()
            && !value.trim().is_empty()
        {
            println!("cargo:rustc-env={key}={}", value.trim());
        }
    }
}

fn main() {
    load_youtube_credentials();
    tauri_build::build()
}
