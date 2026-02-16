use std::process::Command;

use crate::utils::process::configure_command_no_window;

use super::data_files::{required_multi_aligner_data_files, resolve_multi_aligner_data_dir, validate_pickle_data_file};
use super::python_env::{
    get_engine_venv_path, get_system_python_cmd, get_venv_python_exe, run_python_any_import_check,
    run_python_import_check,
};
use super::types::LocalSegmentationEngine;

/// Vérifie l'état de préparation des moteurs de segmentation locale.
pub async fn check_local_segmentation_ready(
    app_handle: tauri::AppHandle,
    hf_token: Option<String>,
) -> Result<serde_json::Value, String> {
    use tokio::time::{timeout, Duration};

    let token_provided = hf_token
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);

    // Le check est exécuté dans un thread bloquant avec timeout pour ne pas figer l'UI.
    let check_result = timeout(
        Duration::from_secs(25),
        tokio::task::spawn_blocking(move || {
            let python_cmd = get_system_python_cmd();
            let mut cmd = Command::new(python_cmd);
            cmd.args(["--version"]);
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
                            "ready": false, "venvExists": false, "packagesInstalled": false, "usable": false,
                            "message": "Python not installed"
                        },
                        "multi": {
                            "ready": false, "venvExists": false, "packagesInstalled": false,
                            "tokenRequired": true, "tokenProvided": token_provided, "usable": false,
                            "message": "Python not installed"
                        }
                    }
                });
            }

            let legacy_venv = match get_engine_venv_path(&app_handle, LocalSegmentationEngine::LegacyWhisper) {
                Ok(path) => path,
                Err(error) => {
                    return serde_json::json!({
                        "ready": false, "pythonInstalled": true, "packagesInstalled": false,
                        "message": format!("Failed to resolve local env paths: {}", error),
                        "engines": {
                            "legacy": {
                                "ready": false, "venvExists": false, "packagesInstalled": false, "usable": false,
                                "message": "Failed to resolve local env path"
                            },
                            "multi": {
                                "ready": false, "venvExists": false, "packagesInstalled": false,
                                "tokenRequired": true, "tokenProvided": token_provided, "usable": false,
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
                        "ready": false, "pythonInstalled": true, "packagesInstalled": false,
                        "message": format!("Failed to resolve local env paths: {}", error),
                        "engines": {
                            "legacy": {
                                "ready": false, "venvExists": false, "packagesInstalled": false, "usable": false,
                                "message": "Failed to resolve local env path"
                            },
                            "multi": {
                                "ready": false, "venvExists": false, "packagesInstalled": false,
                                "tokenRequired": true, "tokenProvided": token_provided, "usable": false,
                                "message": "Failed to resolve local env path"
                            }
                        }
                    });
                }
            };

            // Vérifications import/venv par moteur.
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
            let multi_phonemizer_ok = run_python_any_import_check(
                &multi_python,
                &["core.phonemizer", "quranic_phonemizer"],
            );
            let multi_data_error = resolve_multi_aligner_data_dir(&app_handle)
                .ok()
                .and_then(|data_dir| {
                    for (file_name, _) in required_multi_aligner_data_files() {
                        let file_path = data_dir.join(file_name);
                        if let Err(error) = validate_pickle_data_file(&file_path) {
                            return Some(error);
                        }
                    }
                    None
                });

            let legacy_packages = legacy_imports_ok;
            let multi_packages = multi_imports_ok && multi_phonemizer_ok && multi_data_error.is_none();
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
                        } else if let Some(error) = multi_data_error {
                            format!("Multi-Aligner data files are invalid: {}", error)
                        } else if !token_provided {
                            "Multi-Aligner requires a Hugging Face token".to_string()
                        } else {
                            "Multi-Aligner packages are incomplete".to_string()
                        }
                    }
                }
            })
        }),
    )
    .await;

    match check_result {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(e)) => Err(format!("Task failed: {}", e)),
        Err(_) => Ok(serde_json::json!({
            "ready": false,
            "pythonInstalled": true,
            "packagesInstalled": false,
            "message": "Check timed out - packages may need to be installed",
            "engines": {
                "legacy": {
                    "ready": false, "venvExists": false, "packagesInstalled": false,
                    "usable": false, "message": "Check timed out"
                },
                "multi": {
                    "ready": false, "venvExists": false, "packagesInstalled": false,
                    "tokenRequired": true, "tokenProvided": token_provided, "usable": false,
                    "message": "Check timed out"
                }
            }
        })),
    }
}
