use crate::binaries;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use super::constants;

// ---------------------------------------------------------------------------
// Résolution des binaires FFmpeg / FFprobe
// ---------------------------------------------------------------------------

/// Résout le chemin vers l'exécutable FFmpeg.
///
/// Cherche d'abord dans les binaires embarqués (`binaries::resolve_binary`),
/// puis tente le PATH système.
pub fn resolve_ffmpeg_binary() -> Option<String> {
    if let Some(path) = binaries::resolve_binary("ffmpeg") {
        return Some(path);
    }

    // En dernier recours, utiliser ffmpeg du PATH système
    println!("[ffmpeg] Tentative d'utilisation de ffmpeg du système (PATH)");
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-version");
    configure_command_no_window(&mut cmd);
    if cmd.output().is_ok() {
        println!("[ffmpeg] ✓ FFmpeg trouvé dans le PATH système");
        return Some("ffmpeg".to_string());
    }

    None
}

/// Résout le chemin vers l'exécutable FFprobe.
///
/// Cherche d'abord dans les binaires embarqués, puis tente le PATH système.
pub fn resolve_ffprobe_binary() -> String {
    if let Some(path) = binaries::resolve_binary("ffprobe") {
        return path;
    }

    println!("[ffprobe] Tentative d'utilisation de ffprobe du système (PATH)");
    let mut cmd = std::process::Command::new("ffprobe");
    cmd.arg("-version");
    configure_command_no_window(&mut cmd);
    if cmd.output().is_ok() {
        println!("[ffprobe] ✓ FFprobe trouvé dans le PATH système");
        return "ffprobe".to_string();
    }

    "ffprobe".to_string()
}

// ---------------------------------------------------------------------------
// Outils de chemin temporaire
// ---------------------------------------------------------------------------

/// Construit un chemin temporaire dans le même dossier que la destination finale.
///
/// Le fichier conserve la même extension pour laisser FFmpeg choisir le bon conteneur.
/// Le nom inclut un hash du chemin destination, le PID et un nonce pour éviter les collisions.
pub fn build_temp_output_path(dst: &Path) -> PathBuf {
    let ext = dst.extension().and_then(|s| s.to_str()).unwrap_or("mp4");
    let dst_hash = format!("{:x}", md5::compute(dst.to_string_lossy().as_bytes()));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let filename = format!(
        "qc-tmp-{}-{}-{}.{}",
        &dst_hash[..8],
        std::process::id(),
        nonce,
        ext
    );
    dst.with_file_name(filename)
}

/// Remplace la destination finale par le fichier temporaire généré (rename atomique).
pub fn replace_preproc_file(tmp: &Path, dst: &Path) -> std::io::Result<()> {
    if dst.exists() {
        fs::remove_file(dst).ok();
    }
    fs::rename(tmp, dst)
}

// ---------------------------------------------------------------------------
// Validation de vidéo en cache
// ---------------------------------------------------------------------------

/// Vérifie qu'une vidéo de cache est lisible et respecte une durée minimale attendue.
///
/// Contrôle la taille du fichier (> 2 Ko), interroge sa durée via ffprobe,
/// et tolère un écart de 150 ms.
pub fn is_cached_video_valid(path: &Path, min_duration_s: f64) -> bool {
    let metadata = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return false,
    };

    if metadata.len() < 2048 {
        return false;
    }

    let path_str = path.to_string_lossy();
    let duration = ffprobe_duration_sec(path_str.as_ref());
    if !duration.is_finite() || duration <= 0.0 {
        return false;
    }

    let tolerance_s = 0.15;
    duration + tolerance_s >= min_duration_s.max(0.0)
}

// ---------------------------------------------------------------------------
// Détection de type de fichier
// ---------------------------------------------------------------------------

/// Détermine si un chemin correspond à un fichier image (basé sur l'extension).
pub fn is_image_file(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    path_lower.ends_with(".jpg")
        || path_lower.ends_with(".jpeg")
        || path_lower.ends_with(".png")
        || path_lower.ends_with(".bmp")
        || path_lower.ends_with(".gif")
        || path_lower.ends_with(".webp")
        || path_lower.ends_with(".tiff")
        || path_lower.ends_with(".tif")
}

// ---------------------------------------------------------------------------
// FFprobe : durée
// ---------------------------------------------------------------------------

/// Obtient la durée d'un fichier média via `ffprobe`, avec cache basé sur la
/// signature du fichier (taille + date de modification).
pub fn ffprobe_duration_sec(path: &str) -> f64 {
    // Construction de la signature de cache : (taille, timestamp modification)
    let cache_signature = fs::metadata(path).ok().map(|metadata| {
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        (metadata.len(), modified)
    });

    // Vérification du cache
    if let Some((len, modified)) = cache_signature {
        if let Ok(cache) = constants::FFPROBE_DURATION_CACHE.lock() {
            if let Some((cached_len, cached_modified, duration)) = cache.get(path) {
                if *cached_len == len && *cached_modified == modified {
                    return *duration;
                }
            }
        }
    }

    let exe = resolve_ffprobe_binary();

    let mut cmd = Command::new(&exe);
    cmd.args(&[
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        path,
    ]);

    configure_command_no_window(&mut cmd);

    let output = match cmd.output() {
        Ok(output) => output,
        Err(_) => return 0.0,
    };

    let txt = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let duration = txt.parse::<f64>().unwrap_or(0.0);

    // Mise en cache uniquement si la durée est valide
    if duration.is_finite() && duration > 0.0 {
        if let Some((len, modified)) = cache_signature {
            if let Ok(mut cache) = constants::FFPROBE_DURATION_CACHE.lock() {
                cache.insert(path.to_string(), (len, modified, duration));
            }
        }
    }

    duration
}

/// Vérifie si un fichier vidéo contient une piste audio via `ffprobe`.
pub fn video_has_audio(path: &str) -> bool {
    let exe = resolve_ffprobe_binary();

    let mut cmd = Command::new(&exe);
    cmd.args(&[
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        path,
    ]);
    configure_command_no_window(&mut cmd);

    let output = cmd.output();

    match output {
        Ok(out) => !out.stdout.is_empty(),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Helper Windows (utilisé localement)
// ---------------------------------------------------------------------------

/// Configure une `Command` pour ne pas afficher de fenêtre console sur Windows.
pub fn configure_command_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}
