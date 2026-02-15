use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
mod exporter;
mod binaries;
mod path_utils;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use reqwest::multipart::{Form, Part};
use tauri::Manager;

use font_kit::source::SystemSource;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Stockage global des process IDs d'export en cours
lazy_static::lazy_static! {
    static ref EXPORT_PROCESS_IDS: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));
    static ref DISCORD_CLIENT: Arc<Mutex<Option<DiscordIpcClient>>> = Arc::new(Mutex::new(None));
}

// Structure pour les paramètres Discord Rich Presence
#[derive(serde::Deserialize)]
struct DiscordActivity {
    details: Option<String>,
    state: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    party_size: Option<u32>,
    party_max: Option<u32>,
    start_timestamp: Option<i64>,
}

const FFPROBE_NOT_FOUND_ERROR: &str = "FFPROBE_NOT_FOUND";
const FFPROBE_NOT_EXECUTABLE_ERROR: &str = "FFPROBE_NOT_EXECUTABLE";
const FFPROBE_EXEC_FAILED_ERROR_PREFIX: &str = "FFPROBE_EXEC_FAILED:";
const QURAN_MULTI_ALIGNER_BASE_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api";
const QURAN_MULTI_ALIGNER_UPLOAD_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api/upload";
const QURAN_MULTI_ALIGNER_PROCESS_CALL_URL: &str =
    "https://hetchyy-quran-multi-aligner.hf.space/gradio_api/call/process_audio_session";
const QURAN_SEGMENTATION_USE_MOCK: bool = false;
const QURAN_SEGMENTATION_MOCK_PAYLOAD: &str = r#"
{
    "segments": [
        {
        "confidence": 0.5,
        "error": null,
        "matched_text": "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
        "ref_from": "Isti'adha",
        "ref_to": "Isti'adha",
        "segment": 1,
        "time_from": 0.63,
        "time_to": 6.11
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
        "ref_from": "Basmala",
        "ref_to": "Basmala",
        "segment": 2,
        "time_from": 7.99,
        "time_to": 13.53
    },
    {
        "confidence": 0.75,
        "error": null,
        "matched_text": "قُلْ هُوَ ٱللَّهُ أَحَدٌ",
        "ref_from": "112:1:1",
        "ref_to": "112:1:2",
        "segment": 3,
        "time_from": 15.15,
        "time_to": 18.05
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "ٱللَّهُ ٱلصَّمَدُ",
        "ref_from": "112:1:4",
        "ref_to": "112:1:4",
        "segment": 4,
        "time_from": 19.47,
        "time_to": 21.965
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "لَمْ يَلِدْ وَلَمْ يُولَدْ",
        "ref_from": "112:2:1",
        "ref_to": "112:2:2",
        "segment": 5,
        "time_from": 23.185,
        "time_to": 26.665
    },
    {
        "confidence": 1,
        "error": null,
        "matched_text": "وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدُۢ",
        "ref_from": "112:4:1",
        "ref_to": "112:4:5",
        "segment": 6,
        "time_from": 27.945,
        "time_to": 32.665
    }
    ]
}
"#;

// Simple guard to remove temp files even if we early-return on error.
struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SegmentationAudioClip {
    path: String,
    start_ms: i64,
    end_ms: i64,
}

#[derive(Clone, Copy, Debug)]
enum LocalSegmentationEngine {
    LegacyWhisper,
    MultiAligner,
}

impl LocalSegmentationEngine {
    fn from_raw(raw: &str) -> Result<Self, String> {
        match raw {
            "legacy" | "legacy_whisper" => Ok(Self::LegacyWhisper),
            "multi" | "multi_aligner" => Ok(Self::MultiAligner),
            _ => Err(format!(
                "Unknown local segmentation engine '{}'. Expected 'legacy' or 'multi'.",
                raw
            )),
        }
    }

    fn as_key(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "legacy",
            Self::MultiAligner => "multi",
        }
    }

    fn as_label(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "Legacy Whisper",
            Self::MultiAligner => "Multi-Aligner",
        }
    }

    fn requirements_relative_path(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "python/requirements.txt",
            Self::MultiAligner => "python/quran-multi-aligner/requirements.txt",
        }
    }

    fn script_relative_path(&self) -> &'static str {
        match self {
            Self::LegacyWhisper => "python/local_segmenter.py",
            Self::MultiAligner => "python/local_multi_aligner_segmenter.py",
        }
    }

    fn required_import_modules(&self) -> &'static [&'static str] {
        match self {
            Self::LegacyWhisper => &[
                "torch",
                "transformers",
                "librosa",
                "numpy",
                "soundfile",
            ],
            Self::MultiAligner => &[
                "torch",
                "transformers",
                "librosa",
                "numpy",
                "soundfile",
                "recitations_segmenter",
                "gradio",
                "accelerate",
                "pyarrow",
                "requests",
            ],
        }
    }
}

fn get_system_python_cmd() -> &'static str {
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    }
}

fn resolve_python_resource_path(
    app_handle: &tauri::AppHandle,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let resource_path = app_handle
        .path()
        .resolve(relative_path, tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    if resource_path.exists() {
        return Ok(resource_path);
    }

    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Cannot get executable directory")?
        .to_path_buf();

    let dev_path = exe_dir.join("..").join("..").join(relative_path);
    if dev_path.exists() {
        Ok(dev_path)
    } else {
        Err(format!("Path not found in resources or dev mode: {}", relative_path))
    }
}

fn get_local_venv_root(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let venv_root = app_data_dir.join("python_envs");
    fs::create_dir_all(&venv_root).map_err(|e| {
        format!(
            "Failed to create local python env directory '{}': {}",
            venv_root.to_string_lossy(),
            e
        )
    })?;
    Ok(venv_root)
}

fn get_engine_venv_path(
    app_handle: &tauri::AppHandle,
    engine: LocalSegmentationEngine,
) -> Result<PathBuf, String> {
    Ok(get_local_venv_root(app_handle)?.join(format!("seg-{}", engine.as_key())))
}

fn get_venv_python_exe(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python3")
    }
}

fn sanitize_cmd_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn apply_hf_token_env(cmd: &mut Command, token: &str) {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return;
    }

    // Different libs read different token env vars.
    cmd.env("HF_TOKEN", trimmed);
    cmd.env("HF_HUB_TOKEN", trimmed);
    cmd.env("HUGGING_FACE_HUB_TOKEN", trimmed);
}

fn run_python_import_check(
    python_exe: &Path,
    modules: &[&str],
) -> (bool, Vec<String>) {
    if !python_exe.exists() {
        return (false, modules.iter().map(|module| module.to_string()).collect());
    }

    let modules_json = serde_json::to_string(modules).unwrap_or_else(|_| "[]".to_string());
    let check_script = format!(
        r#"
from importlib.util import find_spec
import json
import sys

modules = {modules_json}
missing = []
for name in modules:
    try:
        if find_spec(name) is None:
            missing.append(name)
    except Exception:
        missing.append(name)

print(json.dumps(missing))
sys.exit(0 if not missing else 1)
"#
    );

    let mut cmd = Command::new(python_exe);
    cmd.args(["-c", &check_script]);
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let missing = serde_json::from_str::<Vec<String>>(&stdout).unwrap_or_default();
            (output.status.success(), missing)
        }
        Err(_) => (false, modules.iter().map(|module| module.to_string()).collect()),
    }
}

fn run_python_any_import_check(python_exe: &Path, candidates: &[&str]) -> bool {
    for module in candidates {
        let (ok, missing) = run_python_import_check(python_exe, &[*module]);
        if ok && missing.is_empty() {
            return true;
        }
    }
    false
}

