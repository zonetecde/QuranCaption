use std::process::Command;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;

/// Extrait une forme d'onde simplifiée (pics normalisés) d'un fichier audio.
#[tauri::command]
pub async fn get_audio_waveform(file_path: String) -> Result<Vec<f32>, String> {
    let path_buf = path_utils::normalize_existing_path(&file_path);
    if !path_buf.exists() {
        return Err(format!("File not found: {}", path_buf.to_string_lossy()));
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-i",
        &path_buf.to_string_lossy(),
        "-ac",
        "1",
        "-filter:a",
        "aresample=4000",
        "-map",
        "0:a",
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        "-",
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr));
    }

    // Agrégation des pics: 100 pics/s sur signal downsamplé 4kHz.
    let raw_data = output.stdout;
    let mut peaks = Vec::new();
    let samples_per_peak = 40;
    let mut chunk_max = 0.0;
    let mut sample_count = 0;

    for chunk in raw_data.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        let abs_sample = sample.abs() as f32 / 32768.0;
        if abs_sample > chunk_max {
            chunk_max = abs_sample;
        }
        sample_count += 1;
        if sample_count >= samples_per_peak {
            peaks.push(chunk_max);
            chunk_max = 0.0;
            sample_count = 0;
        }
    }
    if sample_count > 0 {
        peaks.push(chunk_max);
    }

    Ok(peaks)
}
