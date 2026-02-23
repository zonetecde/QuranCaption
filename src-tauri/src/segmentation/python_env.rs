use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::Manager;

use crate::utils::process::{configure_command_no_window, sanitize_cmd_error};

use super::types::LocalSegmentationEngine;

pub(crate) const MIN_LOCAL_PYTHON_MAJOR: u8 = 3;
pub(crate) const MIN_LOCAL_PYTHON_MINOR: u8 = 10;

#[derive(Clone, Debug)]
pub(crate) struct PythonInterpreter {
    pub command: String,
    pub executable: String,
    pub major: u8,
    pub minor: u8,
    pub patch: u8,
}

/// Checks whether a Python version satisfies a required minimum.
pub(crate) fn python_version_meets_min(
    major: u8,
    minor: u8,
    min_major: u8,
    min_minor: u8,
) -> bool {
    major > min_major || (major == min_major && minor >= min_minor)
}

/// Reads the version of a Python executable.
pub(crate) fn read_python_version(python_exe: &Path) -> Option<(u8, u8, u8)> {
    let check_script =
        "import json,sys; print(json.dumps({'major':sys.version_info[0],'minor':sys.version_info[1],'patch':sys.version_info[2]}))";

    let mut cmd = Command::new(python_exe);
    cmd.args(["-c", check_script]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = serde_json::from_str::<serde_json::Value>(&stdout).ok()?;
    Some((
        parsed.get("major")?.as_u64()? as u8,
        parsed.get("minor")?.as_u64()? as u8,
        parsed.get("patch")?.as_u64()? as u8,
    ))
}

fn python_command_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    if cfg!(target_os = "windows") {
        candidates.push("python".to_string());
    } else if cfg!(target_os = "macos") {
        candidates.extend(
            [
                "/opt/homebrew/bin/python3.12",
                "/opt/homebrew/bin/python3.11",
                "/opt/homebrew/bin/python3.10",
                "/usr/local/bin/python3.12",
                "/usr/local/bin/python3.11",
                "/usr/local/bin/python3.10",
                "python3.12",
                "python3.11",
                "python3.10",
                "/opt/homebrew/bin/python3",
                "/usr/local/bin/python3",
                "python3",
                "python",
            ]
            .iter()
            .map(|entry| entry.to_string()),
        );
    } else {
        candidates.extend(
            ["python3.12", "python3.11", "python3.10", "python3", "python"]
                .iter()
                .map(|entry| entry.to_string()),
        );
    }

    let mut seen: HashSet<String> = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect()
}

fn probe_python_interpreter(command: &str) -> Option<PythonInterpreter> {
    let check_script = "import json,sys; print(json.dumps({'executable':sys.executable,'major':sys.version_info[0],'minor':sys.version_info[1],'patch':sys.version_info[2]}))";

    let mut cmd = Command::new(command);
    cmd.args(["-c", check_script]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = serde_json::from_str::<serde_json::Value>(&stdout).ok()?;

    Some(PythonInterpreter {
        command: command.to_string(),
        executable: parsed.get("executable")?.as_str()?.to_string(),
        major: parsed.get("major")?.as_u64()? as u8,
        minor: parsed.get("minor")?.as_u64()? as u8,
        patch: parsed.get("patch")?.as_u64()? as u8,
    })
}

/// Resolves a system Python executable compatible with the minimum required version.
pub(crate) fn resolve_system_python(
    min_major: u8,
    min_minor: u8,
) -> Result<PythonInterpreter, String> {
    let mut discovered: Vec<PythonInterpreter> = Vec::new();

    for candidate in python_command_candidates() {
        if let Some(interpreter) = probe_python_interpreter(&candidate) {
            if python_version_meets_min(interpreter.major, interpreter.minor, min_major, min_minor)
            {
                return Ok(interpreter);
            }
            discovered.push(interpreter);
        }
    }

    if discovered.is_empty() {
        Err(format!(
            "No usable Python interpreter found. Install Python {}.{}+ and ensure it is available in PATH.",
            min_major, min_minor
        ))
    } else {
        let versions = discovered
            .iter()
            .map(|p| format!("{} ({}.{}.{})", p.executable, p.major, p.minor, p.patch))
            .collect::<Vec<_>>()
            .join(", ");
        Err(format!(
            "Python {}.{}+ is required, but found only: {}",
            min_major, min_minor, versions
        ))
    }
}

/// Resolves a Python resource path in bundle mode or development mode.
pub(crate) fn resolve_python_resource_path(
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
        Err(format!(
            "Path not found in resources or dev mode: {}",
            relative_path
        ))
    }
}

