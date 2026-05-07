use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
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

fn build_hifz_filter_graph(segments: &[HifzAudioSegment]) -> Result<(String, i64), String> {
    let mut filter_lines: Vec<String> = Vec::new();
    let mut concat_inputs = String::new();
    let mut output_duration_ms: i64 = 0;
    let mut segment_index: usize = 0;

    for segment in segments {
        let start_ms = segment.start_ms.max(0);
        let end_ms = segment.end_ms.max(start_ms + 1);
        let repeat_count = segment.repeat_count.max(1);

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
    let (source_audio_path, _guards) =
        resolve_source_audio_path(&ffmpeg_path, audio_path, audio_clips)?;

    let _ = app_handle.emit(
        "segmentation-status",
        serde_json::json!({ "message": "Generating Hifz repetition audio..." }),
    );

    let (filter_graph, output_duration_ms) = build_hifz_filter_graph(&segments)?;

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

    let output = cmd
        .output()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg Hifz audio error: {}", stderr));
    }

    Ok(GeneratedHifzAudio {
        output_path,
        duration_ms: output_duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::build_hifz_filter_graph;
    use crate::segmentation::types::HifzAudioSegment;

    #[test]
    fn hifz_filter_graph_separates_each_chain() {
        let (graph, duration_ms) = build_hifz_filter_graph(&[
            HifzAudioSegment {
                start_ms: 100,
                end_ms: 600,
                repeat_count: 2,
            },
            HifzAudioSegment {
                start_ms: 700,
                end_ms: 1000,
                repeat_count: 1,
            },
        ])
        .expect("graph should build");

        assert!(graph.contains("[h0];\n[0:a]atrim"));
        assert!(graph.contains("[h0][h1][h2]concat=n=3:v=0:a=1[outa]"));
        assert_eq!(duration_ms, 1300);
    }
}