fn create_venv_if_missing(
    app_handle: &tauri::AppHandle,
    engine: LocalSegmentationEngine,
) -> Result<PathBuf, String> {
    let venv_dir = get_engine_venv_path(app_handle, engine)?;
    let python_exe = get_venv_python_exe(&venv_dir);
    if python_exe.exists() {
        return Ok(venv_dir);
    }

    let system_python = get_system_python_cmd();
    let mut cmd = Command::new(system_python);
    cmd.args([
        "-m",
        "venv",
        venv_dir.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to create Python venv for {}: {}", engine.as_label(), e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to create Python venv for {}: {}",
            engine.as_label(),
            sanitize_cmd_error(&output)
        ));
    }

    if !python_exe.exists() {
        return Err(format!(
            "Python venv created for {} but python executable was not found at {}",
            engine.as_label(),
            python_exe.to_string_lossy()
        ));
    }

    Ok(venv_dir)
}

fn resolve_engine_python_exe(
    app_handle: &tauri::AppHandle,
    engine: LocalSegmentationEngine,
) -> Result<PathBuf, String> {
    let venv_dir = get_engine_venv_path(app_handle, engine)?;
    let python_exe = get_venv_python_exe(&venv_dir);
    if python_exe.exists() {
        Ok(python_exe)
    } else {
        Err(format!(
            "{} local environment is not installed yet. Install dependencies first.",
            engine.as_label()
        ))
    }
}

fn prepare_multi_requirements_file(source_path: &Path) -> Result<PathBuf, String> {
    let content = fs::read_to_string(source_path).map_err(|e| {
        format!(
            "Failed to read multi-aligner requirements '{}': {}",
            source_path.to_string_lossy(),
            e
        )
    })?;

    let patched_lines: Vec<String> = content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("git+https://github.com/Hetchy/Quranic-Phonemizer.git@") {
                "https://github.com/Hetchy/Quranic-Phonemizer/archive/1b6a8cc.zip".to_string()
            } else {
                line.to_string()
            }
        })
        .collect();

    let patched_path = std::env::temp_dir().join("qurancaption_multi_requirements_patched.txt");
    fs::write(&patched_path, patched_lines.join("\n")).map_err(|e| {
        format!(
            "Failed to write patched multi-aligner requirements '{}': {}",
            patched_path.to_string_lossy(),
            e
        )
    })?;
    Ok(patched_path)
}

fn prepare_windows_safe_quranic_phonemizer_source(python_exe: &Path) -> Result<PathBuf, String> {
    let source_root = std::env::temp_dir().join("qurancaption_quranic_phonemizer_1b6a8cc");
    let setup_py = source_root.join("setup.py");
    if setup_py.exists() {
        return Ok(source_root);
    }

    if source_root.exists() {
        fs::remove_dir_all(&source_root).map_err(|e| {
            format!(
                "Failed to clean previous Quranic-Phonemizer source '{}': {}",
                source_root.to_string_lossy(),
                e
            )
        })?;
    }
    fs::create_dir_all(&source_root).map_err(|e| {
        format!(
            "Failed to create Quranic-Phonemizer source directory '{}': {}",
            source_root.to_string_lossy(),
            e
        )
    })?;

    let patch_script = r#"
import io
import os
import pathlib
import shutil
import urllib.request
import zipfile

target = pathlib.Path(os.environ["QC_QP_TARGET"])
target.mkdir(parents=True, exist_ok=True)

url = "https://github.com/Hetchy/Quranic-Phonemizer/archive/1b6a8cc.zip"
raw = urllib.request.urlopen(url, timeout=120).read()

with zipfile.ZipFile(io.BytesIO(raw)) as zf:
    root_prefix = None
    for info in zf.infolist():
        name = info.filename
        if name.endswith("/"):
            continue
        if root_prefix is None:
            root_prefix = name.split("/", 1)[0] + "/"
        rel = name[len(root_prefix):] if name.startswith(root_prefix) else name
        rel = rel.replace("->", "-to-")
        out = target / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst)
"#;

    let mut cmd = Command::new(python_exe);
    cmd.args(["-c", patch_script]);
    cmd.env("QC_QP_TARGET", source_root.to_string_lossy().to_string());
    configure_command_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to patch Quranic-Phonemizer source on Windows: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to patch Quranic-Phonemizer source on Windows: {}",
            sanitize_cmd_error(&output)
        ));
    }

    if !setup_py.exists() {
        return Err(format!(
            "Patched Quranic-Phonemizer source is incomplete (missing setup.py at {})",
            setup_py.to_string_lossy()
        ));
    }

    Ok(source_root)
}

fn merge_audio_clips_for_segmentation(
    ffmpeg_path: &str,
    clips: &[SegmentationAudioClip],
) -> Result<(PathBuf, TempFileGuard), String> {
    if clips.is_empty() {
        return Err("No audio clips provided for merge".to_string());
    }

    let mut normalized: Vec<(PathBuf, i64, i64)> = Vec::new();
    for clip in clips {
        let path = path_utils::normalize_existing_path(&clip.path);
        if !path.exists() {
            return Err(format!(
                "Audio file not found: {}",
                path.to_string_lossy()
            ));
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

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(&["-y", "-hide_banner", "-loglevel", "error"]);
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
    cmd.args(&[
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

    let output = cmd.output().map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg merge error: {}", stderr));
    }

    Ok((merged_path, guard))
}

fn configure_command_no_window(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn map_ffprobe_resolve_error(err: binaries::BinaryResolveError) -> String {
    match err.code.as_str() {
        "BINARY_NOT_FOUND" => FFPROBE_NOT_FOUND_ERROR.to_string(),
        "BINARY_NOT_EXECUTABLE" => {
            format!("{}: {}", FFPROBE_NOT_EXECUTABLE_ERROR, err.details)
        }
        "BINARY_EXEC_FAILED" => format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, err.details),
        _ => format!("{}{}", FFPROBE_EXEC_FAILED_ERROR_PREFIX, err.details),
    }
}

fn format_ffprobe_exec_failed(details: &str) -> String {
    format!(
        "{}{}",
        FFPROBE_EXEC_FAILED_ERROR_PREFIX,
        details.trim()
    )
}

#[derive(serde::Serialize)]
struct BinaryDiagnosticResult {
    name: String,
    resolved_path: Option<String>,
    error_code: Option<String>,
    error_details: Option<String>,
    attempts: Vec<binaries::BinaryResolutionAttempt>,
    version_output: Option<String>,
}

fn get_binary_version_line(binary_path: &str) -> Option<String> {
    let mut cmd = Command::new(binary_path);
    cmd.arg("-version");
    configure_command_no_window(&mut cmd);
    match cmd.output() {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.lines().next().map(|line| line.trim().to_string())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let line = stderr.lines().next().unwrap_or("").trim().to_string();
            if line.is_empty() {
                None
            } else {
                Some(line)
            }
        }
        Err(_) => None,
    }
}

#[tauri::command]
fn diagnose_media_binaries() -> Vec<BinaryDiagnosticResult> {
    ["ffmpeg", "ffprobe", "yt-dlp"]
        .iter()
        .map(|name| {
            let debug = binaries::resolve_binary_debug(name);
            let version_output = debug
                .resolved_path
                .as_deref()
                .and_then(get_binary_version_line);

            BinaryDiagnosticResult {
                name: debug.name,
                resolved_path: debug.resolved_path,
                error_code: debug.error_code,
                error_details: debug.error_details,
                attempts: debug.attempts,
                version_output,
            }
        })
        .collect()
}

#[tauri::command]
async fn download_from_youtube(
    url: String,
    _type: String,
    download_path: String,
) -> Result<String, String> {
    let download_path_buf = path_utils::normalize_input_path(&download_path);
    let download_path_str = download_path_buf.to_string_lossy().to_string();
    // Créer le dossier de téléchargement s'il n'existe pas
    if let Err(e) = fs::create_dir_all(&download_path_buf) {
        return Err(format!("Unable to create directory: {}", e));
    }

    let yt_dlp_path = binaries::resolve_binary("yt-dlp")
        .ok_or_else(|| "yt-dlp binary not found".to_string())?;

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    let ffmpeg_dir = Path::new(&ffmpeg_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string());

    // Configuration selon le type (audio ou vidéo)
    let mut args: Vec<&str> = vec!["--force-ipv4"];
    
    // Ajouter le chemin vers le dossier contenant ffmpeg et ffprobe
    // Créer une variable statique pour garder la valeur en mémoire
    let ffmpeg_dir_str;
    if let Some(dir) = ffmpeg_dir {
        ffmpeg_dir_str = dir;
        args.push("--ffmpeg-location");
        args.push(&ffmpeg_dir_str);
    }

    // Pattern de sortie avec le titre de la vidéo et le nom de la chaîne
    let output_pattern = format!("{}/%(title)s (%(uploader)s).%(ext)s", download_path_str);

    match _type.as_str() {
        "audio" => {
            // Pour l'audio : qualité maximale, format MP3, bitrate constant
            args.extend_from_slice(&[
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0", // Qualité maximale
                "--postprocessor-args",
                "ffmpeg:-b:a 320k -ar 44100", // Bitrate constant 320k
                "-o",
                &output_pattern,
            ]);
        }
        "video" => {
            // Pour la vidéo : 1080p ou moins, format MP4, bitrate constant
            args.extend_from_slice(&[
                "--format",
                "best[height<=1080][ext=mp4]/best[ext=mp4]/best",
                "--merge-output-format",
                "mp4",
                "--postprocessor-args",
                "ffmpeg:-b:v 2000k -maxrate 2000k -bufsize 4000k -b:a 128k",
                "-o",
                &output_pattern,
            ]);
        }
        _ => {
            return Err("Invalid type: must be 'audio' or 'video'".to_string());
        }
    }

    // Ajouter l'URL à la fin
    args.push(&url);

    // Exécuter yt-dlp
    let mut cmd = Command::new(&yt_dlp_path);
    cmd.args(&args);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                println!("yt-dlp output: {}", output_str);

                // Chercher le fichier téléchargé dans le dossier
                let extension = if _type == "audio" { "mp3" } else { "mp4" };

                // Lire le dossier pour trouver le fichier téléchargé
                match fs::read_dir(&download_path_buf) {
                    Ok(entries) => {
                        for entry in entries {
                            if let Ok(entry) = entry {
                                let path = entry.path();
                                if let Some(ext) = path.extension() {
                                    if ext == extension {
                                        let file_path = path.to_string_lossy().to_string();
                                        return Ok(file_path);
                                    }
                                }
                            }
                        }
                        Err("Downloaded file not found".to_string())
                    }
                    Err(e) => Err(format!("Error reading directory: {}", e)),
                }



            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let stdout = String::from_utf8_lossy(&result.stdout);
                Err(format!("yt-dlp error: {}\n{}", stderr, stdout))
            }
        }
        Err(e) => Err(format!("Unable to execute yt-dlp: {}", e)),
    }
}

