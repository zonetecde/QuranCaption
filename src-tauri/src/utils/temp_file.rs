use std::fs;
use std::path::PathBuf;

/// Garde RAII qui supprime automatiquement un fichier temporaire à la sortie de scope.
pub struct TempFileGuard(pub PathBuf);

impl Drop for TempFileGuard {
    /// Tente de supprimer le fichier temporaire sans propager d'erreur.
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
