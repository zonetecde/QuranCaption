use std::collections::HashMap;
use std::process::Command;

use super::constants;
use super::ffmpeg_utils;
use super::types::{CodecUsage, ExportPerformanceProfile};

// ---------------------------------------------------------------------------
// Détection de la résolution
// ---------------------------------------------------------------------------

/// Détermine si les dimensions de l'export correspondent à de la haute résolution.
///
/// Seuil : largeur ≥ 2560 ou hauteur ≥ 1440.
pub fn is_high_resolution_export(width: i32, height: i32) -> bool {
    width >= 2560 || height >= 1440
}

// ---------------------------------------------------------------------------
// Gestion des threads FFmpeg
// ---------------------------------------------------------------------------

/// Calcule le nombre maximal de threads FFmpeg selon le profil de performance.
///
/// - `Fastest` : pas de limite (None)
/// - `Balanced` : ~75% des cœurs (min 2)
/// - `LowCpu` : ~50% des cœurs (min 1)
pub fn compute_ffmpeg_thread_cap(profile: ExportPerformanceProfile) -> Option<usize> {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    match profile {
        ExportPerformanceProfile::Fastest => None,
        ExportPerformanceProfile::Balanced => Some((((cores * 3) + 3) / 4).max(2)),
        ExportPerformanceProfile::LowCpu => Some(cores.div_ceil(2).max(1)),
    }
}

/// Ajoute l'argument `-threads` à une commande FFmpeg si le profil le demande.
pub fn append_thread_cap(cmd: &mut Command, profile: ExportPerformanceProfile) {
    if let Some(thread_cap) = compute_ffmpeg_thread_cap(profile) {
        cmd.arg("-threads").arg(thread_cap.to_string());
    }
}

// ---------------------------------------------------------------------------
// Détection des encodeurs hardware
// ---------------------------------------------------------------------------

/// Interroge `ffmpeg -encoders` et retourne la liste des encodeurs hardware supportés.
///
/// Les encodeurs reconnus : h264_nvenc, h264_videotoolbox, h264_qsv, h264_amf.
/// Le résultat est mis en cache par exécutable FFmpeg.
pub fn probe_hw_encoders(ffmpeg_path: Option<&str>) -> Vec<String> {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");

    // Vérification du cache
    if let Ok(cache) = constants::HW_ENCODER_CACHE.lock() {
        if let Some(encoders) = cache.get(exe) {
            return encoders.clone();
        }
    }

    let mut cmd = Command::new(exe);
    cmd.args(&["-hide_banner", "-encoders"]);
    ffmpeg_utils::configure_command_no_window(&mut cmd);

    let output = match cmd.output() {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    let txt = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let mut found = Vec::new();

    if txt.contains("h264_nvenc") {
        found.push("h264_nvenc".to_string());
    }
    if txt.contains("h264_videotoolbox") {
        found.push("h264_videotoolbox".to_string());
    }
    if txt.contains("h264_qsv") {
        found.push("h264_qsv".to_string());
    }
    if txt.contains("h264_amf") {
        found.push("h264_amf".to_string());
    }

    // Mise en cache
    if let Ok(mut cache) = constants::HW_ENCODER_CACHE.lock() {
        cache.insert(exe.to_string(), found.clone());
    }

    found
}

// ---------------------------------------------------------------------------
// Test de disponibilité NVENC
// ---------------------------------------------------------------------------

/// Teste si NVENC est réellement disponible en essayant un encodage d'une frame noire.
/// Le résultat est mis en cache pour éviter de répéter le test.
pub fn test_nvenc_availability(ffmpeg_path: Option<&str>) -> bool {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");

    // Vérification du cache
    if let Ok(cache) = constants::NVENC_AVAILABILITY_CACHE.lock() {
        if let Some(available) = cache.get(exe) {
            return *available;
        }
    }

    println!("[nvenc_test] Test de disponibilité NVENC...");

    // Test avec une frame noire 128x128 (résolution minimale NVENC)
    let mut cmd = Command::new(exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=128x128:r=1:d=0.04",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
    ]);

    ffmpeg_utils::configure_command_no_window(&mut cmd);

    let available = match cmd.output() {
        Ok(output) => {
            let success = output.status.success();
            let stderr = String::from_utf8_lossy(&output.stderr);

            if success {
                println!("[nvenc_test] ✓ NVENC disponible et fonctionnel");
                true
            } else {
                let stderr_lower = stderr.to_lowercase();

                // Distinguer "pas disponible" vs "erreur de config"
                if stderr_lower.contains("cannot load nvcuda.dll")
                    || stderr_lower.contains("no nvidia devices")
                    || stderr_lower.contains("cuda")
                    || stderr_lower.contains("driver")
                {
                    println!(
                        "[nvenc_test] ✗ NVENC non disponible (pas de GPU NVIDIA ou drivers manquants)"
                    );
                    false
                } else if stderr_lower.contains("frame dimension") {
                    // Problème de dimensions : retenter avec une résolution plus grande
                    println!("[nvenc_test] Retry avec résolution plus grande...");
                    test_nvenc_with_larger_resolution(ffmpeg_path)
                } else {
                    println!("[nvenc_test] ✗ NVENC erreur: {}", stderr.trim());
                    false
                }
            }
        }
        Err(e) => {
            println!("[nvenc_test] ✗ Erreur lors du test NVENC: {}", e);
            false
        }
    };

    // Mise en cache
    if let Ok(mut cache) = constants::NVENC_AVAILABILITY_CACHE.lock() {
        cache.insert(exe.to_string(), available);
    }

    available
}