// Fonction pour obtenir la durée précise du fichier téléchargé avec ffprobe
#[tauri::command]
fn get_duration(file_path: &str) -> Result<i64, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    // If the file does not exist, return -1
    if !file_path.exists() {
        return Ok(-1);
    }

    let ffprobe_path = match binaries::resolve_binary_detailed("ffprobe") {
        Ok(p) => p,
        Err(err) => return Err(map_ffprobe_resolve_error(err)),
    };

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args(&[
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file_path.to_string_lossy().as_ref(),
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                let duration_line = output_str.trim();

                if let Ok(duration_seconds) = duration_line.parse::<f64>() {
                    // Convertir en millisecondes avec précision
                    Ok((duration_seconds * 1000.0).round() as i64)
                } else {
                    Err("Unable to parse duration from ffprobe output".to_string())
                }
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format_ffprobe_exec_failed(&stderr))
            }
        }
        Err(e) => Err(format_ffprobe_exec_failed(&format!(
            "Unable to execute ffprobe: {}",
            e
        ))),
    }
}

#[tauri::command]
fn get_new_file_path(start_time: u64, asset_name: &str) -> Result<String, String> {
    // get download directory folder (on windows, macos and linux)
    let download_path = dirs::download_dir()
        .ok_or_else(|| "Unable to determine download directory".to_string())?
        .to_string_lossy()
        .to_string();

    // Search for a file whose creation date is > start_time
    let entries = fs::read_dir(&download_path)
        .map_err(|e| format!("Unable to read download directory: {}", e))?;

    for entry in entries {
        if let Ok(entry) = entry {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(created) = metadata.created() {
                    let created_time = created
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|_| "Time went backwards")?
                        .as_millis() as u64;

                    // If the creation date is greater than start_time, check the file name
                    if created_time > start_time {
                        let file_path = entry.path();
                        let file_path_str = file_path.to_string_lossy().to_string();
                        let asset_name_trimmed = asset_name.trim();

                        // Check if the file name contains the asset name
                        if file_path_str.contains(asset_name_trimmed) {
                            return Ok(file_path_str);
                        } else {
                            return Ok(file_path_str);
                        }

                    }
                }
            }
        }
    }
    Err("Downloaded file not found".to_string())
}


