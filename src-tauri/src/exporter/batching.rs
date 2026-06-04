use std::path::Path;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::codec;
use super::constants;
use super::memory;
use super::types::FiltergraphBatchMode;

// ---------------------------------------------------------------------------
// Normalisation des paramètres de batch
// ---------------------------------------------------------------------------

/// Normalise la taille de batch demandée dans l'intervalle [MIN, MAX].
pub fn normalize_filtergraph_batch_size(batch_size: Option<i32>) -> usize {
    let requested = batch_size.unwrap_or(constants::DEFAULT_FILTERGRAPH_BATCH_SIZE as i32);
    requested.clamp(
        constants::FILTERGRAPH_BATCH_MIN as i32,
        constants::FILTERGRAPH_BATCH_MAX as i32,
    ) as usize
}

/// Convertit le mode de batch (chaîne UI) en énuméré `FiltergraphBatchMode`.
pub fn normalize_filtergraph_batch_mode(batch_size_mode: Option<&str>) -> FiltergraphBatchMode {
    match batch_size_mode {
        Some("fixed") => FiltergraphBatchMode::Fixed,
        _ => FiltergraphBatchMode::Auto,
    }
}

// ---------------------------------------------------------------------------
// Limite de batch selon la résolution
// ---------------------------------------------------------------------------

/// Retourne la limite d'images par batch pour le rendu du filtre complexe.
///
/// Si `batch_size` est fourni (mode Fixed), il est utilisé directement.
/// Sinon, la limite dépend de la résolution (haute résolution → batch plus petit).
pub fn filtergraph_batch_limit(target_size: (i32, i32), batch_size: Option<i32>) -> usize {
    if let Some(batch_size) = batch_size {
        return normalize_filtergraph_batch_size(Some(batch_size));
    }

    if codec::is_high_resolution_export(target_size.0, target_size.1) {
        constants::MAX_FILTERGRAPH_IMAGES_HIGH_RES
    } else {
        constants::MAX_FILTERGRAPH_IMAGES_STANDARD
    }
}

// ---------------------------------------------------------------------------
// Ajustement automatique de la taille de batch selon la RAM
// ---------------------------------------------------------------------------

/// Ajuste la taille du prochain batch avant le rendu, selon la RAM actuelle.
///
/// Si la RAM dépasse le seuil SOFT (86%), on divise la limite par 2.
pub fn adjust_auto_batch_limit_for_memory(current_limit: usize) -> usize {
    let mut system = sysinfo::System::new();
    let Some(used_percent) = memory::current_system_memory_used_percent(&mut system) else {
        return current_limit;
    };

    if used_percent >= constants::AUTO_MEMORY_SOFT_LIMIT_PERCENT {
        let next = (current_limit / 2).max(constants::FILTERGRAPH_BATCH_MIN);
        println!(
            "[memory][auto-batch] RAM avant batch {:.1}%, limite {} -> {}",
            used_percent, current_limit, next
        );
        next
    } else {
        current_limit
    }
}

/// Calcule la taille du prochain batch après un rendu réussi.
///
/// - Si le pic de RAM est bas (< 72%), on double la limite pour atteindre vite le plafond utile.
/// - Si le pic est haut (≥ 86%), on réduit de 1.
/// - Sinon on garde la même limite.
pub fn next_auto_batch_limit_after_success(current_limit: usize, peak_percent: f64) -> usize {
    if peak_percent > 0.0 && peak_percent < constants::AUTO_MEMORY_GROW_BELOW_PERCENT {
        current_limit
            .saturating_mul(2)
            .min(constants::FILTERGRAPH_BATCH_MAX)
    } else if peak_percent >= constants::AUTO_MEMORY_SOFT_LIMIT_PERCENT {
        (current_limit.saturating_sub(1)).max(constants::FILTERGRAPH_BATCH_MIN)
    } else {
        current_limit
    }
}

// ---------------------------------------------------------------------------
// Construction de chemins pour les fichiers batch internes
// ---------------------------------------------------------------------------

