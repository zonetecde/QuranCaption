use std::fs;
use std::path::Path;
use std::process::Command;

use crate::utils::process::{configure_command_no_window, sanitize_cmd_error};

/// Patch le fichier requirements du moteur multi-aligner pour éviter la dépendance Git.
pub(crate) fn prepare_multi_requirements_file(
    source_path: &Path,
) -> Result<std::path::PathBuf, String> {
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

/// Prépare une copie Windows-safe de Quranic-Phonemizer en renommant les fichiers incompatibles.
pub(crate) fn prepare_windows_safe_quranic_phonemizer_source(
    python_exe: &Path,
) -> Result<std::path::PathBuf, String> {
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
    let output = cmd.output().map_err(|e| {
        format!(
            "Failed to patch Quranic-Phonemizer source on Windows: {}",
            e
        )
    })?;
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