/// Second test NVENC avec une résolution 256x256.
fn test_nvenc_with_larger_resolution(ffmpeg_path: Option<&str>) -> bool {
    let exe = ffmpeg_path.unwrap_or("ffmpeg");

    let mut cmd = Command::new(exe);
    cmd.args(&[
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=1:d=0.04",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
    ]);

    ffmpeg_utils::configure_command_no_window(&mut cmd);

    match cmd.output() {
        Ok(output) => {
            let success = output.status.success();
            if success {
                println!("[nvenc_test] ✓ NVENC disponible avec résolution 256x256");
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!(
                    "[nvenc_test] ✗ NVENC toujours non disponible: {}",
                    stderr.trim()
                );
            }
            success
        }
        Err(e) => {
            println!("[nvenc_test] ✗ Erreur test résolution plus grande: {}", e);
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Choix du meilleur codec
// ---------------------------------------------------------------------------

/// Sélectionne le codec vidéo optimal en fonction du matériel, de la résolution
/// et du contexte d'utilisation (intermédiaire ou final).
///
/// # Retourne
/// Un tuple `(codec, params_supplémentaires, extra)` où :
/// - `codec` : nom du codec FFmpeg (ex: "libx264", "h264_nvenc")
/// - `params_supplémentaires` : arguments FFmpeg supplémentaires (pix_fmt, crf, bitrate...)
/// - `extra` : options optionnelles (preset)
pub fn choose_best_codec(
    prefer_hw: bool,
    width: i32,
    height: i32,
    usage: CodecUsage,
    performance_profile: ExportPerformanceProfile,
) -> (String, Vec<String>, HashMap<String, Option<String>>) {
    let high_resolution = is_high_resolution_export(width, height);
    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary();
    let hw = if prefer_hw {
        probe_hw_encoders(ffmpeg_exe.as_deref())
    } else {
        Vec::new()
    };

    // En haute résolution, le profil Fastest autorise les encodeurs matériels.
    // Les profils Balanced et LowCpu forcent libx264 pour la qualité (sauf VideoToolbox).
    let force_cpu_high_quality =
        high_resolution && !matches!(performance_profile, ExportPerformanceProfile::Fastest);

    if force_cpu_high_quality && !hw.iter().any(|encoder| encoder == "h264_videotoolbox") {
        println!(
            "[codec] Export haute résolution détecté ({}x{}), forçage libx264 haute qualité",
            width, height
        );
        println!(
            "[codec] usage={:?} profile={:?} resolution={}x{} selected=libx264",
            usage, performance_profile, width, height
        );

        let codec = "libx264".to_string();
        let mut extra = HashMap::new();
        let (preset, crf) = match usage {
            CodecUsage::Intermediate => ("veryfast", "14"),
            CodecUsage::Final => ("veryfast", "16"),
        };
        extra.insert("preset".to_string(), Some(preset.to_string()));

        return (
            codec,
            vec![
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-crf".to_string(),
                crf.to_string(),
            ],
            extra,
        );
    }

    // Encodeur hardware disponible
    if !hw.is_empty() {
        // NVENC : test de disponibilité réelle
        if hw[0] == "h264_nvenc" {
            if test_nvenc_availability(ffmpeg_exe.as_deref()) {
                let codec = hw[0].clone();
                println!(
                    "[codec] usage={:?} profile={:?} resolution={}x{} selected={}",
                    usage, performance_profile, width, height, codec
                );
                let params = vec!["-pix_fmt".to_string(), "yuv420p".to_string()];
                let mut extra = HashMap::new();
                extra.insert("preset".to_string(), Some("fast".to_string()));
                return (codec, params, extra);
            } else {
                println!("[codec] NVENC détecté mais non fonctionnel, fallback vers libx264");
            }
        }
        // VideoToolbox (macOS)
        else if hw[0] == "h264_videotoolbox" {
            let codec = hw[0].clone();
            println!(
                "[codec] usage={:?} profile={:?} resolution={}x{} selected={}",
                usage, performance_profile, width, height, codec
            );
            let (bitrate, maxrate, bufsize) = if high_resolution {
                match usage {
                    CodecUsage::Intermediate => ("45M", "60M", "90M"),
                    CodecUsage::Final => ("35M", "50M", "70M"),
                }
            } else {
                match usage {
                    CodecUsage::Intermediate => ("20M", "30M", "40M"),
                    CodecUsage::Final => ("16M", "24M", "32M"),
                }
            };
            let params = vec![
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-b:v".to_string(),
                bitrate.to_string(),
                "-maxrate".to_string(),
                maxrate.to_string(),
                "-bufsize".to_string(),
                bufsize.to_string(),
                "-allow_sw".to_string(),
                "1".to_string(),
            ];
            let mut extra = HashMap::new();
            extra.insert("preset".to_string(), None);
            return (codec, params, extra);
        }
        // Autres encodeurs hardware (QSV, AMF)
        else {
            let codec = hw[0].clone();
            println!(
                "[codec] usage={:?} profile={:?} resolution={}x{} selected={}",
                usage, performance_profile, width, height, codec
            );
            let params = vec!["-pix_fmt".to_string(), "yuv420p".to_string()];
            let mut extra = HashMap::new();
            extra.insert("preset".to_string(), None);
            return (codec, params, extra);
        }
    }

    // Fallback : libx264 logiciel
    let codec = "libx264".to_string();
    println!(
        "[codec] usage={:?} profile={:?} resolution={}x{} selected={}",
        usage, performance_profile, width, height, codec
    );
    let mut extra = HashMap::new();
    let params = {
        extra.insert("preset".to_string(), Some("ultrafast".to_string()));
        vec![
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-crf".to_string(),
            "22".to_string(),
            "-tune".to_string(),
            "zerolatency".to_string(),
            "-bf".to_string(),
            "0".to_string(),
        ]
    };

    (codec, params, extra)
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // is_high_resolution_export
    // -----------------------------------------------------------------------

    #[test]
    fn test_high_resolution_by_width() {
        // 2560x1080 n'est pas >= 1440 en hauteur mais >= 2560 en largeur
        assert!(is_high_resolution_export(2560, 1080));
        // 3840x2160 est clairement haute résolution
        assert!(is_high_resolution_export(3840, 2160));
    }

    #[test]
    fn test_high_resolution_by_height() {
        // 1920x1440 est haute résolution via la hauteur
        assert!(is_high_resolution_export(1920, 1440));
        // 1920x1080 n'est pas haute résolution
        assert!(!is_high_resolution_export(1920, 1080));
    }

    #[test]
    fn test_standard_resolution() {
        assert!(!is_high_resolution_export(1920, 1080));
        assert!(!is_high_resolution_export(1280, 720));
        assert!(!is_high_resolution_export(2559, 1439));
    }

    // -----------------------------------------------------------------------
    // compute_ffmpeg_thread_cap
    // -----------------------------------------------------------------------

    #[test]
    fn test_fastest_profile_has_no_thread_cap() {
        assert_eq!(
            compute_ffmpeg_thread_cap(ExportPerformanceProfile::Fastest),
            None
        );
    }

    #[test]
    fn test_balanced_profile_has_thread_cap() {
        // Au moins 2 threads pour Balanced
        let cap = compute_ffmpeg_thread_cap(ExportPerformanceProfile::Balanced);
        assert!(cap.is_some());
        assert!(cap.unwrap() >= 2);
    }

    #[test]
    fn test_lowcpu_profile_has_thread_cap() {
        // Au moins 1 thread pour LowCpu
        let cap = compute_ffmpeg_thread_cap(ExportPerformanceProfile::LowCpu);
        assert!(cap.is_some());
        assert!(cap.unwrap() >= 1);
    }

    #[test]
    fn test_balanced_is_less_than_fastest_implicit() {
        // Fastest = None (pas de limite), Balanced = Some (limité)
        let fastest = compute_ffmpeg_thread_cap(ExportPerformanceProfile::Fastest);
        let balanced = compute_ffmpeg_thread_cap(ExportPerformanceProfile::Balanced);
        let lowcpu = compute_ffmpeg_thread_cap(ExportPerformanceProfile::LowCpu);

        // Fastest doit être moins restrictif que les autres
        assert!(fastest.is_none());
        // Balanced et LowCpu ont une limite
        assert!(balanced.is_some());
        assert!(lowcpu.is_some());
        // LowCpu doit être plus restrictif que Balanced (ou égal)
        assert!(lowcpu.unwrap() <= balanced.unwrap());
    }

    // -----------------------------------------------------------------------
    // PreparedBackgroundVideo (types.rs)
    // -----------------------------------------------------------------------

    use crate::exporter::types::PreparedBackgroundVideo;

    #[test]
    fn test_prepared_background_normalized() {
        let bg = PreparedBackgroundVideo {
            path: "/tmp/cached.mp4".to_string(),
            is_normalized: true,
            duration_s: 30.0,
        };
        assert!(bg.is_normalized);
        assert_eq!(bg.duration_s, 30.0);
        assert_eq!(bg.path, "/tmp/cached.mp4");
    }

    #[test]
    fn test_prepared_background_not_normalized() {
        let bg = PreparedBackgroundVideo {
            path: "/videos/source.mp4".to_string(),
            is_normalized: false,
            duration_s: 25.5,
        };
        assert!(!bg.is_normalized);
        assert_eq!(bg.duration_s, 25.5);
    }
}