/// Construit un chemin pour un fichier vidéo de batch interne.
///
/// L'extension dépend du mode d'export :
/// - Sans fond + alpha MOV → `.mov`
/// - Sans fond + WebM → `.webm`
/// - Avec fond → `.mp4`
pub fn make_internal_batch_path(
    base_dir: &Path,
    export_id: &str,
    batch_index: usize,
    export_without_background: bool,
    use_mov_alpha: bool,
) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ext = if export_without_background {
        if use_mov_alpha {
            "mov"
        } else {
            "webm"
        }
    } else {
        "mp4"
    };
    base_dir.join(format!(
        "internal_batch_{}_{}_{}.{}",
        export_id, batch_index, nonce, ext
    ))
}

// ---------------------------------------------------------------------------
// Export transparent
// ---------------------------------------------------------------------------

/// Détermine si l'export transparent utilise le conteneur MOV (ProRes/QTRLE).
///
/// Retourne `true` sauf si le format demandé est explicitement `webm_vp9_alpha`.
pub fn transparent_export_uses_mov(
    export_without_background: bool,
    transparent_export_format: Option<&str>,
) -> bool {
    export_without_background && !matches!(transparent_export_format, Some("webm_vp9_alpha"))
}

// ---------------------------------------------------------------------------
// Calculs de timing pour les transitions et les batchs
// ---------------------------------------------------------------------------

/// Calcule la durée du fade de transition entre le dernier et l'avant-dernier
/// timestamp d'un batch. La durée est bornée par `fade_duration_ms`.
pub fn transition_fade_duration_ms(timestamps_ms: &[i32], fade_duration_ms: i32) -> i32 {
    if timestamps_ms.len() < 2 {
        return 0;
    }

    let last = timestamps_ms.len() - 1;
    (timestamps_ms[last] - timestamps_ms[last - 1])
        .max(0)
        .min(fade_duration_ms.max(0))
}

/// Choisit l'index de fin d'un batch en s'assurant qu'une image est partagée
/// avec le batch suivant (chevauchement pour la transition).
pub fn choose_shared_batch_end_idx(
    image_count: usize,
    batch_start_idx: usize,
    batch_limit: usize,
) -> usize {
    if image_count == 0 || batch_start_idx + 1 >= image_count {
        return image_count;
    }

    (batch_start_idx + batch_limit.max(2)).min(image_count)
}

/// Calcule la durée de sortie du rendu d'un batch (en ms), en tenant compte
/// des fades entre chaque paire de timestamps.
pub fn compute_render_output_duration_ms(
    local_timestamps_ms: &[i32],
    fade_duration_ms: i32,
    last_tail_ms: i32,
) -> i32 {
    if local_timestamps_ms.is_empty() {
        return 1;
    }

    let fade_duration_ms = fade_duration_ms.max(0);
    let mut total = last_tail_ms.max(1);

    for pair in local_timestamps_ms.windows(2) {
        let delta = (pair[1] - pair[0]).max(1);
        total += delta - delta.min(fade_duration_ms);
    }

    total.max(1)
}

/// Convertit un temps en ms en nombre de frames cumulées.
pub fn cumulative_frames_for_time_ms(time_ms: i64, fps: i32) -> i64 {
    let fps = fps.max(1) as f64;
    ((time_ms.max(0) as f64 / 1000.0) * fps).round() as i64
}

/// Convertit un nombre de frames en secondes.
pub fn frames_to_seconds(frames: i64, fps: i32) -> f64 {
    frames.max(1) as f64 / fps.max(1) as f64
}

/// Calcule le temps effectif sur la timeline après application des fades cumulés.
///
/// Chaque transition entre images réduit le temps effectif de `fade_duration_ms`.
pub fn capture_timeline_ms(timestamp_ms: i32, image_index: usize, fade_duration_ms: i32) -> i64 {
    let completed_fades = image_index.saturating_sub(1) as i64;
    timestamp_ms as i64 - completed_fades * fade_duration_ms.max(0) as i64
}