#[tauri::command]
fn save_binary_file(path: String, content: Vec<u8>) -> Result<(), String> {
    let path_buf = path_utils::normalize_output_path(&path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path_buf, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn save_file(location: String, content: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_output_path(&location);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path_buf, content).map_err(|e| format!("Failed to write file: {}", e))
}


#[tauri::command]
async fn download_file(url: String, path: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_output_path(&path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    tokio::fs::write(&path_buf, &bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let path_buf = path_utils::normalize_existing_path(&path);
    fs::remove_file(path_buf).map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
fn move_file(source: String, destination: String) -> Result<(), String> {
    let source_path = path_utils::normalize_existing_path(&source);
    let dest_path = path_utils::normalize_output_path(&destination);
    
    // If destination exists, remove it first to force the move
    if dest_path.exists() {
        std::fs::remove_file(&dest_path).map_err(|e| e.to_string())?;
    }
    
    // Try rename first (works if on same drive/filesystem)
    match std::fs::rename(&source_path, &dest_path) {
        Ok(()) => Ok(()),
        Err(e) => {
            // If rename fails with cross-device error (Windows: 17, Unix: 18), do copy + delete
            if e.raw_os_error() == Some(17) || e.raw_os_error() == Some(18) {
                // Copy the file
                std::fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;
                // Remove the original
                std::fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

#[tauri::command]
fn get_system_fonts() -> Result<Vec<String>, String> {
    let source = SystemSource::new();
    let fonts = source.all_fonts().map_err(|e| e.to_string())?;
    let mut font_names = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    for font in fonts {
        // Load the font to get its properties
        let handle = font.load().map_err(|e| e.to_string())?;
        let family = handle.family_name();
        
        // Only add the font name if we haven't seen it before
        if seen_names.insert(family.clone()) {
            font_names.push(family);
        }
    }

    // Sort the font names alphabetically for better usability
    font_names.sort();
    Ok(font_names)
}

#[tauri::command]
fn open_explorer_with_file_selected(file_path: String) -> Result<(), String> {
    let path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = path.to_string_lossy().to_string();
    
    // Vérifier que le fichier existe
    if !path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    #[cfg(target_os = "windows")]
    {
        // Sur Windows, utiliser explorer.exe avec /select pour sélectionner le fichier
        // Note: explorer.exe peut retourner un code de sortie non-zéro même en cas de succès
        let mut cmd = Command::new("explorer");
        cmd.args(&["/select,", &file_path_str]);
        configure_command_no_window(&mut cmd);
        let output = cmd.output();

        match output {
            Ok(_) => {
                // Si la commande a pu être exécutée, on considère que c'est un succès
                // car explorer.exe peut retourner des codes de sortie non-zéro même quand ça marche
                Ok(())
            }
            Err(e) => Err(format!("Failed to execute explorer command: {}", e))
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Sur macOS, utiliser 'open' avec -R pour révéler le fichier dans Finder
        let output = Command::new("open")
            .args(&["-R", &file_path_str])
            .output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    // Fallback: ouvrir juste le dossier parent
                    if let Some(parent) = path.parent() {
                        let fallback_output = Command::new("open")
                            .arg(parent)
                            .output();
                        
                        match fallback_output {
                            Ok(fallback_result) => {
                                if fallback_result.status.success() {
                                    Ok(())
                                } else {
                                    Err("Failed to open Finder".to_string())
                                }
                            }
                            Err(e) => Err(format!("Failed to execute open command: {}", e))
                        }
                    } else {
                        Err("Failed to open Finder and no parent directory found".to_string())
                    }
                }
            }
            Err(e) => Err(format!("Failed to execute open command: {}", e))
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Sur Linux, essayer plusieurs gestionnaires de fichiers
        let file_managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja"];
        let parent_dir = path.parent().ok_or("No parent directory found")?;
        
        for manager in &file_managers {
            let output = Command::new(manager)
                .arg(parent_dir)
                .output();
                
            match output {
                Ok(result) => {
                    if result.status.success() {
                        return Ok(());
                    }
                }
                Err(_) => continue, // Essayer le gestionnaire suivant
            }
        }
        
        // Fallback: utiliser xdg-open pour ouvrir le dossier parent
        let output = Command::new("xdg-open")
            .arg(parent_dir)
            .output();

        match output {
            Ok(result) => {
                if result.status.success() {
                    Ok(())
                } else {
                    Err("Failed to open file manager".to_string())
                }
            }
            Err(e) => Err(format!("Failed to execute xdg-open command: {}", e))
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        // Pour les autres OS, juste retourner une erreur
        Err("Unsupported operating system".to_string())
    }
}

#[tauri::command]
fn get_video_dimensions(file_path: &str) -> Result<serde_json::Value, String> {
    let file_path = path_utils::normalize_existing_path(file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    // Vérifier que le fichier existe
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    let ffprobe_path = binaries::resolve_binary_detailed("ffprobe")
        .map_err(map_ffprobe_resolve_error)?;

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args(&[
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "v:0", // Sélectionner le premier stream vidéo
        &file_path_str,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let output_str = String::from_utf8_lossy(&result.stdout);
                
                // Parser le JSON de ffprobe
                let json_value: serde_json::Value = serde_json::from_str(&output_str)
                    .map_err(|e| format!("Failed to parse ffprobe JSON output: {}", e))?;
                
                // Extraire les dimensions du premier stream vidéo
                if let Some(streams) = json_value.get("streams") {
                    if let Some(stream) = streams.get(0) {
                        let width = stream.get("width")
                            .and_then(|w| w.as_i64())
                            .unwrap_or(0);
                        let height = stream.get("height")
                            .and_then(|h| h.as_i64())
                            .unwrap_or(0);
                        
                        return Ok(serde_json::json!({
                            "width": width,
                            "height": height
                        }));
                    }
                }
                
                Err("No video stream found in file".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format_ffprobe_exec_failed(&stderr))
            }
        }
        Err(e) => Err(format_ffprobe_exec_failed(&format!(
            "Unable to execute ffprobe: {}",
            e
        ))),
    }
}

#[tauri::command]
fn cut_audio(source_path: String, start_ms: u64, end_ms: u64, output_path: String) -> Result<(), String> {
    // Vérifier que le fichier source existe
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Convertir les millisecondes en secondes pour ffmpeg (format HH:MM:SS.ms)
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;

    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
        "-ss", &start_secs.to_string(),
        "-t", &duration_secs.to_string(),
        "-i", &source_path,
        "-c", "copy", // On copie le flux pour garder le format original sans ré-encoder
        "-y",        // Overwrite output file
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);
    
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                // Si la copie brute échoue (parfois dû à des problèmes de bitstream), 
                // on peut tenter un ré-encodage minimal si c'est nécessaire.
                // Pour l'instant on reste sur copy car c'est plus rapide et préserve la qualité.
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

#[tauri::command]
fn cut_video(source_path: String, start_ms: u64, end_ms: u64, output_path: String) -> Result<(), String> {
    // VÇ¸rifier que le fichier source existe
    if !std::path::Path::new(&source_path).exists() {
        return Err(format!("Source file not found: {}", source_path));
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Convertir les millisecondes en secondes pour ffmpeg (format HH:MM:SS.ms)
    let start_secs = start_ms as f64 / 1000.0;
    let duration_secs = (end_ms as f64 - start_ms as f64) / 1000.0;

    if duration_secs <= 0.0 {
        return Err("Duration must be positive".to_string());
    }

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
        "-ss", &start_secs.to_string(),
        "-t", &duration_secs.to_string(),
        "-i", &source_path,
        "-map", "0",
        "-c", "copy", // On copie le flux pour garder le format original sans rÇ¸-encoder
        "-y",        // Overwrite output file
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);

    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

#[tauri::command]
fn concat_audio(source_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if source_paths.is_empty() {
        return Err("No source files provided".to_string());
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Create a temporary file for the concat list
    let temp_dir = std::env::temp_dir();
    let list_file_path = temp_dir.join(format!("concat_audio_{}.txt", 
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()));
    
    let mut list_content = String::new();
    for path in &source_paths {
        // Enclose in single quotes for ffmpeg concat demuxer
        // single quotes in the path should be escaped as '\''
        let escaped_path = path.replace("'", "'\\''");
        list_content.push_str(&format!("file '{}'\n", escaped_path));
    }

    fs::write(&list_file_path, list_content)
        .map_err(|e| format!("Failed to write concat list: {}", e))?;

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
        "-f", "concat",
        "-safe", "0",
        "-i", &list_file_path.to_string_lossy(),
        "-c", "copy",
        "-y",
        &output_path,
    ]);
    configure_command_no_window(&mut cmd);

    let output = cmd.output();

    // Clean up
    let _ = fs::remove_file(&list_file_path);

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => Err(format!("Unable to execute ffmpeg: {}", e)),
    }
}

#[tauri::command]
fn convert_audio_to_cbr(file_path: String) -> Result<(), String> {
    let file_path = path_utils::normalize_existing_path(&file_path);
    let file_path_str = file_path.to_string_lossy().to_string();
    // Vérifier que le fichier existe
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path_str));
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // Extraire l'extension du fichier d'origine
    let extension = file_path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("mp4");
    
    // Créer un fichier temporaire avec la même extension
    let file_stem = file_path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("temp");
    let temp_path = if let Some(parent_dir) = file_path.parent() {
        parent_dir.join(format!("{}_temp.{}", file_stem, extension))
    } else {
        PathBuf::from(format!("{}_temp.{}", file_stem, extension))
    };

    // Commande ffmpeg pour convertir en CBR - adapter selon le type de fichier
    let mut cmd = Command::new(&ffmpeg_path);
    
    // Détecter si c'est un fichier audio ou vidéo basé sur l'extension
    let is_audio_only = matches!(extension.to_lowercase().as_str(), "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a");
    
    if is_audio_only {
        // Pour les fichiers audio seulement - paramètres identiques à Audacity
        cmd.args(&[
            "-i", &file_path_str,
            "-codec:a", "libmp3lame",    // Encodeur LAME comme Audacity
            "-b:a", "192k",              // Bitrate constant 192k comme dans l'image
            "-cbr", "1",                 // Force CBR (Constant Bitrate)
            "-ar", "44100",              // Sample rate 44100 Hz comme Audacity
            "-ac", "2",                  // Stéréo comme Audacity
            "-f", "mp3",                 // Format MP3
            "-y",                        // Overwrite output file
            temp_path.to_string_lossy().as_ref(),
        ]);
    } else {
        // Pour les fichiers vidéo
        cmd.args(&[
            "-i", &file_path_str,
            "-b:v", "1200k",         // Bitrate vidéo
            "-minrate", "1200k",     // Bitrate minimum
            "-maxrate", "1200k",     // Bitrate maximum
            "-bufsize", "1200k",     // Buffer size
            "-b:a", "64k",           // Bitrate audio
            "-vcodec", "libx264",    // Codec vidéo
            "-acodec", "aac",        // Codec audio
            "-strict", "-2",         // Strict mode
            "-ac", "2",              // Canaux audio (stéréo)
            "-ar", "44100",          // Sample rate
            "-s", "320x240",         // Résolution vidéo
            "-y",                    // Overwrite output file
            temp_path.to_string_lossy().as_ref(),
        ]);
    }
    configure_command_no_window(&mut cmd);
    
    let output = cmd.output();

    match output {
        Ok(result) => {
            if result.status.success() {
                // Remplacer le fichier original par le fichier converti
                if let Err(e) = std::fs::remove_file(&file_path) {
                    return Err(format!("Failed to remove original file: {}", e));
                }
                if let Err(e) = std::fs::rename(&temp_path, &file_path) {
                    return Err(format!("Failed to replace original file: {}", e));
                }
                Ok(())
            } else {
                // Nettoyer le fichier temporaire en cas d'erreur
                let _ = std::fs::remove_file(&temp_path);
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("ffmpeg error: {}", stderr))
            }
        }
        Err(e) => {
            // Nettoyer le fichier temporaire en cas d'erreur
            let _ = std::fs::remove_file(&temp_path);
            Err(format!("Unable to execute ffmpeg: {}", e))
        }
    }
}

#[tauri::command]
async fn segment_quran_audio(
    audio_path: Option<String>,
    audio_clips: Option<Vec<SegmentationAudioClip>>,
    min_silence_ms: Option<u32>,
    min_speech_ms: Option<u32>,
    pad_ms: Option<u32>,
    model_name: Option<String>,
    device: Option<String>,
) -> Result<serde_json::Value, String> {
    // Early-return mock payload to avoid external API calls during testing.
    if QURAN_SEGMENTATION_USE_MOCK {
        return serde_json::from_str(QURAN_SEGMENTATION_MOCK_PAYLOAD)
            .map_err(|e| format!("Mock segmentation JSON invalid: {}", e));
    }

    // Resolve ffmpeg so we can merge (if needed) and resample to 16kHz mono as required by the API.
    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    let mut _merged_guard: Option<TempFileGuard> = None;
    let audio_path = if let Some(clips) = audio_clips.as_ref().filter(|c| !c.is_empty()) {
        println!(
            "[segmentation] Merging {} audio clip(s) for cloud segmentation",
            clips.len()
        );
        for (idx, clip) in clips.iter().enumerate() {
            println!(
                "[segmentation] clip[{}] path={} start_ms={} end_ms={}",
                idx, clip.path, clip.start_ms, clip.end_ms
            );
        }
        let needs_merge = clips.len() > 1 || clips[0].start_ms > 0;
        if needs_merge {
            let (merged_path, guard) = merge_audio_clips_for_segmentation(&ffmpeg_path, clips)?;
            _merged_guard = Some(guard);
            println!(
                "[segmentation] Using merged audio for cloud: {}",
                merged_path.to_string_lossy()
            );
            merged_path
        } else {
            path_utils::normalize_existing_path(&clips[0].path)
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

    // Build a unique temp file path for the resampled WAV.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!("qurancaption-seg-{}.wav", stamp));
    let _temp_guard = TempFileGuard(temp_path.clone());

    // Resample to 16kHz mono WAV with ffmpeg.
    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
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
    configure_command_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr));
    }

    // Read the resampled file into memory for upload.
    let audio_bytes =
        fs::read(&temp_path).map_err(|e| format!("Failed to read resampled audio: {}", e))?;

    // Upload the file to the Gradio space and get a server-side path back.
    let client = reqwest::Client::new();
    let upload_part = Part::bytes(audio_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let upload_form = Form::new().part("files", upload_part);

    let upload_response = client
        .post(QURAN_MULTI_ALIGNER_UPLOAD_URL)
        .multipart(upload_form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Upload request error: {}", e))?;

    let uploaded_paths: Vec<String> = upload_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload response: {}", e))?;

    let uploaded_path = uploaded_paths
        .get(0)
        .ok_or_else(|| "Upload response was empty".to_string())?;

    let selected_model = model_name.unwrap_or_else(|| "Base".to_string());
    if selected_model != "Base" && selected_model != "Large" {
        return Err(format!(
            "Invalid model_name '{}'. Expected 'Base' or 'Large'.",
            selected_model
        ));
    }

    let selected_device = device
        .unwrap_or_else(|| "GPU".to_string())
        .to_uppercase();
    if selected_device != "GPU" && selected_device != "CPU" {
        return Err(format!(
            "Invalid device '{}'. Expected 'GPU' or 'CPU'.",
            selected_device
        ));
    }

    // Build the API payload in Gradio modern "call" format.
    let file_payload = serde_json::json!({
        "path": uploaded_path,
        "orig_name": "audio.wav",
        "mime_type": "audio/wav",
        "meta": { "_type": "gradio.FileData" }
    });
    let call_payload = serde_json::json!({
        "data": [
            file_payload,
            min_silence_ms.unwrap_or(200),
            min_speech_ms.unwrap_or(1000),
            pad_ms.unwrap_or(100),
            selected_model,
            selected_device
        ]
    });

    // Start the remote job.
    let call_response = client
        .post(QURAN_MULTI_ALIGNER_PROCESS_CALL_URL)
        .json(&call_payload)
        .send()
        .await
        .map_err(|e| format!("Process call failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Process call error: {}", e))?;

    let call_json: serde_json::Value = call_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse process call response: {}", e))?;

    let event_id = call_json
        .get("event_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Process call did not return an event_id".to_string())?
        .to_string();

    // Read the SSE completion stream.
    let stream_url = format!(
        "{}/call/process_audio_session/{}",
        QURAN_MULTI_ALIGNER_BASE_URL, event_id
    );
    let sse_text = client
        .get(&stream_url)
        .send()
        .await
        .map_err(|e| format!("Process stream request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read process stream: {}", e))?;

    // Parse SSE events and prioritize the "complete" event payload.
    let mut current_event = String::new();
    let mut current_data = String::new();
    let mut latest_payload: Option<serde_json::Value> = None;
    let mut complete_payload: Option<serde_json::Value> = None;

    for raw_line in sse_text
        .lines()
        .chain(std::iter::once(""))
    {
        let line = raw_line.trim_end();
        if line.is_empty() {
            let data_block = current_data.trim();
            if !data_block.is_empty() {
                if data_block == "[DONE]" {
                    current_event.clear();
                    current_data.clear();
                    continue;
                }

                let payload: serde_json::Value = serde_json::from_str(data_block)
                    .map_err(|e| format!("Failed to parse process stream payload: {}", e))?;

                if current_event == "error" {
                    if let Some(error_message) = payload
                        .get("error")
                        .and_then(|value| value.as_str())
                    {
                        return Err(format!("Cloud segmentation stream error: {}", error_message));
                    }
                    return Err(format!("Cloud segmentation stream error: {}", payload));
                }

                if !payload.is_null() {
                    latest_payload = Some(payload.clone());
                    if current_event == "complete" {
                        complete_payload = Some(payload);
                    }
                }
            }

            current_event.clear();
            current_data.clear();
            continue;
        }

        if let Some(event_value) = line.strip_prefix("event:") {
            current_event = event_value.trim().to_string();
            continue;
        }

        if let Some(data_value) = line.strip_prefix("data:") {
            if !current_data.is_empty() {
                current_data.push('\n');
            }
            current_data.push_str(data_value.trim());
        }
    }

    let payload = complete_payload
        .or(latest_payload)
        .ok_or_else(|| "Process stream ended without a result".to_string())?;

    // Gradio /call streams component outputs as: [ { ... } ]
    if let Some(values) = payload.as_array() {
        if let Some(first) = values.first() {
            return Ok(first.clone());
        }
    }

    Ok(payload)
}

/// Check if Python and required packages are available for local segmentation
/// This is async to avoid blocking the UI thread during slow Python imports
#[tauri::command]
async fn check_local_segmentation_ready(
    app_handle: tauri::AppHandle,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    use tokio::time::{timeout, Duration};

    let token_provided = hf_token
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);

    // Run the blocking checks in a background thread with a timeout
    let check_result = timeout(
        Duration::from_secs(25), // find_spec-based checks should stay fast
        tokio::task::spawn_blocking(move || {
            let python_cmd = get_system_python_cmd();

            // Check if Python is available (quick check)
            let mut cmd = Command::new(python_cmd);
            cmd.args(&["--version"]);
            configure_command_no_window(&mut cmd);

            let python_available = match cmd.output() {
                Ok(output) => output.status.success(),
                Err(_) => false,
            };

            if !python_available {
                return serde_json::json!({
                    "ready": false,
                    "pythonInstalled": false,
                    "packagesInstalled": false,
                    "message": "Python is not installed. Please install Python 3.10+ from python.org",
                    "engines": {
                        "legacy": {
                            "ready": false,
                            "venvExists": false,
                            "packagesInstalled": false,
                            "usable": false,
                            "message": "Python not installed"
                        },
                        "multi": {
                            "ready": false,
                            "venvExists": false,
                            "packagesInstalled": false,
                            "tokenRequired": true,
                            "tokenProvided": token_provided,
                            "usable": false,
                            "message": "Python not installed"
                        }
                    }
                });
            }

            let legacy_venv = match get_engine_venv_path(&app_handle, LocalSegmentationEngine::LegacyWhisper) {
                Ok(path) => path,
                Err(error) => {
                    return serde_json::json!({
                        "ready": false,
                        "pythonInstalled": true,
                        "packagesInstalled": false,
                        "message": format!("Failed to resolve local env paths: {}", error),
                        "engines": {
                            "legacy": {
                                "ready": false,
                                "venvExists": false,
                                "packagesInstalled": false,
                                "usable": false,
                                "message": "Failed to resolve local env path"
                            },
                            "multi": {
                                "ready": false,
                                "venvExists": false,
                                "packagesInstalled": false,
                                "tokenRequired": true,
                                "tokenProvided": token_provided,
                                "usable": false,
                                "message": "Failed to resolve local env path"
                            }
                        }
                    });
                }
            };
            let multi_venv = match get_engine_venv_path(&app_handle, LocalSegmentationEngine::MultiAligner) {
                Ok(path) => path,
                Err(error) => {
                    return serde_json::json!({
                        "ready": false,
                        "pythonInstalled": true,
                        "packagesInstalled": false,
                        "message": format!("Failed to resolve local env paths: {}", error),
                        "engines": {
                            "legacy": {
                                "ready": false,
                                "venvExists": false,
                                "packagesInstalled": false,
                                "usable": false,
                                "message": "Failed to resolve local env path"
                            },
                            "multi": {
                                "ready": false,
                                "venvExists": false,
                                "packagesInstalled": false,
                                "tokenRequired": true,
                                "tokenProvided": token_provided,
                                "usable": false,
                                "message": "Failed to resolve local env path"
                            }
                        }
                    });
                }
            };

            let legacy_python = get_venv_python_exe(&legacy_venv);
            let multi_python = get_venv_python_exe(&multi_venv);

            let legacy_venv_exists = legacy_python.exists();
            let multi_venv_exists = multi_python.exists();

            let (legacy_imports_ok, legacy_missing_modules) = run_python_import_check(
                &legacy_python,
                LocalSegmentationEngine::LegacyWhisper.required_import_modules(),
            );
            let (multi_imports_ok, multi_missing_modules) = run_python_import_check(
                &multi_python,
                LocalSegmentationEngine::MultiAligner.required_import_modules(),
            );
            // Quranic-Phonemizer exposes `core.phonemizer` in current builds.
            // Keep a fallback candidate to avoid false negatives across package layouts.
            let multi_phonemizer_ok = run_python_any_import_check(
                &multi_python,
                &["core.phonemizer", "quranic_phonemizer"],
            );

            let legacy_packages = legacy_imports_ok;
            let multi_packages = multi_imports_ok && multi_phonemizer_ok;

            let legacy_ready = legacy_venv_exists && legacy_packages;
            let multi_ready = multi_venv_exists && multi_packages;
            let multi_usable = multi_ready && token_provided;
            let any_ready = legacy_ready || multi_usable;

            let overall_message = if any_ready {
                "Local segmentation is ready".to_string()
            } else if legacy_ready && !multi_usable {
                "Legacy local engine is ready. Multi-aligner requires a Hugging Face token.".to_string()
            } else if !legacy_venv_exists && !multi_venv_exists {
                "Local engines are not installed yet. Install dependencies for Legacy Whisper and/or Multi-Aligner.".to_string()
            } else {
                "Local engines need setup or a valid Hugging Face token for Multi-Aligner.".to_string()
            };

            serde_json::json!({
                "ready": any_ready,
                "pythonInstalled": true,
                "packagesInstalled": legacy_ready || multi_ready,
                "message": overall_message,
                "engines": {
                    "legacy": {
                        "ready": legacy_ready,
                        "venvExists": legacy_venv_exists,
                        "packagesInstalled": legacy_packages,
                        "usable": legacy_ready,
                        "message": if legacy_ready {
                            "Legacy Whisper local engine is ready".to_string()
                        } else if !legacy_venv_exists {
                            "Legacy Whisper dependencies are not installed".to_string()
                        } else if !legacy_missing_modules.is_empty() {
                            format!(
                                "Legacy Whisper packages are incomplete (missing imports: {})",
                                legacy_missing_modules.join(", ")
                            )
                        } else {
                            "Legacy Whisper packages are incomplete".to_string()
                        }
                    },
                    "multi": {
                        "ready": multi_ready,
                        "venvExists": multi_venv_exists,
                        "packagesInstalled": multi_packages,
                        "tokenRequired": true,
                        "tokenProvided": token_provided,
                        "usable": multi_usable,
                        "message": if multi_usable {
                            "Multi-Aligner local engine is ready".to_string()
                        } else if !multi_venv_exists {
                            "Multi-Aligner dependencies are not installed".to_string()
                        } else if !multi_imports_ok {
                            if !multi_missing_modules.is_empty() {
                                format!(
                                    "Multi-Aligner packages are incomplete (missing imports: {})",
                                    multi_missing_modules.join(", ")
                                )
                            } else {
                                "Multi-Aligner packages are incomplete".to_string()
                            }
                        } else if !multi_phonemizer_ok {
                            "Multi-Aligner phonemizer dependency is incomplete".to_string()
                        } else if !token_provided {
                            "Multi-Aligner requires a Hugging Face token".to_string()
                        } else {
                            "Multi-Aligner packages are incomplete".to_string()
                        }
                    }
                }
            })
        })
    ).await;

    match check_result {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(e)) => Err(format!("Task failed: {}", e)),
        Err(_) => {
            // Timeout occurred - return a safe default
            Ok(serde_json::json!({
                "ready": false,
                "pythonInstalled": true,
                "packagesInstalled": false,
                "message": "Check timed out - packages may need to be installed",
                "engines": {
                    "legacy": {
                        "ready": false,
                        "venvExists": false,
                        "packagesInstalled": false,
                        "usable": false,
                        "message": "Check timed out"
                    },
                    "multi": {
                        "ready": false,
                        "venvExists": false,
                        "packagesInstalled": false,
                        "tokenRequired": true,
                        "tokenProvided": token_provided,
                        "usable": false,
                        "message": "Check timed out"
                    }
                }
            }))
        }
    }
}

/// Install Python dependencies for local segmentation
#[tauri::command]
async fn install_local_segmentation_deps(
    app_handle: tauri::AppHandle,
    engine: String,
    hf_token: Option<String>,
) -> Result<String, String> {
    use tauri::Emitter;

    let selected_engine = LocalSegmentationEngine::from_raw(engine.as_str())?;

    // Helper to emit install status
    let emit_status = |message: &str| {
        let _ = app_handle.emit("install-status", serde_json::json!({ "message": message }));
    };

    let system_python = get_system_python_cmd();
    let mut py_check = Command::new(system_python);
    py_check.arg("--version");
    configure_command_no_window(&mut py_check);
    let py_output = py_check
        .output()
        .map_err(|e| format!("Python is required to install local dependencies: {}", e))?;
    if !py_output.status.success() {
        return Err("Python is required to install local dependencies.".to_string());
    }

    emit_status(&format!(
        "Preparing {} local environment...",
        selected_engine.as_label()
    ));
    let venv_dir = create_venv_if_missing(&app_handle, selected_engine)?;
    let python_exe = get_venv_python_exe(&venv_dir);
    let normalized_hf_token = hf_token
        .as_ref()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty());

    let run_python_cmd = |args: &[&str], context: &str| -> Result<(), String> {
        let mut cmd = Command::new(&python_exe);
        cmd.args(args);
        if let Some(token) = normalized_hf_token.as_deref() {
            apply_hf_token_env(&mut cmd, token);
        }
        configure_command_no_window(&mut cmd);
        let output = cmd
            .output()
            .map_err(|e| format!("{}: failed to run python: {}", context, e))?;
        if !output.status.success() {
            return Err(format!("{}: {}", context, sanitize_cmd_error(&output)));
        }
        Ok(())
    };

    emit_status("Upgrading pip...");
    run_python_cmd(
        &["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "--quiet"],
        "Failed to upgrade pip",
    )?;

    if cfg!(target_os = "windows") {
        emit_status("Installing PyTorch (CPU fallback available)...");
        let mut cuda_installed = false;
        let mut nvidia_cmd = Command::new("nvidia-smi");
        configure_command_no_window(&mut nvidia_cmd);
        let has_nvidia = nvidia_cmd
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);

        if has_nvidia {
            for index_url in [
                "https://download.pytorch.org/whl/cu124",
                "https://download.pytorch.org/whl/cu121",
                "https://download.pytorch.org/whl/cu118",
            ] {
                emit_status(&format!("Trying CUDA PyTorch from {}...", index_url));
                let result = run_python_cmd(
                    &[
                        "-m",
                        "pip",
                        "install",
                        "--upgrade",
                        "torch",
                        "torchvision",
                        "torchaudio",
                        "--index-url",
                        index_url,
                        "--quiet",
                    ],
                    "Failed to install CUDA PyTorch",
                );
                if result.is_ok() {
                    let mut verify_cuda = Command::new(&python_exe);
                    verify_cuda.args(&[
                        "-c",
                        "import torch; assert torch.cuda.is_available(), 'cuda not available'",
                    ]);
                    configure_command_no_window(&mut verify_cuda);
                    if verify_cuda
                        .output()
                        .map(|output| output.status.success())
                        .unwrap_or(false)
                    {
                        cuda_installed = true;
                        break;
                    }
                }
            }
        }

        if !cuda_installed {
            emit_status("Installing PyTorch CPU build...");
            run_python_cmd(
                &[
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "torch",
                    "torchvision",
                    "torchaudio",
                    "--index-url",
                    "https://download.pytorch.org/whl/cpu",
                    "--quiet",
                ],
                "Failed to install CPU PyTorch",
            )?;
        }
    } else {
        emit_status("Installing PyTorch...");
        run_python_cmd(
            &[
                "-m",
                "pip",
                "install",
                "--upgrade",
                "torch",
                "torchvision",
                "torchaudio",
                "--quiet",
            ],
            "Failed to install PyTorch",
        )?;
    }

    let requirements_path = resolve_python_resource_path(
        &app_handle,
        selected_engine.requirements_relative_path(),
    )?;
    let requirements_path = if matches!(selected_engine, LocalSegmentationEngine::MultiAligner) {
        prepare_multi_requirements_file(&requirements_path)?
    } else {
        requirements_path
    };

    let requirements_content = fs::read_to_string(&requirements_path).map_err(|e| {
        format!(
            "Failed to read requirements '{}': {}",
            requirements_path.to_string_lossy(),
            e
        )
    })?;
    let filtered_requirements: String = requirements_content
        .lines()
        .filter(|line| {
            let trimmed = line.trim().to_lowercase();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return false;
            }
            let is_quranic_phonemizer_dep =
                trimmed.starts_with("git+https://github.com/hetchy/quranic-phonemizer.git@")
                    || trimmed.contains("quranic-phonemizer");
            !(trimmed.starts_with("torch")
                || trimmed.starts_with("torchvision")
                || trimmed.starts_with("torchaudio")
                || is_quranic_phonemizer_dep)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let filtered_requirements_path = std::env::temp_dir()
        .join(format!("qurancaption_requirements_{}.txt", selected_engine.as_key()));
    fs::write(&filtered_requirements_path, filtered_requirements).map_err(|e| {
        format!(
            "Failed to write filtered requirements '{}': {}",
            filtered_requirements_path.to_string_lossy(),
            e
        )
    })?;

    emit_status("Installing Python packages...");
    run_python_cmd(
        &[
            "-m",
            "pip",
            "install",
            "-r",
            filtered_requirements_path.to_string_lossy().as_ref(),
            "--quiet",
        ],
        "pip install failed",
    )?;

    if matches!(selected_engine, LocalSegmentationEngine::MultiAligner) {
        emit_status("Installing Quranic-Phonemizer dependency...");
        if cfg!(target_os = "windows") {
            let patched_source =
                prepare_windows_safe_quranic_phonemizer_source(&python_exe)?;
            let patched_source_str = patched_source.to_string_lossy().to_string();
            run_python_cmd(
                &[
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    patched_source_str.as_str(),
                    "--quiet",
                ],
                "Failed to install patched Quranic-Phonemizer",
            )?;
        } else {
            run_python_cmd(
                &[
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "https://github.com/Hetchy/Quranic-Phonemizer/archive/1b6a8cc.zip",
                    "--quiet",
                ],
                "Failed to install Quranic-Phonemizer",
            )?;
        }
    }

    emit_status("Local dependencies installed successfully.");
    Ok(format!(
        "{} dependencies installed successfully",
        selected_engine.as_label()
    ))
}

/// Run local segmentation using the Python script
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
    use std::process::Stdio;
    use std::io::{BufRead, BufReader};
    use tauri::Emitter;

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

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;
    println!(
        "[segmentation][local][debug] resolved ffmpeg path={}",
        ffmpeg_path
    );

    let mut _merged_guard: Option<TempFileGuard> = None;
    let audio_path = if let Some(clips) = audio_clips.as_ref().filter(|c| !c.is_empty()) {
        println!(
            "[segmentation][local][debug] received {} audio clip(s)",
            clips.len()
        );
        for (idx, clip) in clips.iter().enumerate() {
            println!(
                "[segmentation] clip[{}] path={} start_ms={} end_ms={}",
                idx, clip.path, clip.start_ms, clip.end_ms
            );
        }
        let needs_merge = clips.len() > 1 || clips[0].start_ms > 0;
        if needs_merge {
            let (merged_path, guard) = merge_audio_clips_for_segmentation(&ffmpeg_path, clips)?;
            _merged_guard = Some(guard);
            println!(
                "[segmentation] Using merged audio for local: {}",
                merged_path.to_string_lossy()
            );
            merged_path
        } else {
            path_utils::normalize_existing_path(&clips[0].path)
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

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!(
        "qurancaption-local-{}-{}.wav",
        engine.as_key(),
        stamp
    ));
    let _temp_guard = TempFileGuard(temp_path.clone());

    let mut resample_cmd = Command::new(&ffmpeg_path);
    resample_cmd.args(&[
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

    let resample_output = resample_cmd.output()
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

    let python_exe = resolve_engine_python_exe(&app_handle, engine)?;
    let script_path = resolve_python_resource_path(&app_handle, engine.script_relative_path())?;
    println!(
        "[segmentation][local][debug] python_exe={} script_path={}",
        python_exe.to_string_lossy(),
        script_path.to_string_lossy()
    );
    println!(
        "[segmentation][local][debug] script_exists={} temp_exists={}",
        script_path.exists(),
        temp_path.exists()
    );

    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        temp_path.to_string_lossy().to_string(),
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
    args.append(&mut extra_args);
    println!(
        "[segmentation][local][debug] python args={:?}",
        args
    );

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
        Err(err) => {
            eprintln!(
                "[segmentation][local][debug] python --version failed: {}",
                err
            );
        }
    }

    let mut cmd = Command::new(&python_exe);
    cmd.args(&args);
    if let Some(token) = hf_token {
        if !token.trim().is_empty() {
            apply_hf_token_env(&mut cmd, token.trim());
        }
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    configure_command_no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn Python: {}", e))?;
    println!(
        "[segmentation][local][debug] spawned python pid={} engine={}",
        child.id(),
        engine.as_key()
    );

    // Read stderr in a separate thread for status updates and diagnostics.
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
                // Check for STATUS: prefix
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
                        // Keep only the latest lines to avoid unbounded memory growth.
                        if locked.len() > 120 {
                            let drain_count = locked.len() - 120;
                            locked.drain(0..drain_count);
                        }
                    }
                }
            }
        }
    });

    let output = child.wait_with_output().map_err(|e| format!("Failed to wait for Python: {}", e))?;
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
        let result: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| {
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

        if let Ok(error_json) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if let Some(error) = error_json.get("error") {
                return Err(error.as_str().unwrap_or("Unknown error").to_string());
            }
        }

        if !stdout.trim().is_empty() {
            Err(format!("Python script failed: {}", stdout))
        } else if !stderr_text.trim().is_empty() {
            Err(format!("Python script failed: {}", stderr_text))
        } else {
            Err("Python script failed with no output".to_string())
        }
    }
}

