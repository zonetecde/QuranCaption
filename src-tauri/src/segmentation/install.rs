use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use tauri::Emitter;

use crate::utils::process::configure_command_no_window;

use super::data_files::{
    required_multi_aligner_data_files, required_word_timing_model_files,
    resolve_multi_aligner_data_dir, validate_multi_aligner_data_file,
    validate_word_timing_model_file,
};
use super::python_env::{
    apply_hf_token_env, create_venv_if_missing, get_portable_python_download_info,
    get_portable_python_exe, get_portable_python_root, get_venv_python_exe,
    get_word_timing_model_dir, read_python_version, resolve_python_resource_path,
    resolve_python_with_portable, run_python_any_import_check, run_python_import_check,
    MIN_LOCAL_PYTHON_MAJOR, MIN_LOCAL_PYTHON_MINOR,
};
use super::requirements::{
    prepare_multi_requirements_file, prepare_windows_safe_quranic_phonemizer_source,
};
use super::types::LocalSegmentationEngine;

/// Télécharge et extrait le runtime portable Python 3.11 pour QuranWordTiming si aucun Python compatible n'est installé.
/// @param {&tauri::AppHandle} app_handle - Handle de l'application Tauri.
/// @param {&F} emit_progress - Fonction d'émission d'avancement (message, pourcentage).
/// @returns {Result<std::path::PathBuf, String>} Chemin vers l'exécutable portable extrait.
async fn ensure_portable_python_runtime<F>(
    app_handle: &tauri::AppHandle,
    emit_progress: &F,
) -> Result<std::path::PathBuf, String>
where
    F: Fn(&str, u8),
{
    let portable_root = get_portable_python_root(app_handle)?;
    let portable_exe = get_portable_python_exe(app_handle)?;
    if portable_exe.exists() {
        let old_embed_pth = portable_root.join("python").join("python311._pth");
        if old_embed_pth.exists() {
            let _ = fs::remove_dir_all(portable_root.join("python"));
        } else if read_python_version(&portable_exe).is_some() {
            bootstrap_portable_python(&portable_exe, emit_progress).await?;
            return Ok(portable_exe);
        } else {
            let _ = fs::remove_dir_all(portable_root.join("python"));
        }
    }

    fs::create_dir_all(&portable_root).map_err(|e| {
        format!(
            "Failed to create portable Python directory '{}': {}",
            portable_root.to_string_lossy(),
            e
        )
    })?;

    let (url, file_name) = get_portable_python_download_info()?;
    let archive_path = portable_root.join(file_name);

    download_binary_file(url, &archive_path, |downloaded, total| {
        let (pct, status_text) = if let Some(tot) = total {
            let ratio = (downloaded as f32 / tot as f32).min(1.0);
            let p = 5 + (ratio * 15.0).round() as u8;
            let mb_down = downloaded as f64 / 1_048_576.0;
            let mb_tot = tot as f64 / 1_048_576.0;
            (p, format!("Downloading portable Python 3.11 ({:.1}/{:.1} MB)...", mb_down, mb_tot))
        } else {
            let mb_down = downloaded as f64 / 1_048_576.0;
            (10, format!("Downloading portable Python 3.11 ({:.1} MB)...", mb_down))
        };
        emit_progress(&status_text, pct);
    })
    .await?;

    emit_progress("Extracting portable Python 3.11...", 22);

    let tar_binary = if cfg!(target_os = "windows") {
        let system32_tar = std::path::Path::new("C:\\Windows\\System32\\tar.exe");
        if system32_tar.exists() {
            system32_tar.to_string_lossy().to_string()
        } else {
            "tar".to_string()
        }
    } else {
        "tar".to_string()
    };

    let mut cmd = Command::new(&tar_binary);
    cmd.args([
        "-xzf",
        archive_path.to_str().ok_or("Invalid archive path")?,
        "-C",
        portable_root.to_str().ok_or("Invalid destination path")?,
    ]);
    configure_command_no_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("Failed to extract portable Python: {}", e))?;
    let _ = fs::remove_file(&archive_path);

    if !output.status.success() {
        return Err(format!(
            "Failed to extract portable Python: {}",
            crate::utils::process::sanitize_cmd_error(&output)
        ));
    }
    bootstrap_portable_python(&portable_exe, emit_progress).await?;
    if !portable_exe.exists() || read_python_version(&portable_exe).is_none() {
        return Err(format!(
            "Portable Python extracted but executable was not found or invalid at {}",
            portable_exe.to_string_lossy()
        ));
    }

    emit_progress("Portable Python 3.11 ready.", 25);
    Ok(portable_exe)
}

