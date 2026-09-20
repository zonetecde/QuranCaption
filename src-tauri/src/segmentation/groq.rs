use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use tauri::Emitter;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;
use crate::utils::temp_file::TempFileGuard;

use super::audio_merge::merge_audio_clips_for_segmentation;
use super::types::SegmentationAudioClip;

const GROQ_TRANSCRIPTION_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL: &str = "whisper-large-v3";
const GROQ_FREE_FILE_LIMIT_BYTES: u64 = 25 * 1024 * 1024;
const SINGLE_SPEAKER: &str = "SPEAKER_00";

#[derive(Deserialize)]
struct GroqWord {
    word: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct GroqSegment {
    text: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct GroqTranscription {
    #[serde(default = "default_language")]
    language: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    segments: Vec<GroqSegment>,
    #[serde(default)]
    words: Vec<GroqWord>,
}

/// Retourne la langue arabe lorsque Groq omet le code de langue détecté.
fn default_language() -> String {
    "ar".to_string()
}

/// Émet la progression de la transcription Groq vers l'interface.
fn emit_groq_status(app_handle: &tauri::AppHandle, phase: &str, progress: f64) {
    let _ = app_handle.emit(
        "segmentation-status",
        serde_json::json!({ "phase": phase, "progress": progress }),
    );
}

/// Prépare un OGG mono léger tout en conservant les positions de la timeline.
fn prepare_groq_audio(
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
) -> Result<(PathBuf, Vec<TempFileGuard>), String> {
    let ffmpeg_path =
        binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
    let mut guards = Vec::new();
    let source_path = if let Some(clips) = audio_clips.as_ref().filter(|clips| !clips.is_empty()) {
        let (merged_path, guard) = merge_audio_clips_for_segmentation(&ffmpeg_path, clips)?;
        guards.push(guard);
        merged_path
    } else if let Some(path) = audio_path {
        path_utils::normalize_existing_path(&path)
    } else {
        return Err("Audio file not found: missing audioPath/audioClips".to_string());
    };

    if !source_path.exists() {
        return Err(format!(
            "Audio file not found: {}",
            source_path.to_string_lossy()
        ));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let output_path = std::env::temp_dir().join(format!("minbarstudio-groq-{stamp}.ogg"));
    guards.push(TempFileGuard(output_path.clone()));

    let mut command = Command::new(ffmpeg_path);
    command.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source_path.to_string_lossy().as_ref(),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-vbr",
        "on",
        "-vn",
        output_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Unable to execute ffmpeg: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let size = fs::metadata(&output_path)
        .map_err(|error| format!("Unable to inspect prepared audio: {error}"))?
        .len();
    if size == 0 {
        return Err("Prepared Groq audio is empty".to_string());
    }
    if size > GROQ_FREE_FILE_LIMIT_BYTES {
        return Err("GROQ_FILE_TOO_LARGE".to_string());
    }

    Ok((output_path, guards))
}

/// Convertit la réponse Groq au format de transcription commun de Minbar Studio.
fn normalize_groq_response(response: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut transcription: GroqTranscription = serde_json::from_value(response)
        .map_err(|error| format!("Invalid Groq transcription response: {error}"))?;
    transcription
        .words
        .retain(|word| !word.word.trim().is_empty() && word.end > word.start);
    if transcription.words.is_empty() {
        return Err("GROQ_WORD_TIMESTAMPS_MISSING".to_string());
    }
    if transcription.segments.is_empty() {
        transcription.segments.push(GroqSegment {
            text: transcription.text.clone(),
            start: transcription.words.first().map_or(0.0, |word| word.start),
            end: transcription.words.last().map_or(0.0, |word| word.end),
        });
    }

    let valid_segments = transcription
        .segments
        .iter()
        .filter(|segment| !segment.text.trim().is_empty() && segment.end > segment.start)
        .collect::<Vec<_>>();
    if valid_segments.is_empty() {
        return Err("GROQ_EMPTY_TRANSCRIPTION".to_string());
    }

    let mut words_by_segment = vec![Vec::new(); valid_segments.len()];
    for word in &transcription.words {
        let midpoint = (word.start + word.end) / 2.0;
        let index = valid_segments
            .iter()
            .enumerate()
            .min_by(|(_, left), (_, right)| {
                let distance = |segment: &&GroqSegment| {
                    if midpoint < segment.start {
                        segment.start - midpoint
                    } else if midpoint > segment.end {
                        midpoint - segment.end
                    } else {
                        0.0
                    }
                };
                distance(left).total_cmp(&distance(right))
            })
            .map_or(0, |(index, _)| index);
        words_by_segment[index].push(serde_json::json!({
            "word": word.word.trim(),
            "start": word.start,
            "end": word.end,
            "speaker": SINGLE_SPEAKER
        }));
    }

    let segments = valid_segments
        .into_iter()
        .zip(words_by_segment)
        .map(|(segment, words)| {
            serde_json::json!({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.trim(),
                "speaker": SINGLE_SPEAKER,
                "words": words
            })
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "language": transcription.language,
        "device": "groq",
        "model": GROQ_MODEL,
        "segments": segments,
        "speakers": [SINGLE_SPEAKER],
        "wordTimestampsAvailable": true
    }))
}

/// Transcrit l'audio arabe avec Groq Whisper Large V3 et ses timestamps par mot.
pub async fn transcribe_audio_groq(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    api_key: String,
) -> Result<serde_json::Value, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("GROQ_API_KEY_REQUIRED".to_string());
    }

