use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};

// ---------------------------------------------------------------------------
// Durée du dernier export terminé (en secondes)
// ---------------------------------------------------------------------------

/// Stocke la durée (en secondes) du dernier export terminé avec succès.
/// Utilisé pour afficher le temps d'export dans l'interface.
pub static LAST_EXPORT_TIME_S: Mutex<Option<f64>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Exports actifs et annulation
// ---------------------------------------------------------------------------

/// Contient les processus FFmpeg actifs, indexés par `export_id`.
/// Permet d'annuler un export en cours en tuant le processus associé.
pub static ACTIVE_EXPORTS: LazyLock<
    Mutex<HashMap<String, Arc<Mutex<Option<std::process::Child>>>>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ensemble des `export_id` dont l'annulation a été demandée.
/// Les fonctions d'export vérifient cet ensemble régulièrement pour s'arrêter proprement.
pub static CANCELLED_EXPORTS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

// ---------------------------------------------------------------------------
// Caches de codecs matériels
// ---------------------------------------------------------------------------

/// Cache des encodeurs hardware détectés par `ffmpeg -encoders`.
/// Évite de relancer la détection à chaque export.
pub static HW_ENCODER_CACHE: LazyLock<Mutex<HashMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Cache de disponibilité NVENC (test réel par encodage d'une frame noire).
/// Évite de relancer le test à chaque export.
pub static NVENC_AVAILABILITY_CACHE: LazyLock<Mutex<HashMap<String, bool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Cache de durée ffprobe
// ---------------------------------------------------------------------------

/// Cache des durées obtenues par ffprobe, indexé par chemin de fichier.
/// Stocke `(taille_fichier, timestamp_modification, durée_secondes)` pour
/// invalider le cache si le fichier a changé.
pub static FFPROBE_DURATION_CACHE: LazyLock<Mutex<HashMap<String, (u64, u128, f64)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Constantes de batch et mémoire
// ---------------------------------------------------------------------------

/// Taille initiale du batch auto en haute resolution.
pub const MAX_FILTERGRAPH_IMAGES_HIGH_RES: usize = 32;

/// Taille initiale du batch auto en resolution standard.
pub const MAX_FILTERGRAPH_IMAGES_STANDARD: usize = 64;

/// Taille de batch par défaut (quand aucun mode auto n'est actif).
pub const DEFAULT_FILTERGRAPH_BATCH_SIZE: usize = 64;

/// Taille minimale d'un batch (empêche de descendre trop bas en mode auto).
pub const FILTERGRAPH_BATCH_MIN: usize = 2;

/// Taille maximale d'un batch.
pub const FILTERGRAPH_BATCH_MAX: usize = 1024;

/// Seuil de RAM à partir duquel le moniteur tue FFmpeg.
pub const AUTO_MEMORY_LIMIT_PERCENT: f64 = 90.0;

/// Seuil en dessous duquel on augmente la taille du batch suivant.
pub const AUTO_MEMORY_GROW_BELOW_PERCENT: f64 = 72.0;

/// Seuil de RAM au-dessus duquel on réduit la taille du batch suivant (avant le kill).
pub const AUTO_MEMORY_SOFT_LIMIT_PERCENT: f64 = 86.0;

/// Intervalle de scrutation du moniteur mémoire (en millisecondes).
pub const MEMORY_MONITOR_INTERVAL_MS: u64 = 500;
