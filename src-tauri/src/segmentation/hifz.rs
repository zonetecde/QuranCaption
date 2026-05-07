use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;
use crate::utils::temp_file::TempFileGuard;

use super::audio_merge::merge_audio_clips_for_segmentation;
use super::types::{HifzAudioSegment, SegmentationAudioClip};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedHifzAudio {
    pub output_path: String,
    pub duration_ms: i64,
}

fn emit_hifz_progress(
    app_handle: &AppHandle,
    progress: f64,
    current_time_s: f64,
    total_time_s: f64,
    message: &str,
) {
    let _ = app_handle.emit(
        "hifz-generation-progress",
        serde_json::json!({
            "progress": progress,
            "currentTime": current_time_s,
            "totalTime": total_time_s,
            "message": message
        }),
    );
}

fn parse_progress_time_s(line: &str) -> Option<f64> {
    if let Some(value) = line.strip_prefix("out_time_ms=") {
        return value.trim().parse::<f64>().ok().map(|ms| ms / 1_000_000.0);
    }
    if let Some(value) = line.strip_prefix("out_time_us=") {
        return value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    if let Some(value) = line.strip_prefix("out_time=") {
        return parse_ffmpeg_time(value.trim());
    }
    None
}

fn parse_ffmpeg_time(value: &str) -> Option<f64> {
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 3 {
        return None;
    }

    let hours = parts[0].parse::<f64>().ok()?;
    let minutes = parts[1].parse::<f64>().ok()?;
    let seconds = parts[2].parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn build_hifz_filter_graph(segments: &[HifzAudioSegment]) -> Result<(String, i64), String> {
    let mut filter_lines: Vec<String> = Vec::new();
    let mut concat_inputs = String::new();
    let mut output_duration_ms: i64 = 0;
    let mut segment_index: usize = 0;

    for segment in segments {
        let start_ms = segment.start_ms.max(0);
        let end_ms = segment.end_ms.max(start_ms + 1);
        let repeat_count = segment.repeat_count.max(1);
        let silence_between_repetitions_ms =
            segment.silence_between_repetitions_ms.unwrap_or(0).max(0);

        for _ in 0..repeat_count {
            let label = format!("h{}", segment_index);
            filter_lines.push(format!(
                "[0:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS[{}]",
                start_ms as f64 / 1000.0,
                end_ms as f64 / 1000.0,
                label
            ));
            concat_inputs.push_str(&format!("[{}]", label));
            output_duration_ms += end_ms - start_ms;
            segment_index += 1;

            if repeat_count > 1 && silence_between_repetitions_ms > 0 {
                let silence_label = format!("h{}", segment_index);
                filter_lines.push(format!(
                    "anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration={:.6},asetpts=PTS-STARTPTS[{}]",
                    silence_between_repetitions_ms as f64 / 1000.0,
                    silence_label
                ));
                concat_inputs.push_str(&format!("[{}]", silence_label));
                output_duration_ms += silence_between_repetitions_ms;
                segment_index += 1;
            }
        }
    }

    if segment_index == 0 {
        return Err("No valid Hifz audio segments were produced".to_string());
    }

    filter_lines.push(format!(
        "{}concat=n={}:v=0:a=1[outa]",
        concat_inputs, segment_index
    ));

    Ok((filter_lines.join(";\n"), output_duration_ms))
}

fn create_temp_file_path(
    prefix: &str,
    extension: &str,
) -> Result<(PathBuf, TempFileGuard), String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = std::env::temp_dir().join(format!("{}-{}.{}", prefix, stamp, extension));
    Ok((path.clone(), TempFileGuard(path)))
}

fn resolve_source_audio_path(
    ffmpeg_path: &str,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
) -> Result<(PathBuf, Vec<TempFileGuard>), String> {
    if let Some(clips) = audio_clips.filter(|clips| !clips.is_empty()) {
        let (merged_path, guard) = merge_audio_clips_for_segmentation(ffmpeg_path, &clips)?;
        return Ok((merged_path, vec![guard]));
    }

    let raw_audio_path = audio_path.ok_or_else(|| "No audio source was provided".to_string())?;
    let normalized = path_utils::normalize_existing_path(&raw_audio_path);
    if !normalized.exists() {
        return Err(format!(
            "Audio file not found: {}",
            normalized.to_string_lossy()
        ));
    }

    Ok((normalized, Vec::new()))
}

/// Génère un fichier audio WAV silencieux temporaire pour servir de source ffmpeg.
/// Utilise une piste stereo 44.1kHz et une duree minimale pour permettre l'`atrim` des segments.
fn create_silent_source_audio(
    ffmpeg_path: &str,
    duration_s: f64,
) -> Result<(PathBuf, TempFileGuard), String> {
    let duration_s = duration_s.max(0.001);
    let (path, guard) = create_temp_file_path("qurancaption-hifz-silence", "wav")?;

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-t",
        &format!("{:.6}", duration_s),
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);
    let status = cmd.status().map_err(|e| format!("ffmpeg error: {}", e))?;
    if !status.success() {
        return Err("Failed to generate silent audio source".to_string());
    }

    Ok((path, guard))
}

