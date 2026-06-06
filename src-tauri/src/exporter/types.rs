use std::sync::Arc;
use std::sync::Mutex;

/// Contexte de progression pour un sous-processus FFmpeg.
///
/// Permet de translater le temps local d'une passe (pré-traitement, batch, etc.)
/// dans le temps global de l'export.
#[derive(Clone, Copy)]
pub struct FfmpegProgressContext {
    /// Décalage initial en secondes (temps déjà écoulé avant cette passe).
    pub base_time_s: f64,
    /// Durée totale de l'export en secondes (pour le calcul du pourcentage).
    pub total_time_s: f64,
    /// Durée locale de cette passe en secondes.
    pub local_duration_s: f64,
    /// Si vrai, n'emet pas `export-error` pour cette passe FFmpeg.
    pub suppress_error_event: bool,
    /// Taille du batch en cours, si cette passe rend un batch d'images.
    pub current_batch_size: Option<usize>,
}

/// Configuration du moniteur mémoire pour les batchs auto.
#[derive(Clone)]
pub struct MemoryMonitorConfig {
    /// Pourcentage maximum de RAM système avant de tuer FFmpeg.
    pub max_used_percent: f64,
    /// Indique si FFmpeg doit être tué quand la limite RAM est atteinte.
    pub kill_on_limit: bool,
    /// État partagé du moniteur (dépassement, pic).
    pub state: Option<Arc<Mutex<MemoryMonitorState>>>,
}

/// État courant du moniteur mémoire.
#[derive(Clone, Copy)]
pub struct MemoryMonitorState {
    /// Indique si la limite de RAM a été dépassée.
    pub exceeded: bool,
    /// Pic de consommation RAM atteint pendant la surveillance (en pourcentage).
    pub peak_percent: f64,
}

/// Erreur levée quand la RAM système dépasse la limite configurée.
#[derive(Debug)]
pub struct MemoryLimitExceededError {
    /// Pourcentage de RAM atteint au pic.
    pub peak_percent: f64,
    /// Pourcentage limite configuré.
    pub limit_percent: f64,
}

impl std::fmt::Display for MemoryLimitExceededError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "System RAM usage reached {:.1}% during ffmpeg export (limit {:.1}%).",
            self.peak_percent, self.limit_percent
        )
    }
}

impl std::error::Error for MemoryLimitExceededError {}

/// Mode de gestion de la taille des batchs du filtre complexe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FiltergraphBatchMode {
    /// Taille automatique ajustée selon la RAM.
    Auto,
    /// Taille fixe définie par l'utilisateur.
    Fixed,
}

/// Profil de performance pour l'export vidéo.
#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ExportPerformanceProfile {
    /// Priorité à la vitesse, pas de limite de threads.
    Fastest,
    /// Équilibre entre vitesse et consommation CPU.
    Balanced,
    /// Priorité basse consommation CPU.
    LowCpu,
}

/// Contexte d'utilisation d'un codec vidéo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodecUsage {
    /// Codec pour une passe intermédiaire (pré-traitement).
    Intermediate,
    /// Codec pour la passe finale de l'export.
    Final,
}

/// Entrée vidéo de fond pour l'export.
#[derive(serde::Deserialize, Debug)]
pub struct VideoInput {
    /// Chemin vers le fichier vidéo.
    pub path: String,
    /// Si vrai, la vidéo boucle jusqu'à la fin de l'audio.
    pub loop_until_audio_end: Option<bool>,
}

/// Vidéo de fond prétraitée, prête pour l'overlay final.
#[derive(Debug, Clone)]
pub struct PreparedBackgroundVideo {
    /// Chemin vers le fichier vidéo (cache ou source directe).
    pub path: String,
    /// Vrai si la vidéo a déjà la bonne résolution, le bon FPS et le bon SAR.
    pub is_normalized: bool,
    /// Durée connue en secondes (évite un ffprobe redondant).
    pub duration_s: f64,
}