/// Retourne le dossier racine contenant tous les environnements virtuels locaux.
pub(crate) fn get_local_venv_root(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
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

/// Retourne le dossier venv d'un moteur local.
pub(crate) fn get_engine_venv_path(
    app_handle: &tauri::AppHandle,
    engine: LocalSegmentationEngine,
) -> Result<PathBuf, String> {
    Ok(get_local_venv_root(app_handle)?.join(format!("seg-{}", engine.as_key())))
}

/// Returns the path of the Python executable inside a venv.
pub(crate) fn get_venv_python_exe(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python3")
    }
}

/// Injects Hugging Face token environment variables for Python libraries.
pub(crate) fn apply_hf_token_env(cmd: &mut Command, token: &str) {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return;
    }

    cmd.env("HF_TOKEN", trimmed);
    cmd.env("HF_HUB_TOKEN", trimmed);
    cmd.env("HUGGING_FACE_HUB_TOKEN", trimmed);
}

/// Checks that required Python modules are importable in the target environment.
pub(crate) fn run_python_import_check(python_exe: &Path, modules: &[&str]) -> (bool, Vec<String>) {
    if !python_exe.exists() {
        return (
            false,
            modules.iter().map(|module| module.to_string()).collect(),
        );
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
        Err(_) => (
            false,
            modules.iter().map(|module| module.to_string()).collect(),
        ),
    }
}

/// Checks that at least one candidate module is importable.
pub(crate) fn run_python_any_import_check(python_exe: &Path, candidates: &[&str]) -> bool {
    for module in candidates {
        let (ok, missing) = run_python_import_check(python_exe, &[*module]);
        if ok && missing.is_empty() {
            return true;
        }
    }
    false
}

/// Creates an engine venv if needed and returns its directory.
pub(crate) fn create_venv_if_missing(
    app_handle: &tauri::AppHandle,
    engine: LocalSegmentationEngine,
) -> Result<PathBuf, String> {
    let venv_dir = get_engine_venv_path(app_handle, engine)?;
    let python_exe = get_venv_python_exe(&venv_dir);
    let min_major = MIN_LOCAL_PYTHON_MAJOR;
    let min_minor = MIN_LOCAL_PYTHON_MINOR;

    if python_exe.exists() {
        if let Some((major, minor, _)) = read_python_version(&python_exe) {
            if python_version_meets_min(major, minor, min_major, min_minor) {
                return Ok(venv_dir);
            }
        }

        fs::remove_dir_all(&venv_dir).map_err(|e| {
            format!(
                "Failed to replace incompatible Python venv for {}: {}",
                engine.as_label(),
                e
            )
        })?;
    }

    let system_python = resolve_system_python(min_major, min_minor)?;
    let mut cmd = Command::new(&system_python.command);
    cmd.args(["-m", "venv", venv_dir.to_string_lossy().as_ref()]);
    configure_command_no_window(&mut cmd);

    let output = cmd.output().map_err(|e| {
        format!(
            "Failed to create Python venv for {}: {}",
            engine.as_label(),
            e
        )
    })?;
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

    if let Some((major, minor, _)) = read_python_version(&python_exe) {
        if !python_version_meets_min(major, minor, min_major, min_minor) {
            return Err(format!(
                "Python venv for {} uses Python {}.{} but {}.{}+ is required.",
                engine.as_label(),
                major,
                minor,
                min_major,
                min_minor
            ));
        }
    } else {
        return Err(format!(
            "Failed to detect Python version in {} venv at {}",
            engine.as_label(),
            python_exe.to_string_lossy()
        ));
    }

    Ok(venv_dir)
}

/// Resolves the Python executable for an already-installed local engine.
pub(crate) fn resolve_engine_python_exe(
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