#[tauri::command]
async fn segment_quran_audio_local(
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

#[tauri::command]
async fn segment_quran_audio_local_multi(
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

    let selected_device = device
        .unwrap_or_else(|| "GPU".to_string())
        .to_uppercase();
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
        return Err("HF token is required for local Multi-Aligner mode.".to_string());
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


#[tauri::command]
async fn init_discord_rpc(app_id: String) -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    // Fermer la connexion existante si elle existe
    if let Some(ref mut client) = *client_guard {
        let _ = client.close();
    }
    
    // Créer une nouvelle connexion
    let mut client = DiscordIpcClient::new(&app_id).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    
    *client_guard = Some(client);
    Ok(())
}

#[tauri::command]
async fn update_discord_activity(activity_data: DiscordActivity) -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut client) = *client_guard {
        let mut activity_builder = activity::Activity::new();
        
        // Traiter les détails
        if let Some(ref details) = activity_data.details {
            activity_builder = activity_builder.details(details);
        }
        
        // Traiter l'état
        if let Some(ref state) = activity_data.state {
            activity_builder = activity_builder.state(state);
        }
        
        // Ajouter le timestamp de début (utilise start_timestamp si fourni, sinon l'heure actuelle)
        let start_time = activity_data.start_timestamp.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
        });
        
        activity_builder = activity_builder.timestamps(
            activity::Timestamps::new().start(start_time)
        );
        
        // Construire les assets si nécessaire
        let has_large_image = activity_data.large_image_key.is_some();
        let has_small_image = activity_data.small_image_key.is_some();
        
        if has_large_image || has_small_image {
            let mut assets_builder = activity::Assets::new();
            
            if let Some(ref large_image_key) = activity_data.large_image_key {
                assets_builder = assets_builder.large_image(large_image_key);
                
                if let Some(ref large_image_text) = activity_data.large_image_text {
                    assets_builder = assets_builder.large_text(large_image_text);
                }
            }
            
            if let Some(ref small_image_key) = activity_data.small_image_key {
                assets_builder = assets_builder.small_image(small_image_key);
                
                if let Some(ref small_image_text) = activity_data.small_image_text {
                    assets_builder = assets_builder.small_text(small_image_text);
                }
            }
            
            activity_builder = activity_builder.assets(assets_builder);
        }
        
        // Construire la party si nécessaire
        if let (Some(party_size), Some(party_max)) = (activity_data.party_size, activity_data.party_max) {
            let party = activity::Party::new().size([party_size as i32, party_max as i32]);
            activity_builder = activity_builder.party(party);
        }
        
        let activity = activity_builder;
        client.set_activity(activity).map_err(|e| e.to_string())?;
        
        Ok(())
    } else {
        Err("Discord client not initialized. Call init_discord_rpc first.".to_string())
    }
}

