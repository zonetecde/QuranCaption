use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::path_utils;
use crate::utils::process::configure_command_no_window;
use crate::utils::temp_file::TempFileGuard;

use super::types::SegmentationAudioClip;

/// Fusionne des clips audio temporels en un seul WAV mono 16-bit aligné sur la timeline.
pub(crate) fn merge_audio_clips_for_segmentation(
    ffmpeg_path: &str,
    clips: &[SegmentationAudioClip],
) -> Result<(PathBuf, TempFileGuard), String> {
    if clips.is_empty() {
        return Err("No audio clips provided for merge".to_string());
    }

    // Normalisation des clips: chemins canoniques et bornes de temps valides.
    let mut normalized: Vec<(PathBuf, i64, i64)> = Vec::new();
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
        normalized.push((path, start_ms, end_ms));
    }
    if normalized.is_empty() {
        return Err("No valid audio clips to merge".to_string());
    }

    let total_end_ms = normalized
        .iter()
        .map(|(_, _, end_ms)| *end_ms)
        .max()
        .unwrap_or(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let merged_path = std::env::temp_dir().join(format!("qurancaption-seg-merged-{}.wav", stamp));
    let guard = TempFileGuard(merged_path.clone());

    // Construction dynamique d'un filtre ffmpeg pour trim + delay + mix.
    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error"]);
    for (path, _, _) in &normalized {
        cmd.arg("-i").arg(path.to_string_lossy().as_ref());
    }

    let mut filters: Vec<String> = Vec::new();
    for (idx, (_, start_ms, end_ms)) in normalized.iter().enumerate() {
        let duration_ms = (end_ms - start_ms).max(0);
        let duration_s = duration_ms as f64 / 1000.0;
        filters.push(format!(
            "[{}:a]atrim=start=0:end={:.6},asetpts=PTS-STARTPTS,adelay={}|{}[a{}]",
            idx, duration_s, start_ms, start_ms, idx
        ));
    }

    let mut inputs = String::new();
    for idx in 0..normalized.len() {
        inputs.push_str(&format!("[a{}]", idx));
    }
    let total_s = total_end_ms as f64 / 1000.0;
    filters.push(format!(
        "{}amix=inputs={}:duration=longest:dropout_transition=0,atrim=end={:.6},asetpts=PTS-STARTPTS[mix]",
        inputs,
        normalized.len(),
        total_s
    ));

    let filter_complex = filters.join(";");
    cmd.args([
        "-filter_complex",
        &filter_complex,
        "-map",
        "[mix]",
        "-c:a",
        "pcm_s16le",
        "-t",
        &format!("{:.6}", total_s),
        merged_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg merge error: {}", stderr));
    }

    Ok((merged_path, guard))
}
