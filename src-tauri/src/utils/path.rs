use std::path::PathBuf;

/// Convertit un caractère hexadécimal ASCII en valeur binaire.
fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Décode les séquences `%xx` d'une chaîne de chemin URI.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h1), Some(h2)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h1 << 4) | h2);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&out).to_string()
}

/// Normalise un chemin brut provenant de l'UI ou d'un URI `file://`.
pub fn normalize_input_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    let mut path = trimmed;

    if let Some(rest) = trimmed.strip_prefix("file://") {
        path = rest;
    }

    if let Some(rest) = path.strip_prefix("localhost/") {
        path = rest;
    }

    #[cfg(target_os = "windows")]
    {
        let bytes = path.as_bytes();
        if bytes.len() > 2 && bytes[0] == b'/' && bytes[2] == b':' {
            path = &path[1..];
        }
    }

    PathBuf::from(percent_decode(path))
}

/// Normalise un chemin d'entrée et tente de le canonicaliser si possible.
pub fn normalize_existing_path(raw: &str) -> PathBuf {
    let path = normalize_input_path(raw);
    if path.as_os_str().is_empty() {
        return path;
    }
    path.canonicalize().unwrap_or(path)
}

/// Normalise un chemin de sortie en canonicalisant son parent si existant.
pub fn normalize_output_path(raw: &str) -> PathBuf {
    let path = normalize_input_path(raw);
    if let Some(parent) = path.parent() {
        if let Ok(parent_canon) = parent.canonicalize() {
            if let Some(name) = path.file_name() {
                return parent_canon.join(name);
            }
        }
    }
    path
}

/// Échappe un chemin pour un fichier ffconcat.
pub fn escape_ffconcat_path(path: &str) -> String {
    path.replace('\'', "\\'")
}