#[tauri::command]
async fn clear_discord_activity() -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut client) = *client_guard {
        client.clear_activity().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Discord client not initialized.".to_string())
    }
}

#[tauri::command]
async fn close_discord_rpc() -> Result<(), String> {
    let mut client_guard = DISCORD_CLIENT.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref mut client) = *client_guard {
        client.close().map_err(|e| e.to_string())?;
        *client_guard = None;
        Ok(())
    } else {
        Ok(()) // Déjà fermé ou pas initialisé
    }
}

#[tauri::command]
async fn get_audio_waveform(file_path: String) -> Result<Vec<f32>, String> {
    let path_buf = path_utils::normalize_existing_path(&file_path);
    if !path_buf.exists() {
        return Err(format!("File not found: {}", path_buf.to_string_lossy()));
    }

    let ffmpeg_path = binaries::resolve_binary("ffmpeg")
        .ok_or_else(|| "ffmpeg binary not found".to_string())?;

    // On downsample à 4000Hz pour avoir assez de précision mais pas trop de données
    // Format s16le (signed 16-bit little endian)
    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&[
        "-i",
        &path_buf.to_string_lossy(),
        "-ac",
        "1", // Mono
        "-filter:a",
        "aresample=4000", // Downsample to 4kHz
        "-map",
        "0:a",
        "-c:a",
        "pcm_s16le", // Raw 16-bit audio
        "-f",
        "s16le", // Format brut
        "-",     // Output to stdout
    ]);
    configure_command_no_window(&mut cmd);

    // On capture la sortie standard directement
    // Note: Pour des très gros fichiers, charger tout en mémoire via output() peut être lourd,
    // mais 4kHz 16-bit mono = 8KB/s. Une heure = 28MB. C'est gérable en mémoire.
    let output = cmd
        .output()
        .map_err(|e| format!("Unable to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr));
    }

    let raw_data = output.stdout;
    let mut peaks = Vec::new();
    let samples_per_peak = 40; // 4000Hz / 40 = 100 peaks par seconde

    // Traitement des données brutes
    let mut chunk_max = 0.0;
    let mut sample_count = 0;

    for chunk in raw_data.chunks_exact(2) {
        // Conversion des 2 bytes en i16 (little endian)
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        let abs_sample = sample.abs() as f32 / 32768.0; // Normalisation 0.0 - 1.0

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

    // Ajoute le dernier pic partiel si nécessaire
    if sample_count > 0 {
        peaks.push(chunk_max);
    }

    Ok(peaks)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())        .invoke_handler(tauri::generate_handler![
            download_from_youtube,
            get_duration,
            get_new_file_path,
            save_binary_file,
            save_file,
            download_file,
            delete_file,
            move_file,
            get_system_fonts,
            open_explorer_with_file_selected,

            get_video_dimensions,
            exporter::export_video,
            exporter::cancel_export,
            exporter::concat_videos,
            convert_audio_to_cbr,
            cut_audio,
            cut_video,
            concat_audio,
            segment_quran_audio,
            segment_quran_audio_local,
            segment_quran_audio_local_multi,
            check_local_segmentation_ready,
            install_local_segmentation_deps,
            init_discord_rpc,
            update_discord_activity,
            clear_discord_activity,
            close_discord_rpc,
            get_audio_waveform,
            diagnose_media_binaries
        ])
        .setup(|app| {
            if let Ok(resource_dir) = app.path().resource_dir() {
                binaries::init_resource_dir(resource_dir);
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
