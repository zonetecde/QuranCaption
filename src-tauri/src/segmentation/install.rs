use std::fs;
use std::process::Command;

use tauri::Emitter;

use crate::utils::process::configure_command_no_window;

use super::python_env::{
    apply_hf_token_env, create_venv_if_missing, get_system_python_cmd, get_venv_python_exe,
    resolve_python_resource_path,
};
use super::requirements::{
    prepare_multi_requirements_file, prepare_windows_safe_quranic_phonemizer_source,
};
use super::types::LocalSegmentationEngine;

/// Installe les dépendances Python du moteur local demandé.
pub async fn install_local_segmentation_deps(
    app_handle: tauri::AppHandle,
    engine: String,
    hf_token: Option<String>,
) -> Result<String, String> {
    let selected_engine = LocalSegmentationEngine::from_raw(engine.as_str())?;
    let emit_status = |message: &str| {
        let _ = app_handle.emit("install-status", serde_json::json!({ "message": message }));
    };

    // Validation Python système puis préparation du venv dédié.
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
            return Err(format!(
                "{}: {}",
                context,
                crate::utils::process::sanitize_cmd_error(&output)
            ));
        }
        Ok(())
    };

    // Installation outillage pip + torch (CUDA si possible, CPU fallback).
    emit_status("Upgrading pip...");
    run_python_cmd(
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "pip",
            "setuptools",
            "wheel",
            "--quiet",
        ],
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
                    verify_cuda.args([
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

    // Installation requirements hors paquets torch et dépendance phonemizer.
    let requirements_path =
        resolve_python_resource_path(&app_handle, selected_engine.requirements_relative_path())?;
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
            let is_quranic_phonemizer_dep = trimmed
                .starts_with("git+https://github.com/hetchy/quranic-phonemizer.git@")
                || trimmed.contains("quranic-phonemizer");
            !(trimmed.starts_with("torch")
                || trimmed.starts_with("torchvision")
                || trimmed.starts_with("torchaudio")
                || is_quranic_phonemizer_dep)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let filtered_requirements_path = std::env::temp_dir().join(format!(
        "qurancaption_requirements_{}.txt",
        selected_engine.as_key()
    ));
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

    // Installation explicite de Quranic-Phonemizer pour multi-aligner.
    if matches!(selected_engine, LocalSegmentationEngine::MultiAligner) {
        emit_status("Installing Quranic-Phonemizer dependency...");
        if cfg!(target_os = "windows") {
            let patched_source = prepare_windows_safe_quranic_phonemizer_source(&python_exe)?;
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