    emit_groq_status(&app_handle, "groq_prepare", 10.0);
    let (prepared_path, _guards) = prepare_groq_audio(audio_path, audio_clips)?;
    let audio = fs::read(&prepared_path)
        .map_err(|error| format!("Unable to read prepared audio: {error}"))?;
    emit_groq_status(&app_handle, "groq_transcribe", 35.0);

    let audio_part = Part::bytes(audio)
        .file_name("audio.ogg")
        .mime_str("audio/ogg")
        .map_err(|error| error.to_string())?;
    let form = Form::new()
        .part("file", audio_part)
        .text("model", GROQ_MODEL)
        .text("language", "ar")
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "word")
        .text("timestamp_granularities[]", "segment")
        .text("temperature", "0");
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("Unable to create Groq HTTP client: {error}"))?;
    let response = client
        .post(GROQ_TRANSCRIPTION_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("GROQ_REQUEST_FAILED: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "GROQ_AUTHENTICATION_FAILED".to_string(),
            413 => "GROQ_FILE_TOO_LARGE".to_string(),
            429 => "GROQ_RATE_LIMIT_REACHED".to_string(),
            _ => format!("GROQ_HTTP_ERROR: {status}"),
        });
    }

    emit_groq_status(&app_handle, "groq_timestamps", 90.0);
    let result = normalize_groq_response(
        response
            .json()
            .await
            .map_err(|error| format!("Invalid Groq JSON response: {error}"))?,
    )?;
    emit_groq_status(&app_handle, "groq_complete", 100.0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::normalize_groq_response;

    /// Vérifie que la réponse Groq conserve les segments et timestamps mot à mot attendus.
    #[test]
    fn normalizes_groq_words_into_transcription_segments() {
        let response = serde_json::json!({
            "language": "ar",
            "text": "السلام عليكم",
            "segments": [
                { "start": 0.0, "end": 0.6, "text": "السلام" },
                { "start": 0.6, "end": 1.2, "text": "عليكم" }
            ],
            "words": [
                { "word": "السلام", "start": 0.0, "end": 0.6 },
                { "word": "عليكم", "start": 0.6, "end": 1.2 }
            ]
        });

        let result = normalize_groq_response(response).expect("response should normalize");

        assert_eq!(result["device"], "groq");
        assert_eq!(result["model"], "whisper-large-v3");
        assert_eq!(result["speakers"], serde_json::json!(["SPEAKER_00"]));
        assert_eq!(result["segments"][0]["words"].as_array().unwrap().len(), 1);
        assert_eq!(result["segments"][1]["words"].as_array().unwrap().len(), 1);
        assert_eq!(result["wordTimestampsAvailable"], true);
    }

    /// Vérifie qu'une transcription vide est rejetée avant son application au projet.
    #[test]
    fn rejects_empty_groq_transcription() {
        let response = serde_json::json!({
            "language": "ar",
            "text": "",
            "segments": [],
            "words": []
        });

        assert!(normalize_groq_response(response).is_err());
    }

    /// Vérifie que les légers intervalles Groq ne font perdre aucun timestamp de mot.
    #[test]
    fn assigns_words_between_groq_segments() {
        let response = serde_json::json!({
            "language": "ar",
            "text": "واحد اثنان ثلاثة",
            "segments": [
                { "start": 0.0, "end": 0.5, "text": "واحد" },
                { "start": 0.7, "end": 1.2, "text": "اثنان ثلاثة" }
            ],
            "words": [
                { "word": "واحد", "start": 0.0, "end": 0.4 },
                { "word": "اثنان", "start": 0.5, "end": 0.7 },
                { "word": "ثلاثة", "start": 0.8, "end": 1.1 }
            ]
        });

        let result = normalize_groq_response(response).expect("response should normalize");
        let word_count = result["segments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|segment| segment["words"].as_array().unwrap().len())
            .sum::<usize>();

        assert_eq!(word_count, 3);
    }
}