/// Prépare pip et un créateur de venv pour Python embarqué, y compris après une interruption.
/// @param {&Path} portable_exe - Exécutable du runtime portable.
/// @param {&F} emit_progress - Fonction d'émission d'avancement.
/// @returns {Result<(), String>} Succès ou erreur de préparation.
async fn bootstrap_portable_python<F>(portable_exe: &Path, emit_progress: &F) -> Result<(), String>
where
    F: Fn(&str, u8),
{
    if cfg!(target_os = "windows") {
        let python_dir = portable_exe.parent().ok_or("Invalid archive path")?;
        // Enable site-packages in python311._pth
        let pth_file = python_dir.join("python311._pth");
        if !pth_file.exists() {
            return Ok(());
        }
        let content = fs::read_to_string(&pth_file).map_err(|e| e.to_string())?;
        let mut lines: Vec<String> = content
            .lines()
            .map(|l| {
                let trimmed = l.trim();
                if trimmed == "#import site" || trimmed == "# import site" {
                    "import site".to_string()
                } else {
                    l.to_string()
                }
            })
            .collect();
        if !lines.iter().any(|l| l.trim() == "import site") {
            lines.push("import site".to_string());
        }
        if !lines
            .iter()
            .any(|l| l.trim() == "Lib/site-packages" || l.trim() == "Lib\\site-packages")
        {
            lines.push("Lib/site-packages".to_string());
        }
        fs::write(&pth_file, lines.join("\n")).map_err(|e| e.to_string())?;
        fs::create_dir_all(python_dir.join("Lib").join("site-packages"))
            .map_err(|e| e.to_string())?;

        // Bootstrap pip & virtualenv for creating engine environments
        if !run_python_import_check(portable_exe, &["pip"]).0 {
            emit_progress("Bootstrapping pip in portable Python 3.11.0...", 23);
            let get_pip_path = python_dir.join("get-pip.py");
            download_binary_file(
                "https://bootstrap.pypa.io/get-pip.py",
                &get_pip_path,
                |_, _| {},
            )
            .await?;

            let mut pip_boot = Command::new(portable_exe);
            pip_boot.args([
                get_pip_path.to_str().unwrap_or(""),
                "--no-warn-script-location",
                "--quiet",
            ]);
            configure_command_no_window(&mut pip_boot);
            let output = pip_boot.output().map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&get_pip_path);
            if !output.status.success() {
                return Err(crate::utils::process::sanitize_cmd_error(&output));
            }
        }

        if !run_python_any_import_check(portable_exe, &["venv", "virtualenv"]) {
            emit_progress("Bootstrapping virtualenv in portable Python...", 24);
            let mut venv_boot = Command::new(portable_exe);
            venv_boot.args([
                "-m",
                "pip",
                "install",
                "virtualenv",
                "--no-warn-script-location",
                "--quiet",
            ]);
            configure_command_no_window(&mut venv_boot);
            let output = venv_boot.output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(crate::utils::process::sanitize_cmd_error(&output));
            }
        }
    }
    Ok(())
}