pub async fn generate_hifz_audio(
    app_handle: AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    segments: Vec<HifzAudioSegment>,
    output_path: String,
) -> Result<GeneratedHifzAudio, String> {
    if segments.is_empty() {
        return Err("No Hifz audio segments were provided".to_string());
    }

    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let mut _guards: Vec<TempFileGuard> = Vec::new();
    let source_audio_path = if audio_path.is_none()
        && audio_clips.as_ref().map_or(true, |clips| clips.is_empty())
    {
        let max_end_ms = segments
            .iter()
            .map(|segment| segment.end_ms.max(0))
            .max()
            .unwrap_or(0);
        // The filter graph trims against the source timeline; ensure the silent input is long enough.
        let duration_s = (max_end_ms.max(1) as f64) / 1000.0 + 0.1;
        let (path, guard) = create_silent_source_audio(&ffmpeg_path, duration_s)?;
        _guards.push(guard);
        path
    } else {
        let (path, mut resolved_guards) =
            resolve_source_audio_path(&ffmpeg_path, audio_path, audio_clips)?;
        _guards.append(&mut resolved_guards);
        path
    };

    let _ = app_handle.emit(
        "segmentation-status",
        serde_json::json!({ "message": "Generating Hifz repetition audio..." }),
    );

    let (filter_graph, output_duration_ms) = build_hifz_filter_graph(&segments)?;
    let output_duration_s = (output_duration_ms.max(1) as f64) / 1000.0;

    let (filter_script_path, _filter_script_guard) =
        create_temp_file_path("qurancaption-hifz-filter", "txt")?;
    fs::write(&filter_script_path, filter_graph)
        .map_err(|e| format!("Failed to write Hifz filter script: {}", e))?;

    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create Hifz output directory: {}", e))?;
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:2",
        "-i",
        source_audio_path.to_string_lossy().as_ref(),
        "-filter_complex_script",
        filter_script_path.to_string_lossy().as_ref(),
        "-map",
        "[outa]",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        "-cbr",
        "1",
        "-ar",
        "44100",
        "-ac",
        "2",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    cmd.stderr(Stdio::piped());

    emit_hifz_progress(
        &app_handle,
        0.0,
        0.0,
        output_duration_s,
        "Starting Hifz audio generation...",
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg progress".to_string())?;
    let reader = BufReader::new(stderr);
    let mut stderr_content = String::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read ffmpeg progress: {}", e))?;
        stderr_content.push_str(&line);
        stderr_content.push('\n');

        if let Some(current_time_s) = parse_progress_time_s(&line) {
            let current_time_s = current_time_s.min(output_duration_s);
            let progress = (current_time_s / output_duration_s * 100.0).clamp(0.0, 100.0);
            emit_hifz_progress(
                &app_handle,
                progress,
                current_time_s,
                output_duration_s,
                "Generating Hifz repetition audio...",
            );
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Unable to wait for ffmpeg: {}", e))?;
    if !status.success() {
        return Err(format!("ffmpeg Hifz audio error: {}", stderr_content));
    }

    emit_hifz_progress(
        &app_handle,
        100.0,
        output_duration_s,
        output_duration_s,
        "Hifz audio generated.",
    );

    Ok(GeneratedHifzAudio {
        output_path,
        duration_ms: output_duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_hifz_filter_graph, parse_ffmpeg_time, parse_progress_time_s};
    use crate::segmentation::types::HifzAudioSegment;

    #[test]
    fn hifz_filter_graph_separates_each_chain() {
        let (graph, duration_ms) = build_hifz_filter_graph(&[
            HifzAudioSegment {
                start_ms: 100,
                end_ms: 600,
                repeat_count: 2,
                silence_between_repetitions_ms: None,
            },
            HifzAudioSegment {
                start_ms: 700,
                end_ms: 1000,
                repeat_count: 1,
                silence_between_repetitions_ms: None,
            },
        ])
        .expect("graph should build");

        assert!(graph.contains("[h0];\n[0:a]atrim"));
        assert!(graph.contains("[h0][h1][h2]concat=n=3:v=0:a=1[outa]"));
        assert_eq!(duration_ms, 1300);
    }

    #[test]
    fn hifz_filter_graph_inserts_silence_between_repetitions() {
        let (graph, duration_ms) = build_hifz_filter_graph(&[HifzAudioSegment {
            start_ms: 100,
            end_ms: 600,
            repeat_count: 3,
            silence_between_repetitions_ms: Some(250),
        }])
        .expect("graph should build");

        assert!(graph.contains("anullsrc=channel_layout=stereo:sample_rate=44100"));
        assert!(graph.contains("concat=n=6:v=0:a=1[outa]"));
        assert_eq!(duration_ms, 2250);
    }

    #[test]
    fn parses_ffmpeg_progress_time_values() {
        assert_eq!(parse_progress_time_s("out_time_ms=2500000"), Some(2.5));
        assert_eq!(parse_progress_time_s("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress_time_s("out_time=00:01:02.500000"), Some(62.5));
        assert_eq!(parse_ffmpeg_time("invalid"), None);
    }
}
