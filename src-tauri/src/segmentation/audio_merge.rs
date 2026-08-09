use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::android_media::execute_ffmpeg;
use crate::path_utils;
use crate::utils::temp_file::TempFileGuard;

use super::types::SegmentationAudioClip;

/// Fusionne des clips audio temporels en un seul WAV 16-bit aligné sur la timeline.
pub(crate) fn merge_audio_clips_for_segmentation(
    clips: &[SegmentationAudioClip],
    temp_dir: &Path,
) -> Result<(PathBuf, TempFileGuard), String> {
    if clips.is_empty() {
        return Err("No audio clips provided for merge".to_string());
    }

    // Normalisation des clips: chemins canoniques et bornes de temps valides.
    let mut normalized: Vec<(PathBuf, i64, i64, i64)> = Vec::new();
    for clip in clips {
        let path = path_utils::normalize_existing_path(&clip.path);
        if !path.exists() {
            return Err(format!("Audio file not found: {}", path.to_string_lossy()));
        }

        let start_ms = clip.start_ms.max(0);
        let end_ms = clip.end_ms.max(start_ms);
        if end_ms == start_ms {
            continue;
        }
        normalized.push((path, start_ms, end_ms, clip.source_start_ms.max(0)));
    }
    if normalized.is_empty() {
        return Err("No valid audio clips to merge".to_string());
    }

    let total_end_ms = normalized
        .iter()
        .map(|(_, _, end_ms, _)| *end_ms)
        .max()
        .unwrap_or(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let merged_path = temp_dir.join(format!("qurancaption-seg-merged-{}.wav", stamp));
    let guard = TempFileGuard(merged_path.clone());

    // Construction dynamique d'un filtre ffmpeg pour trim + delay + mix.
    let mut args = vec![
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
    ];
    for (path, _, _, _) in &normalized {
        args.push("-i".to_string());
        args.push(path.to_string_lossy().to_string());
    }

    let total_s = total_end_ms as f64 / 1000.0;
    let mut filters = vec![format!(
        "anullsrc=r=48000:cl=stereo,atrim=start=0:end={:.6}[asilence]",
        total_s
    )];
    for (idx, (_, start_ms, end_ms, source_start_ms)) in normalized.iter().enumerate() {
        let duration_ms = (end_ms - start_ms).max(0);
        let source_start_s = *source_start_ms as f64 / 1000.0;
        let source_end_s = source_start_ms.saturating_add(duration_ms) as f64 / 1000.0;
        filters.push(format!(
            "[{}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,adelay=delays={}:all=1[a{}]",
            idx, source_start_s, source_end_s, start_ms, idx
        ));
    }

    let mut inputs = "[asilence]".to_string();
    for idx in 0..normalized.len() {
        inputs.push_str(&format!("[a{}]", idx));
    }
    filters.push(format!(
        "{}amix=inputs={}:duration=longest:normalize=0:dropout_transition=0,atrim=start=0:end={:.6},asetpts=PTS-STARTPTS[mix]",
        inputs,
        normalized.len() + 1,
        total_s
    ));

    let filter_complex = filters.join(";");
    args.extend([
        "-filter_complex".to_string(),
        filter_complex,
        "-map".to_string(),
        "[mix]".to_string(),
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        "-t".to_string(),
        format!("{:.6}", total_s),
        merged_path.to_string_lossy().to_string(),
    ]);

    let output = execute_ffmpeg(&args)?;
    if !output.success {
        return Err(format!("ffmpeg merge error: {}", output.output));
    }

    Ok((merged_path, guard))
}