/// Installs Python dependencies for the selected local engine.
/// Downloads a remote binary file and writes it locally with progress reporting.
async fn download_binary_file<F>(
    url: &str,
    destination_path: &std::path::Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download '{}': {}", url, e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download '{}': HTTP {}",
            url,
            response.status()
        ));
    }

    let total = response.content_length();
    let mut downloaded = 0u64;
    on_progress(0, total);

    let temp_path = destination_path.with_extension("download");
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let mut response = response;
    let mut last_emit = std::time::Instant::now();
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read chunk from '{}': {}", url, e))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= std::time::Duration::from_millis(150) {
            on_progress(downloaded, total);
            last_emit = std::time::Instant::now();
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush: {}", e))?;
    drop(file);

    on_progress(downloaded, total.or(Some(downloaded)));

    if downloaded == 0 {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Downloaded file from '{}' is empty", url));
    }

    tokio::fs::rename(&temp_path, destination_path)
        .await
        .map_err(|e| format!("Failed to rename temp download: {}", e))?;

    Ok(())
}

/// Validates Multi-Aligner data files and re-downloads invalid ones.
async fn ensure_multi_aligner_data_files(
    app_handle: &tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let data_dir = resolve_multi_aligner_data_dir(app_handle)?;
    fs::create_dir_all(&data_dir).map_err(|e| {
        format!(
            "Failed to create Multi-Aligner data directory '{}': {}",
            data_dir.to_string_lossy(),
            e
        )
    })?;

    let mut repaired_files: Vec<String> = Vec::new();
    for (file_name, url) in required_multi_aligner_data_files() {
        let file_path = data_dir.join(file_name);
        if validate_multi_aligner_data_file(&file_path).is_ok() {
            continue;
        }

        download_binary_file(url, &file_path, |_, _| {}).await?;
        validate_multi_aligner_data_file(&file_path)?;
        repaired_files.push((*file_name).to_string());
    }

    Ok(repaired_files)
}

/// Exécute pip install en mode streaming avec remontée en temps réel de la progression et des packages installés.
/// @param {&Path} python_exe - Chemin de l'exécutable Python dans le venv.
/// @param {&[&str]} args - Arguments supplémentaires pour pip install.
/// @param {Option<&str>} hf_token - Token Hugging Face optionnel pour l'environnement.
/// @param {&F} emit_progress - Callback pour notifier le frontend (message, pourcentage).
/// @param {u8} start_pct - Pourcentage de départ.
/// @param {u8} end_pct - Pourcentage maximum pour cette étape.
/// @param {&str} context - Message contextuel d'erreur.
/// @returns {Result<(), String>} Succès ou message d'erreur.
fn run_pip_install_streaming<F>(
    python_exe: &Path,
    args: &[&str],
    hf_token: Option<&str>,
    emit_progress: &F,
    start_pct: u8,
    end_pct: u8,
    context: &str,
) -> Result<(), String>
where
    F: Fn(&str, u8),
{
    let mut cmd = Command::new(python_exe);
    cmd.arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--prefer-binary")
        .arg("--no-compile")
        .arg("--progress-bar")
        .arg("off")
        .arg("--no-input");
    cmd.args(args);

    if let Some(token) = hf_token {
        apply_hf_token_env(&mut cmd, token);
    }
    configure_command_no_window(&mut cmd);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{}: failed to run pip: {}", context, e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines_clone = Arc::clone(&stderr_lines);
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut l) = stderr_lines_clone.lock() {
                l.push(line);
            }
        }
    });

    let span = end_pct.saturating_sub(start_pct).max(1) as f32;
    let mut step_count: u32 = 0;

    let reader = BufReader::new(stdout);
    let mut output_lines: Vec<String> = Vec::new();

    for line in reader.lines().flatten() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        output_lines.push(trimmed.to_string());

        if trimmed.starts_with("Collecting ") {
            step_count += 1;
            let pkg_spec = trimmed.trim_start_matches("Collecting ").trim();
            let pkg_name = pkg_spec
                .split(|c: char| c == '=' || c == '<' || c == '>' || c == '~' || c.is_whitespace())
                .next()
                .unwrap_or(pkg_spec);
            let pct = (start_pct as f32 + (step_count as f32 * 1.5).min(span - 2.0)) as u8;
            emit_progress(&format!("Downloading package: {}...", pkg_name), pct);
        } else if trimmed.starts_with("Downloading ") {
            let file_info = trimmed.trim_start_matches("Downloading ").trim();
            let short_info = if let Some(open_paren) = file_info.find('(') {
                let fname = file_info[..open_paren].trim();
                let size = &file_info[open_paren..];
                let simple_name = fname.split('-').next().unwrap_or(fname);
                format!("{} {}", simple_name, size)
            } else {
                file_info.to_string()
            };
            step_count += 1;
            let pct = (start_pct as f32 + (step_count as f32 * 1.5).min(span - 2.0)) as u8;
            emit_progress(&format!("Downloading: {}...", short_info), pct);
        } else if trimmed.starts_with("Installing collected packages:") {
            emit_progress(
                "Installing downloaded packages into environment...",
                end_pct.saturating_sub(1),
            );
        } else if trimmed.starts_with("Successfully installed ") {
            emit_progress("Packages installed successfully.", end_pct);
        }
    }

    let _ = stderr_handle.join();
    let status = child
        .wait()
        .map_err(|e| format!("{}: failed to wait on pip: {}", context, e))?;

    if !status.success() {
        let err_vec = stderr_lines.lock().map(|l| l.clone()).unwrap_or_default();
        let last_err = if !err_vec.is_empty() {
            err_vec.join("\n")
        } else {
            output_lines.join("\n")
        };
        return Err(format!("{}: {}", context, last_err));
    }

    emit_progress("Python packages ready.", end_pct);
    Ok(())
}

