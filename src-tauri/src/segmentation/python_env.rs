use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::Manager;

use crate::utils::process::{configure_command_no_window, sanitize_cmd_error};

use super::types::LocalSegmentationEngine;

/// Retourne le nom de la commande Python système selon l'OS.
pub(crate) fn get_system_python_cmd() -> &'static str {
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    }
}

/// Résout un chemin de ressource Python en mode bundle ou en mode développement.
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

/// Retourne le chemin de l'exécutable Python dans un venv.
pub(crate) fn get_venv_python_exe(venv_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python3")
    }
}

/// Injecte les variables d'environnement de token Hugging Face pour les bibliothèques Python.
pub(crate) fn apply_hf_token_env(cmd: &mut Command, token: &str) {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return;
    }

    cmd.env("HF_TOKEN", trimmed);
    cmd.env("HF_HUB_TOKEN", trimmed);
    cmd.env("HUGGING_FACE_HUB_TOKEN", trimmed);
}

/// Vérifie que les modules Python demandés sont importables dans l'environnement cible.
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

/// Vérifie qu'au moins un des modules candidats est importable.
pub(crate) fn run_python_any_import_check(python_exe: &Path, candidates: &[&str]) -> bool {
    for module in candidates {
        let (ok, missing) = run_python_import_check(python_exe, &[*module]);
        if ok && missing.is_empty() {
            return true;
        }
    }
    false
}

/// Crée le venv d'un moteur si nécessaire et retourne son dossier.
pub(crate) fn create_venv_if_missing(
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

    Ok(venv_dir)
}

/// Résout l'exécutable Python d'un moteur local déjà installé.
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
