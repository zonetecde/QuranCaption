use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_TEMP_FILE_ID: AtomicU64 = AtomicU64::new(1);

/// Construit un chemin temporaire unique pour les traitements concurrents.
pub fn unique_temp_path(prefix: &str, extension: &str) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let nonce = NEXT_TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
    Ok(std::env::temp_dir().join(format!(
        "{}-{}-{}-{}.{}",
        prefix,
        std::process::id(),
        stamp,
        nonce,
        extension.trim_start_matches('.')
    )))
}

/// Garde RAII qui supprime automatiquement un fichier temporaire à la sortie de scope.
pub struct TempFileGuard(pub PathBuf);

impl Drop for TempFileGuard {
    /// Tente de supprimer le fichier temporaire sans propager d'erreur.
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::unique_temp_path;
    use std::collections::HashSet;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn concurrent_temp_paths_are_unique() {
        let workers = 32;
        let barrier = Arc::new(Barrier::new(workers));
        let handles = (0..workers)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    unique_temp_path("qurancaption-test", "wav").unwrap()
                })
            })
            .collect::<Vec<_>>();
        let paths = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<HashSet<_>>();

        assert_eq!(paths.len(), workers);
    }
}