pub async fn install_local_segmentation_deps(
    app_handle: tauri::AppHandle,
    engine: String,
    hf_token: Option<String>,
) -> Result<String, String> {
    let selected_engine = LocalSegmentationEngine::from_raw(engine.as_str())?;
    let current_progress = AtomicU8::new(0);
    let emit_status_progress = |message: &str, progress: u8| {
        current_progress.store(progress, Ordering::Relaxed);
        let _ = app_handle.emit(
            "install-status",
            serde_json::json!({ "message": message, "progress": progress }),
        );
    };
    let emit_status = |message: &str| {
        let p = current_progress.load(Ordering::Relaxed);
        let _ = app_handle.emit(
            "install-status",
            serde_json::json!({ "message": message, "progress": p }),
        );
    };

    // Validate system Python or auto-provision portable Python 3.11 for QuranWordTiming.
    let system_python = match resolve_python_with_portable(&app_handle, MIN_LOCAL_PYTHON_MAJOR, MIN_LOCAL_PYTHON_MINOR) {
        Ok(interpreter) => interpreter,
        Err(e) => {
            if matches!(
                selected_engine,
                LocalSegmentationEngine::QuranWordTiming
                    | LocalSegmentationEngine::QuranWordTimingOld
            ) {
                emit_status_progress("Downloading portable Python 3.11...", 5);
                ensure_portable_python_runtime(&app_handle, &emit_status_progress).await?;
                resolve_python_with_portable(&app_handle, MIN_LOCAL_PYTHON_MAJOR, MIN_LOCAL_PYTHON_MINOR)
                    .map_err(|err| format!("Failed to initialize portable Python: {}", err))?
            } else {
                return Err(format!(
                    "Python {}.{}+ is required to install local dependencies: {}",
                    MIN_LOCAL_PYTHON_MAJOR, MIN_LOCAL_PYTHON_MINOR, e
                ));
            }
        }
    };
    if cfg!(target_os = "windows")
        && Path::new(&system_python.executable) == get_portable_python_exe(&app_handle)?.as_path()
    {
        bootstrap_portable_python(Path::new(&system_python.executable), &emit_status_progress).await?;
    }
    emit_status_progress(&format!(
        "Using Python {}.{}.{} ({})",
        system_python.major, system_python.minor, system_python.patch, system_python.executable
    ), 25);
    emit_status_progress(&format!(
        "Preparing {} local environment...",
        selected_engine.as_label()
    ), 26);
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
    emit_status_progress("Upgrading pip...", 27);
    run_python_cmd(
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "pip",
            "--no-compile",
            "--quiet",
        ],
        "Failed to upgrade pip",
    )?;
    emit_status_progress("Pip ready.", 29);

    // QuranWordTiming est purement basé sur ONNX Runtime et kaldi-native-fbank (aucun PyTorch requis).
    if !matches!(
        selected_engine,
        LocalSegmentationEngine::QuranWordTiming | LocalSegmentationEngine::QuranWordTimingOld
    ) {
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
    }

    // Install non-torch requirements and skip phonemizer Git dependency.
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

    emit_status_progress("Resolving dependencies...", 30);
    run_pip_install_streaming(
        &python_exe,
        &["-r", filtered_requirements_path.to_string_lossy().as_ref()],
        normalized_hf_token.as_deref(),
        &emit_status_progress,
        30,
        48,
        "pip install failed",
    )?;

    if matches!(selected_engine, LocalSegmentationEngine::QuranWordTiming) {
        emit_status_progress("Checking kaldi-native-fbank acceleration...", 49);
        // Kaldi natif est facultatif : sans wheel compatible, le secours NumPy prend le relais.
        let _ = run_python_cmd(
            &[
                "-m",
                "pip",
                "install",
                "--only-binary=:all:",
                "kaldi-native-fbank",
                "--quiet",
            ],
            "pip install failed",
        );

        // Preload and deploy bundled MSVC DLLs into onnxruntime/capi immediately
        if cfg!(target_os = "windows") {
            if let Ok(segmenter_script) = resolve_python_resource_path(&app_handle, "python/local_word_timing_segmenter.py") {
                if segmenter_script.exists() {
                    let mut init_cmd = Command::new(&python_exe);
                    init_cmd.arg(&segmenter_script).arg("--help");
                    configure_command_no_window(&mut init_cmd);
                    let _ = init_cmd.output();
                }
            }
        }
    }
    if matches!(
        selected_engine,
        LocalSegmentationEngine::QuranWordTiming | LocalSegmentationEngine::QuranWordTimingOld
    ) {
        emit_status_progress("Preparing model storage...", 50);
        let model_dir = get_word_timing_model_dir(&app_handle, selected_engine)?;
        fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
        let files = required_word_timing_model_files(selected_engine);
        let total_files = files.len();
        for (idx, (file_name, url, size, hash)) in files.iter().enumerate() {
            let path = model_dir.join(file_name);
            if validate_word_timing_model_file(&path, *size, hash).is_err() {
                let base_pct = 50.0 + (idx as f32 / total_files as f32) * 45.0;
                let span_pct = 45.0 / total_files as f32;
                download_binary_file(url, &path, |downloaded, total| {
                    let (progress_pct, status_text) = if let Some(tot) = total {
                        let ratio = (downloaded as f32 / tot as f32).min(1.0);
                        let pct = (base_pct + ratio * span_pct).round() as u8;
                        let mb_down = downloaded as f64 / 1_048_576.0;
                        let mb_tot = tot as f64 / 1_048_576.0;
                        (pct, format!("Downloading {} ({:.1}/{:.1} MB)...", file_name, mb_down, mb_tot))
                    } else {
                        let mb_down = downloaded as f64 / 1_048_576.0;
                        (base_pct as u8, format!("Downloading {} ({:.1} MB)...", file_name, mb_down))
                    };
                    emit_status_progress(&status_text, progress_pct);
                }).await?;
                validate_word_timing_model_file(&path, *size, hash)?;
            }
        }
        emit_status_progress("Validating model integrity...", 98);
    }

    // Installation explicite de Quranic-Phonemizer pour multi-aligner.
    if matches!(selected_engine, LocalSegmentationEngine::MultiAligner) {
        emit_status("Checking Multi-Aligner data files...");
        let repaired_files = ensure_multi_aligner_data_files(&app_handle).await?;
        if !repaired_files.is_empty() {
            emit_status(&format!(
                "Repaired Multi-Aligner data files: {}",
                repaired_files.join(", ")
            ));
        }

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

    emit_status_progress("Local dependencies installed successfully.", 100);
    Ok(format!(
        "{} dependencies installed successfully",
        selected_engine.as_label()
    ))
}
