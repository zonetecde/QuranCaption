use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Emitter;

use crate::binaries;
use crate::path_utils;
use crate::utils::process::configure_command_no_window;
use crate::utils::temp_file::TempFileGuard;

use super::audio_merge::merge_audio_clips_for_segmentation;
use super::data_files::{required_word_timing_model_files, validate_word_timing_model_file};
use super::python_env::{
    apply_hf_token_env, get_word_timing_model_dir, resolve_engine_python_exe,
    resolve_python_resource_path,
};
use super::types::{LocalSegmentationEngine, SegmentationAudioClip};

/// ExÃ©cute le script Python local d'un moteur donnÃ© et retourne le JSON de segmentation.
fn run_local_segmentation_script(
    app_handle: tauri::AppHandle,
    engine: LocalSegmentationEngine,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    mut extra_args: Vec<String>,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    println!(
        "[segmentation][local][debug] engine={} min_silence_ms={:?} min_speech_ms={:?} pad_ms={:?} extra_args={:?} hf_token_present={}",
        engine.as_key(),
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        extra_args,
        hf_token
            .as_ref()
            .map(|token| !token.trim().is_empty())
            .unwrap_or(false)
    );

    let mut _merged_guard: Option<TempFileGuard> = None;
    let mut _temp_guard: Option<TempFileGuard> = None;

    // Pour QuranWordTiming, l'audio est chargé et découpé directement en mémoire par Python.
    // Pour les autres moteurs, pré-traitement via ffmpeg (merge éventuel puis resample 16kHz mono).
    let audio_path = if let Some(clips) = audio_clips.as_ref().filter(|c| !c.is_empty()) {
        println!(
            "[segmentation][local][debug] received {} audio clip(s)",
            clips.len()
        );
        for (idx, clip) in clips.iter().enumerate() {
            println!(
                "[segmentation] clip[{}] path={} start_ms={} end_ms={} source_start_ms={}",
                idx, clip.path, clip.start_ms, clip.end_ms, clip.source_start_ms
            );
        }
        if matches!(engine, LocalSegmentationEngine::QuranWordTiming) {
            path_utils::normalize_existing_path(&clips[0].path)
        } else {
            let ffmpeg_path =
                binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
            let (merged_path, guard) = merge_audio_clips_for_segmentation(&ffmpeg_path, clips)?;
            _merged_guard = Some(guard);
            println!(
                "[segmentation] Using merged audio for local: {}",
                merged_path.to_string_lossy()
            );
            merged_path
        }
    } else if let Some(path) = audio_path.as_ref() {
        path_utils::normalize_existing_path(path)
    } else {
        return Err("Audio file not found: missing audioPath/audioClips".to_string());
    };

    let audio_path_str = audio_path.to_string_lossy().to_string();
    if !audio_path.exists() {
        return Err(format!("Audio file not found: {}", audio_path_str));
    }
    println!(
        "[segmentation][local][debug] normalized audio path={} (exists={})",
        audio_path_str,
        audio_path.exists()
    );

    let target_audio_path_str = if matches!(engine, LocalSegmentationEngine::QuranWordTiming) {
        audio_path_str
    } else {
        let ffmpeg_path =
            binaries::resolve_binary("ffmpeg").ok_or_else(|| "ffmpeg binary not found".to_string())?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        let temp_path = std::env::temp_dir().join(format!(
            "qurancaption-local-{}-{}.wav",
            engine.as_key(),
            stamp
        ));
        _temp_guard = Some(TempFileGuard(temp_path.clone()));

        let mut resample_cmd = Command::new(&ffmpeg_path);
        resample_cmd.args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            &audio_path_str,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-vn",
            temp_path.to_string_lossy().as_ref(),
        ]);
        configure_command_no_window(&mut resample_cmd);
        println!(
            "[segmentation][local][debug] running ffmpeg preprocess -> {}",
            temp_path.to_string_lossy()
        );

        let resample_output = resample_cmd
            .output()
            .map_err(|e| format!("Unable to execute ffmpeg for preprocessing: {}", e))?;
        if !resample_output.status.success() {
            let stderr = String::from_utf8_lossy(&resample_output.stderr);
            eprintln!(
                "[segmentation][local][debug] ffmpeg preprocessing failed (status={:?}): {}",
                resample_output.status.code(),
                stderr
            );
            return Err(format!("ffmpeg preprocessing error: {}", stderr));
        }
        let temp_size = fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
        println!(
            "[segmentation][local][debug] ffmpeg preprocessing ok temp_wav={} size={}B",
            temp_path.to_string_lossy(),
            temp_size
        );
        temp_path.to_string_lossy().to_string()
    };

    let python_exe = resolve_engine_python_exe(&app_handle, engine)?;
    let script_path = resolve_python_resource_path(&app_handle, engine.script_relative_path())?;
    let word_timing_model_dir = if matches!(
        engine,
        LocalSegmentationEngine::QuranWordTiming | LocalSegmentationEngine::QuranWordTimingOld
    ) {
        let dir = get_word_timing_model_dir(&app_handle, engine)?;
        for (name, _, size, hash) in required_word_timing_model_files(engine) {
            validate_word_timing_model_file(&dir.join(name), *size, hash)?;
        }
        Some(dir)
    } else {
        None
    };
    println!(
        "[segmentation][local][debug] python_exe={} script_path={}",
        python_exe.to_string_lossy(),
        script_path.to_string_lossy()
    );
    println!(
        "[segmentation][local][debug] script_exists={}",
        script_path.exists()
    );

    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        target_audio_path_str,
    ];
    if let Some(ms) = min_silence_ms {
        args.push("--min-silence-ms".to_string());
        args.push(ms.to_string());
    }
    if let Some(ms) = min_speech_ms {
        args.push("--min-speech-ms".to_string());
        args.push(ms.to_string());
    }
    if let Some(ms) = pad_ms {
        args.push("--pad-ms".to_string());
        args.push(ms.to_string());
    }
    if matches!(engine, LocalSegmentationEngine::QuranWordTiming) {
        if let Some(clips) = audio_clips.as_ref().filter(|c| !c.is_empty()) {
            args.push("--timeline-clips-json".to_string());
            args.push(serde_json::to_string(clips).map_err(|error| error.to_string())?);
        }
    }
    if matches!(engine, LocalSegmentationEngine::QuranWordTimingOld) {
        if let Some(clips) = audio_clips.as_ref().filter(|clips| !clips.is_empty()) {
            // Le moteur historique reçoit l'audio fusionné avec ses offsets de timeline.
            let regions: Vec<[i64; 2]> = clips
                .iter()
                .filter_map(|clip| {
                    let start = clip.start_ms.max(0);
                    let end = clip.end_ms.max(start);
                    (end > start).then_some([start, end])
                })
                .collect();
            args.push("--audio-regions-ms".to_string());
            args.push(serde_json::to_string(&regions).map_err(|error| error.to_string())?);
        }
    }
    args.append(&mut extra_args);
    println!("[segmentation][local][debug] python args={:?}", args);

    let mut version_cmd = Command::new(&python_exe);
    version_cmd.arg("--version");
    configure_command_no_window(&mut version_cmd);
    match version_cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let text = if !stdout.is_empty() { stdout } else { stderr };
            println!(
                "[segmentation][local][debug] python --version status={:?} value={}",
                output.status.code(),
                text
            );
        }
        Err(err) => eprintln!(
            "[segmentation][local][debug] python --version failed: {}",
            err
        ),
    }

    // ExÃ©cution Python + thread de lecture stderr pour status/events de progression.
    let mut cmd = Command::new(&python_exe);
    cmd.args(&args);
    // Conserve les traces des plantages natifs et garantit un stderr lisible en UTF-8.
    cmd.env("PYTHONFAULTHANDLER", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    if let Some(dir) = word_timing_model_dir {
        cmd.env(
            if matches!(engine, LocalSegmentationEngine::QuranWordTimingOld) {
                "QC_WORD_TIMING_OLD_MODEL_DIR"
            } else {
                "QC_WORD_TIMING_MODEL_DIR"
            },
            dir,
        );
    }
    if let Some(token) = hf_token {
        if !token.trim().is_empty() {
            apply_hf_token_env(&mut cmd, token.trim());
        }
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    configure_command_no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Python: {}", e))?;
    println!(
        "[segmentation][local][debug] spawned python pid={} engine={}",
        child.id(),
        engine.as_key()
    );

    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let app_handle_clone = app_handle.clone();
    let engine_key = engine.as_key().to_string();
    let engine_key_for_thread = engine_key.clone();
    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines_clone = Arc::clone(&stderr_lines);

    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                if line.starts_with("STATUS:") {
                    let json_str = line.trim_start_matches("STATUS:");
                    if let Ok(status_data) = serde_json::from_str::<serde_json::Value>(json_str) {
                        let _ = app_handle_clone.emit("segmentation-status", status_data);
                    }
                    println!(
                        "[segmentation][local][status][{}] {}",
                        engine_key_for_thread, line
                    );
                } else if !line.trim().is_empty() {
                    eprintln!(
                        "[segmentation][local][stderr][{}] {}",
                        engine_key_for_thread, line
                    );
                    if let Ok(mut locked) = stderr_lines_clone.lock() {
                        locked.push(line);
                        if locked.len() > 120 {
                            let drain_count = locked.len() - 120;
                            locked.drain(0..drain_count);
                        }
                    }
                }
            }
        }
    });

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Python: {}", e))?;
    println!(
        "[segmentation][local][debug] python process finished engine={} status={:?}",
        engine_key,
        output.status.code()
    );
    let _ = stderr_handle.join();

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        println!(
            "[segmentation][local][debug] python stdout bytes={} (success path)",
            output.stdout.len()
        );
        // Le moteur peut encore écrire des logs après sa réponse JSON structurée.
        let result: serde_json::Value = serde_json::Deserializer::from_str(&stdout)
            .into_iter()
            .next()
            .ok_or_else(|| "Python script returned no JSON output".to_string())?
            .map_err(|e| {
                let stderr_text = stderr_lines
                    .lock()
                    .ok()
                    .map(|lines| lines.join("\n"))
                    .unwrap_or_default();
                if stderr_text.trim().is_empty() {
                    format!("Failed to parse Python output: {}", e)
                } else {
                    format!(
                        "Failed to parse Python output: {} (stderr: {})",
                        e, stderr_text
                    )
                }
            })?;
        if let Some(error) = result.get("error") {
            return Err(error.as_str().unwrap_or("Unknown error").to_string());
        }
        Ok(result)
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr_text = stderr_lines
            .lock()
            .ok()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default();
        eprintln!(
            "[segmentation][local][debug] python failure engine={} stdout_bytes={} stderr_buffered_lines={}",
            engine_key,
            output.stdout.len(),
            stderr_lines.lock().map(|lines| lines.len()).unwrap_or(0)
        );
        if !stdout.trim().is_empty() {
            eprintln!(
                "[segmentation][local][debug] python failure stdout: {}",
                stdout
            );
        }
        if !stderr_text.trim().is_empty() {
            eprintln!(
                "[segmentation][local][debug] python failure stderr: {}",
                stderr_text
            );
        }
        if let Some(Ok(error_json)) = serde_json::Deserializer::from_str(&stdout)
            .into_iter::<serde_json::Value>()
            .next()
        {
            if let Some(error) = error_json.get("error") {
                return Err(error.as_str().unwrap_or("Unknown error").to_string());
            }
        }

        let exit_status = output
            .status
            .code()
            .map(|code| format!("{} (0x{:08X})", code, code as u32))
            .unwrap_or_else(|| output.status.to_string());
        Err(serde_json::json!({
            "localSegmentationExitStatus": exit_status,
            "details": ([stdout.trim(), stderr_text.trim()]
                .into_iter()
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n"))
        })
        .to_string())
    }
}
/// ExÃ©cute la segmentation locale via moteur legacy Whisper.
pub async fn segment_quran_audio_local(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    whisper_model: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut extra_args: Vec<String> = Vec::new();
    if let Some(model) = whisper_model {
        extra_args.push("--whisper-model".to_string());
        extra_args.push(model);
    }

    run_local_segmentation_script(
        app_handle,
        LocalSegmentationEngine::LegacyWhisper,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        extra_args,
        None,
    )
}
/// ExÃ©cute la segmentation locale via moteur Multi-Aligner avec token HF obligatoire.
pub async fn segment_quran_audio_local_multi(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let selected_model = model_name.unwrap_or_else(|| "Base".to_string());
    if selected_model != "Base" && selected_model != "Large" {
        return Err(format!(
            "Invalid model_name '{}'. Expected 'Base' or 'Large'.",
            selected_model
        ));
    }

    let selected_device = device.unwrap_or_else(|| "GPU".to_string()).to_uppercase();
    if selected_device != "GPU" && selected_device != "CPU" {
        return Err(format!(
            "Invalid device '{}'. Expected 'GPU' or 'CPU'.",
            selected_device
        ));
    }

    let token_present = hf_token
        .as_ref()
        .map(|token| !token.trim().is_empty())
        .unwrap_or(false);
    if !token_present {
        return Err(
            "HF token with access to private models (hetchyy/r15_95m, hetchyy/r7) is required for local Multi-Aligner mode."
                .to_string(),
        );
    }

    let extra_args = vec![
        "--model-name".to_string(),
        selected_model,
        "--device".to_string(),
        selected_device,
    ];

    run_local_segmentation_script(
        app_handle,
        LocalSegmentationEngine::MultiAligner,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        extra_args,
        hf_token,
    )
}
/// Exécute le moteur historique FastConformer de QC-3.7.60.
pub async fn segment_quran_audio_local_word_timing_old(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
) -> Result<serde_json::Value, String> {
    run_local_segmentation_script(
        app_handle,
        LocalSegmentationEngine::QuranWordTimingOld,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        Vec::new(),
        None,
    )
}
/// Exécute la segmentation locale via le moteur hors-ligne WordTiming.
pub async fn segment_quran_audio_local_word_timing(
    app_handle: tauri::AppHandle,
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
) -> Result<serde_json::Value, String> {
    let mut extra_args = Vec::new();
    extra_args.push("--fast".to_string());

    run_local_segmentation_script(
        app_handle,
        LocalSegmentationEngine::QuranWordTiming,
        audio_path,
        audio_clips,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        extra_args,
        None,
    )
}
