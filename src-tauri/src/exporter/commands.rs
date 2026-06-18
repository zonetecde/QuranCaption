use crate::path_utils;

use rayon::prelude::*;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::Emitter;

use super::batching;
use super::codec;
use super::concat;
use super::constants;
use super::ffmpeg_runner;
use super::ffmpeg_utils;
use super::preprocess;
use super::types::{
    CodecUsage, ExportPerformanceProfile, ExportVideoCodec, FfmpegProgressContext,
    VideoClipTransitionMode, VideoInput,
};

// ---------------------------------------------------------------------------
// Commande Tauri : export_video
// ---------------------------------------------------------------------------

/// Commande principale d'export vidéo.
///
/// Parcourt un dossier d'images PNG nommées par timestamp, construit la timeline,
/// et lance le rendu FFmpeg rapide sans batching.
///
/// # Paramètres (envoyés depuis le frontend)
/// * `export_id` - Identifiant unique pour suivre et annuler l'export.
/// * `imgs_folder` - Dossier contenant les PNG (ex: `0.png`, `1500.png`, ...).
/// * `final_file_path` - Chemin du fichier vidéo de sortie.
/// * `fps` - Images par seconde.
/// * `fade_duration` - Durée du fondu entre chaque sous-titre (ms).
/// * `start_time` - Début de la plage d'export (ms).
/// * `duration` - Durée de l'export (ms). `None` = toute la timeline.
/// * `audios` - Liste des fichiers audio à superposer.
/// * `videos` - Liste des vidéos de fond.
/// * `blur` - Intensité du flou de fond.
/// * `blank_timings` - Timestamps sans sous-titres (fond uniquement).
#[tauri::command]
pub async fn export_video(
    export_id: String,
    imgs_folder: String,
    final_file_path: String,
    fps: i32,
    fade_duration: i32,
    start_time: i32,
    duration: Option<i32>,
    audios: Option<Vec<String>>,
    videos: Option<Vec<VideoInput>>,
    blur: Option<f64>,
    video_fade_in_enabled: Option<bool>,
    video_fade_out_enabled: Option<bool>,
    audio_fade_in_enabled: Option<bool>,
    audio_fade_out_enabled: Option<bool>,
    export_fade_duration_ms: Option<i32>,
    export_without_background: Option<bool>,
    transparent_export_format: Option<String>,
    video_codec: Option<ExportVideoCodec>,
    video_clip_transition_mode: Option<VideoClipTransitionMode>,
    video_clip_transition_duration_ms: Option<i32>,
    blank_timings: Option<Vec<i32>>,
    performance_profile: ExportPerformanceProfile,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let t0 = Instant::now();
    ffmpeg_runner::clear_export_cancelled(&export_id);

    // ---- Logs de démarrage ----
    println!("[start_export] export_id={}", export_id);
    println!("[start_export] imgs_folder={}", imgs_folder);
    println!("[start_export] final_file_path={}", final_file_path);
    println!(
        "[start_export] fps={}, fade_duration(ms)={}",
        fps, fade_duration
    );
    println!(
        "[start_export] export_fade: video(in={}, out={}) audio(in={}, out={}) duration(ms)={}",
        video_fade_in_enabled.unwrap_or(false),
        video_fade_out_enabled.unwrap_or(false),
        audio_fade_in_enabled.unwrap_or(false),
        audio_fade_out_enabled.unwrap_or(false),
        export_fade_duration_ms.unwrap_or(0)
    );
    println!(
        "[start_export] export_without_background={}",
        export_without_background.unwrap_or(false)
    );
    println!(
        "[start_export] transparent_export_format={}",
        transparent_export_format
            .as_deref()
            .unwrap_or("mov_prores_4444")
    );
    println!(
        "[env] CPU cores: {:?}",
        std::thread::available_parallelism().map(|n| n.get())
    );
    println!("[perf] profile={:?}", performance_profile);
    println!(
        "[perf] thread_cap={:?}",
        codec::compute_ffmpeg_thread_cap(performance_profile)
    );
    println!(
        "[timeline] blank timings fournis={}",
        blank_timings.as_ref().map_or(0, Vec::len)
    );

    if let Some(ref audios) = audios {
        println!("[audio] {} fichier(s) audio fourni(s)", audios.len());
    } else {
        println!("[audio] aucun fichier audio fourni");
    }

    if let Some(ref videos) = videos {
        println!("[video] {} fichier(s) vidéo fourni(s)", videos.len());
    } else {
        println!("[video] aucune vidéo de fond fournie");
    }

    // ---- Scan des PNG ----
    let folder = path_utils::normalize_existing_path(&imgs_folder);
    println!(
        "[scan] Parcours du dossier: {:?}",
        folder.canonicalize().unwrap_or_else(|_| folder.clone())
    );

    let mut files: Vec<_> = fs::read_dir(&folder)
        .map_err(|e| format!("Erreur lecture dossier: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()?.to_lowercase() == "png" {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // Tri par timestamp (nom de fichier sans extension)
    files.sort_by_key(|p| {
        p.file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0)
    });
    let files: Vec<PathBuf> = files
        .into_iter()
        .map(|p| p.canonicalize().unwrap_or(p))
        .collect();

    println!("[scan] {} image(s) trouvée(s)", files.len());

    if files.is_empty() {
        return Err("Aucune image .png trouvée dans imgs_folder".to_string());
    }

    // Vérification : la première image doit être 0.png
    let first_stem = files[0]
        .file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(-1);

    if first_stem != 0 {
        return Err("La première image doit être '0.png' (timestamp 0 ms).".to_string());
    }

    // ---- Construction de la timeline ----
    let ts: Vec<i32> = files
        .iter()
        .map(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<i32>().ok())
                .ok_or_else(|| format!("Nom de frame invalide: {}", p.display()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if ts.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err("Les timestamps des frames doivent etre strictement croissants.".to_string());
    }

    let path_strs: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    let ts_preview: Vec<i32> = ts.iter().take(10).cloned().collect();
    println!(
        "[timeline] Premiers timestamps: {:?}{}",
        ts_preview,
        if ts.len() > 10 { " ..." } else { "" }
    );
    println!("[timeline] Nombre d'images: {}", ts.len());

    // ---- Taille cible (dimensions de 0.png) ----
    println!("[image] Ouverture de la première image pour taille cible...");
    let target_size = {
        let img_data = fs::read(&files[0]).map_err(|e| format!("Erreur lecture image: {}", e))?;
        let img = image::load_from_memory(&img_data)
            .map_err(|e| format!("Erreur décodage image: {}", e))?;
        // Forcer des dimensions paires pour compatibilité YUV420P
        ((img.width() as i32 / 2) * 2, (img.height() as i32 / 2) * 2)
    };

    println!("[image] Taille cible: {}x{}", target_size.0, target_size.1);

    // ---- Durée totale ----
    let fade_ms = fade_duration;
    let tail_ms = fade_ms.max(1000);
    let total_duration_ms = duration.unwrap_or_else(|| ts[ts.len() - 1] + tail_ms);
    let duration_s = total_duration_ms as f64 / 1000.0;
    println!(
        "[timeline] Durée totale: {} ms ({:.3} s)",
        total_duration_ms, duration_s
    );
    println!(
        "[perf] Préparation terminée en {:.0} ms",
        t0.elapsed().as_millis()
    );

    // ---- Préparation du dossier de sortie ----
    let out_path = path_utils::normalize_output_path(&final_file_path);
    if let Some(parent) = out_path.parent() {
        println!("[fs] Création du dossier de sortie si besoin: {:?}", parent);
        fs::create_dir_all(parent).map_err(|e| format!("Erreur création dossier: {}", e))?;
    }

    let out_path_str = out_path.to_string_lossy().to_string();
    let out_path_str_for_task = out_path_str.clone();

    // ---- Normalisation des fichiers audio ----
    let mut audios_vec: Vec<String> = Vec::new();
    for raw_audio_path in audios.unwrap_or_default() {
        let normalized = path_utils::normalize_existing_path(&raw_audio_path);
        if normalized.as_os_str().is_empty() || !normalized.exists() {
            println!(
                "[audio][warn] Fichier audio introuvable, export sans ce fichier: {}",
                raw_audio_path
            );
            continue;
        }

        audios_vec.push(normalized.to_string_lossy().to_string());
    }
    if audios_vec.is_empty() {
        println!("[audio] Aucun fichier audio valide, export sans audio");
    } else {
        println!(
            "[audio] {} fichier(s) audio valide(s) après vérification",
            audios_vec.len()
        );
    }

    // ---- Normalisation des vidéos ----
    let mut videos_vec = videos.unwrap_or_default();
    for v in &mut videos_vec {
        v.path = path_utils::normalize_existing_path(&v.path)
            .to_string_lossy()
            .to_string();
    }
    let app_handle = app.clone();
    let export_id_clone = export_id.clone();

    // Lancement du rendu dans un thread bloquant (tokio::task::spawn_blocking)
    tokio::task::spawn_blocking(move || {
        run_fast_export(
            &export_id_clone,
            &out_path_str_for_task,
            &path_strs,
            &ts,
            target_size,
            fps,
            fade_ms,
            start_time,
            &audios_vec,
            &videos_vec,
            true, // prefer_hw
            duration,
            blur,
            video_fade_in_enabled.unwrap_or(false),
            video_fade_out_enabled.unwrap_or(false),
            audio_fade_in_enabled.unwrap_or(false),
            audio_fade_out_enabled.unwrap_or(false),
            export_fade_duration_ms.unwrap_or(0),
            export_without_background.unwrap_or(false),
            transparent_export_format.as_deref(),
            video_codec.unwrap_or(ExportVideoCodec::H264),
            video_clip_transition_mode.unwrap_or(VideoClipTransitionMode::None),
            video_clip_transition_duration_ms.unwrap_or(0),
            performance_profile,
            app_handle,
        )
    })
    .await
    .map_err(|e| format!("Erreur tâche: {}", e))?
    .map_err(|e| format!("Erreur ffmpeg: {}", e))?;

    // ---- Finalisation ----
    let export_time_s = t0.elapsed().as_secs_f64();
    *constants::LAST_EXPORT_TIME_S.lock().unwrap() = Some(export_time_s);
    ffmpeg_runner::clear_export_cancelled(&export_id);
    println!("[done] Export terminé en {:.2}s", export_time_s);
    println!("[metric] export_time_seconds={:.3}", export_time_s);

    let output_file_name = out_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let completion_data = serde_json::json!({
        "filename": output_file_name,
        "exportId": export_id,
        "fullPath": out_path_str
    });

    let _ = app.emit("export-complete", completion_data);

    Ok(out_path_str)
}

type ExportError = Box<dyn std::error::Error + Send + Sync + 'static>;
type ExportResult<T> = Result<T, ExportError>;

struct TempExportDir {
    path: PathBuf,
}

impl Drop for TempExportDir {
    /// Supprime le dossier temporaire de l'export rapide.
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).ok();
    }
}

struct FastImage {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[derive(Clone, Copy)]
struct PixelRect {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}

const DIRTY_TILE_SIZE: usize = 16;

struct FadeFrameTask {
    output_path: PathBuf,
    duration_ticks: u128,
    numerator: u64,
    denominator: u64,
}

/// Format des images temporaires du plan overlay.
#[derive(Clone, Copy, Debug)]
enum OverlayFrameFormat {
    Tga,
    Png,
}

/// Retourne l'extension de fichier du format temporaire choisi.
fn overlay_frame_extension(frame_format: OverlayFrameFormat) -> &'static str {
    match frame_format {
        OverlayFrameFormat::Tga => "tga",
        OverlayFrameFormat::Png => "png",
    }
}

struct FastOverlayPlan {
    concat_path: PathBuf,
    generated_fade_frames: usize,
    source_frame_count: usize,
    width: i32,
    height: i32,
    all_frames_opaque: bool,
    composited_to_black: bool,
    duration_ticks: u128,
    timebase: u128,
}

/// Cree une erreur simple pour la voie d'export rapide.
fn export_error(message: impl Into<String>) -> ExportError {
    Box::new(io::Error::new(io::ErrorKind::Other, message.into()))
}

/// Cree un dossier temporaire unique pour les fichiers intermediaires.
fn create_temp_export_dir(export_id: &str) -> ExportResult<TempExportDir> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let safe_export_id: String = export_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let path = std::env::temp_dir().join(format!(
        "qurancaption-fast-export-{}-{}-{}",
        safe_export_id,
        std::process::id(),
        nonce
    ));
    fs::create_dir_all(&path)?;
    Ok(TempExportDir { path })
}

/// Decode une image PNG en RGBA droit.
fn decode_png_rgba(path: &Path) -> ExportResult<FastImage> {
    let img = image::open(path)
        .map_err(|e| export_error(format!("Erreur decodage PNG {}: {}", path.display(), e)))?
        .to_rgba8();
    let (width, height) = img.dimensions();
    Ok(FastImage {
        width,
        height,
        rgba: img.into_raw(),
    })
}

/// Indique si l'image est entierement opaque.
fn image_is_fully_opaque(image: &FastImage) -> bool {
    image.rgba.chunks_exact(4).all(|pixel| pixel[3] == 255)
}

/// Ecrit une image RGBA dans un PNG temporaire.
fn write_png_rgba(path: &Path, image: &FastImage) -> ExportResult<()> {
    image::save_buffer_with_format(
        path,
        &image.rgba,
        image.width,
        image.height,
        image::ColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|e| export_error(format!("Erreur encodage PNG {}: {}", path.display(), e)))
}

/// Ecrit une image RGBA dans un TGA RLE 32 bits.
fn write_tga_rgba(path: &Path, image: &FastImage) -> ExportResult<()> {
    if image.width > u16::MAX as u32 || image.height > u16::MAX as u32 {
        return Err(export_error(format!(
            "Image trop grande pour TGA: {}x{}",
            image.width, image.height
        )));
    }

    let expected_len = image.width as usize * image.height as usize * 4;
    if image.rgba.len() != expected_len {
        return Err(export_error("Buffer RGBA invalide"));
    }

    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    let mut header = [0u8; 18];
    header[2] = 10; // Image TGA true-color compressee RLE.
    header[12..14].copy_from_slice(&(image.width as u16).to_le_bytes());
    header[14..16].copy_from_slice(&(image.height as u16).to_le_bytes());
    header[16] = 32;
    header[17] = 0x28; // Origine en haut a gauche + alpha 8 bits.
    writer.write_all(&header)?;

    let stride = image.width as usize * 4;
    for row in 0..image.height as usize {
        let start = row * stride;
        write_tga_rle_row(&mut writer, &image.rgba[start..start + stride])?;
    }

    writer.flush()?;
    Ok(())
}

/// Ecrit une ligne RGBA en paquets RLE TGA.
fn write_tga_rle_row<W: Write>(writer: &mut W, row: &[u8]) -> ExportResult<()> {
    let pixels = row.len() / 4;
    let mut x = 0usize;

    while x < pixels {
        let run_len = same_pixel_run(row, x, pixels).min(128);
        if run_len >= 2 {
            writer.write_all(&[0x80 | ((run_len - 1) as u8)])?;
            write_bgra_pixel(writer, row, x)?;
            x += run_len;
            continue;
        }

        let raw_start = x;
        x += 1;
        while x < pixels && x - raw_start < 128 {
            if same_pixel_run(row, x, pixels) >= 2 {
                break;
            }
            x += 1;
        }

        writer.write_all(&[((x - raw_start - 1) as u8)])?;
        for px in raw_start..x {
            write_bgra_pixel(writer, row, px)?;
        }
    }

    Ok(())
}

/// Retourne la longueur d'une sequence de pixels identiques.
fn same_pixel_run(row: &[u8], pixel_index: usize, pixels: usize) -> usize {
    let base = pixel_index * 4;
    let pixel = &row[base..base + 4];
    let mut len = 1usize;
    while pixel_index + len < pixels && len < 128 {
        let next = (pixel_index + len) * 4;
        if &row[next..next + 4] != pixel {
            break;
        }
        len += 1;
    }
    len
}

/// Ecrit un pixel RGBA dans l'ordre BGRA attendu par TGA.
fn write_bgra_pixel<W: Write>(writer: &mut W, row: &[u8], pixel_index: usize) -> ExportResult<()> {
    let base = pixel_index * 4;
    writer.write_all(&[row[base + 2], row[base + 1], row[base], row[base + 3]])?;
    Ok(())
}

/// Ecrit une image RGBA dans le format temporaire choisi.
fn write_overlay_frame(
    path: &Path,
    image: &FastImage,
    frame_format: OverlayFrameFormat,
) -> ExportResult<()> {
    match frame_format {
        OverlayFrameFormat::Tga => write_tga_rgba(path, image),
        OverlayFrameFormat::Png => write_png_rgba(path, image),
    }
}

/// Indique si une erreur correspond a un manque d'espace disque.
fn is_no_space_left_error(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(err) = current {
        if let Some(io_error) = err.downcast_ref::<io::Error>() {
            if matches!(io_error.raw_os_error(), Some(28 | 39 | 112)) {
                return true;
            }
        }

        let message = err.to_string().to_lowercase();
        if message.contains("no space left on device")
            || message.contains("os error 28")
            || message.contains("not enough space on the disk")
            || message.contains("there is not enough space")
        {
            return true;
        }

        current = err.source();
    }

    false
}

/// Divise avec arrondi a l'entier le plus proche.
fn div_round(value: u64, divisor: u64) -> u64 {
    if divisor == 0 {
        return 0;
    }
    (value + divisor / 2) / divisor
}

/// Trouve les zones de pixels differents entre deux images.
fn changed_pixel_regions(a: &FastImage, b: &FastImage) -> Vec<PixelRect> {
    let width = a.width as usize;
    let height = a.height as usize;
    let tile_cols = (width + DIRTY_TILE_SIZE - 1) / DIRTY_TILE_SIZE;
    let tile_rows = (height + DIRTY_TILE_SIZE - 1) / DIRTY_TILE_SIZE;
    let mut dirty_tiles = vec![false; tile_cols * tile_rows];
    let mut x0 = width;
    let mut y0 = height;
    let mut x1 = 0usize;
    let mut y1 = 0usize;

    for y in 0..height {
        let row_start = y * width * 4;
        for x in 0..width {
            let offset = row_start + x * 4;
            if a.rgba[offset..offset + 4] != b.rgba[offset..offset + 4] {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
                dirty_tiles[(y / DIRTY_TILE_SIZE) * tile_cols + x / DIRTY_TILE_SIZE] = true;
            }
        }
    }

    if x1 == 0 {
        return Vec::new();
    }

    let bounds = PixelRect { x0, y0, x1, y1 };
    let mut regions = Vec::new();
    for tile_y in 0..tile_rows {
        let mut tile_x = 0usize;
        while tile_x < tile_cols {
            while tile_x < tile_cols && !dirty_tiles[tile_y * tile_cols + tile_x] {
                tile_x += 1;
            }
            if tile_x == tile_cols {
                break;
            }

            let start_x = tile_x;
            while tile_x < tile_cols && dirty_tiles[tile_y * tile_cols + tile_x] {
                tile_x += 1;
            }

            regions.push(PixelRect {
                x0: start_x * DIRTY_TILE_SIZE,
                y0: tile_y * DIRTY_TILE_SIZE,
                x1: (tile_x * DIRTY_TILE_SIZE).min(width),
                y1: ((tile_y + 1) * DIRTY_TILE_SIZE).min(height),
            });
        }
    }

    let tile_area: usize = regions.iter().map(rect_area).sum();
    if tile_area < rect_area(&bounds) {
        regions
    } else {
        vec![bounds]
    }
}

/// Calcule l'aire d'une region de pixels.
fn rect_area(rect: &PixelRect) -> usize {
    (rect.x1 - rect.x0) * (rect.y1 - rect.y0)
}

/// Compose une image RGBA droite sur un fond noir opaque.
fn compose_rgba_over_black(image: &FastImage) -> FastImage {
    let mut rgba = Vec::with_capacity(image.rgba.len());
    for pixel in image.rgba.chunks_exact(4) {
        let alpha = pixel[3] as u16;
        // Composition droite sur noir: RGB * A, puis sortie opaque.
        rgba.push(((pixel[0] as u16 * alpha + 127) / 255) as u8);
        rgba.push(((pixel[1] as u16 * alpha + 127) / 255) as u8);
        rgba.push(((pixel[2] as u16 * alpha + 127) / 255) as u8);
        rgba.push(255);
    }

    FastImage {
        width: image.width,
        height: image.height,
        rgba,
    }
}

/// Melange uniquement les zones modifiees en alpha premultiplie.
fn blend_premultiplied_regions(
    a: &FastImage,
    b: &FastImage,
    regions: &[PixelRect],
    numerator: u64,
    denominator: u64,
) -> FastImage {
    let mut rgba = a.rgba.clone();
    let inv = denominator.saturating_sub(numerator);
    let width = a.width as usize;

    for rect in regions {
        for y in rect.y0..rect.y1 {
            for x in rect.x0..rect.x1 {
                let offset = (y * width + x) * 4;
                let apx = &a.rgba[offset..offset + 4];
                let bpx = &b.rgba[offset..offset + 4];
                let out = &mut rgba[offset..offset + 4];
                let aa = apx[3] as u64;
                let ba = bpx[3] as u64;
                let out_alpha = div_round(aa * inv + ba * numerator, denominator).min(255);

                if out_alpha == 0 {
                    out.copy_from_slice(&[0, 0, 0, 0]);
                    continue;
                }

                for channel in 0..3 {
                    let a_premul = apx[channel] as u64 * aa;
                    let b_premul = bpx[channel] as u64 * ba;
                    let premul = div_round(a_premul * inv + b_premul * numerator, denominator);
                    out[channel] = div_round(premul, out_alpha).min(255) as u8;
                }
                out[3] = out_alpha as u8;
            }
        }
    }

    FastImage {
        width: a.width,
        height: a.height,
        rgba,
    }
}

/// Melange uniquement les zones modifiees de deux images deja opaques.
fn blend_opaque_regions(
    a: &FastImage,
    b: &FastImage,
    regions: &[PixelRect],
    numerator: u64,
    denominator: u64,
) -> FastImage {
    let mut rgba = a.rgba.clone();
    let inv = denominator.saturating_sub(numerator);
    let width = a.width as usize;

    for rect in regions {
        for y in rect.y0..rect.y1 {
            for x in rect.x0..rect.x1 {
                let offset = (y * width + x) * 4;
                for channel in 0..3 {
                    rgba[offset + channel] = div_round(
                        a.rgba[offset + channel] as u64 * inv
                            + b.rgba[offset + channel] as u64 * numerator,
                        denominator,
                    )
                    .min(255) as u8;
                }
                rgba[offset + 3] = 255;
            }
        }
    }

    FastImage {
        width: a.width,
        height: a.height,
        rgba,
    }
}

/// Calcule une division entiere arrondie vers le haut.
fn ceil_div(value: u128, divisor: u128) -> u128 {
    if divisor == 0 {
        return 0;
    }
    (value + divisor - 1) / divisor
}

/// Formate une duree exprimee en ticks de concat FFmpeg.
fn format_seconds_ticks(ticks: u128, timebase: u128) -> String {
    let mut whole = ticks / timebase;
    let mut micros = ((ticks % timebase) * 1_000_000 + timebase / 2) / timebase;
    if micros >= 1_000_000 {
        whole += 1;
        micros -= 1_000_000;
    }
    format!("{}.{:06}", whole, micros)
}

/// Echappe un chemin pour le demuxer concat de FFmpeg.
fn escape_concat_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .replace('\'', "\\'")
}

/// Ecrit une entree de fichier dans le plan concat.
fn write_concat_file<W: Write>(writer: &mut W, path: &Path, timebase: u128) -> ExportResult<()> {
    writeln!(writer, "file '{}'", escape_concat_path(path))?;
    writeln!(writer, "option framerate {}", timebase)?;
    Ok(())
}

/// Ecrit une entree de fichier avec sa duree dans le plan concat.
fn write_concat_entry<W: Write>(
    writer: &mut W,
    path: &Path,
    duration_ticks: u128,
    timebase: u128,
) -> ExportResult<()> {
    if duration_ticks == 0 {
        return Ok(());
    }
    write_concat_file(writer, path, timebase)?;
    writeln!(
        writer,
        "duration {}",
        format_seconds_ticks(duration_ticks, timebase)
    )?;
    Ok(())
}

/// Construit le plan concat d'images qui respecte les timestamps et les fondus.
fn build_overlay_concat_plan(
    export_id: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
    fps: i32,
    fade_duration_ms: i32,
    duration_ms: i32,
    temp_dir: &Path,
    compose_black: bool,
    frame_format: OverlayFrameFormat,
) -> ExportResult<FastOverlayPlan> {
    if fps <= 0 {
        return Err(export_error("FPS invalide"));
    }
    if image_paths.is_empty() || image_paths.len() != timestamps_ms.len() {
        return Err(export_error("Timeline d'images invalide"));
    }

    let fps_ticks = fps as u128;
    let timebase = fps_ticks * 1000;
    let frame_ticks = 1000u128;
    let requested_fade_ticks = fade_duration_ms.max(0) as u128 * fps_ticks;
    let concat_path = temp_dir.join("frames.ffconcat");
    let mut concat_file = BufWriter::new(File::create(&concat_path)?);
    writeln!(concat_file, "ffconcat version 1.0")?;

    let mut current = decode_png_rgba(Path::new(&image_paths[0]))?;
    let source_width = current.width;
    let source_height = current.height;
    let mut current_visible = compose_black.then(|| compose_rgba_over_black(&current));
    let mut generated_fade_frames = 0usize;
    let mut previous_fade_ticks = 0u128;
    let mut total_duration_ticks = 0u128;
    let mut all_frames_opaque = image_is_fully_opaque(&current);

    for i in 0..image_paths.len().saturating_sub(1) {
        ffmpeg_runner::ensure_export_not_cancelled(export_id)?;
        let next = decode_png_rgba(Path::new(&image_paths[i + 1]))?;
        let next_visible = compose_black.then(|| compose_rgba_over_black(&next));
        all_frames_opaque &= image_is_fully_opaque(&next);
        if next.width != source_width || next.height != source_height {
            return Err(export_error(format!(
                "Dimensions incoherentes entre les PNG: {}x{} puis {}x{}",
                source_width, source_height, next.width, next.height
            )));
        }

        let source_path = match (frame_format, current_visible.as_ref()) {
            (OverlayFrameFormat::Png, None) => PathBuf::from(&image_paths[i]),
            (_, source_image) => {
                let ext = overlay_frame_extension(frame_format);
                let path = temp_dir.join(format!("source_{:06}.{}", i, ext));
                write_overlay_frame(&path, source_image.unwrap_or(&current), frame_format)?;
                path
            }
        };
        let changed_regions = changed_pixel_regions(&current, &next);

        let segment_ms = timestamps_ms[i + 1].saturating_sub(timestamps_ms[i]).max(0) as u128;
        let segment_ticks = segment_ms * fps_ticks;

        if segment_ticks > 0 {
            let timeline_fade_ticks = requested_fade_ticks.min(segment_ticks);
            let contribution_ticks = segment_ticks.saturating_sub(previous_fade_ticks);
            let visual_fade_ticks = timeline_fade_ticks.min(contribution_ticks);

            if requested_fade_ticks == 0 || visual_fade_ticks == 0 || changed_regions.is_empty() {
                write_concat_entry(&mut concat_file, &source_path, contribution_ticks, timebase)?;
                total_duration_ticks += contribution_ticks;
            } else {
                // L'ancien xfade consomme le fade precedent au debut du segment courant.
                let still_ticks = contribution_ticks.saturating_sub(visual_fade_ticks);
                write_concat_entry(&mut concat_file, &source_path, still_ticks, timebase)?;
                total_duration_ticks += still_ticks;

                let fade_frame_count = ceil_div(visual_fade_ticks, frame_ticks) as usize;
                let ext = overlay_frame_extension(frame_format);
                let tasks: Vec<FadeFrameTask> = (0..fade_frame_count)
                    .map(|frame_idx| {
                        let start_ticks = frame_idx as u128 * frame_ticks;
                        let duration_ticks = (visual_fade_ticks - start_ticks).min(frame_ticks);
                        let numerator =
                            (start_ticks + duration_ticks).min(visual_fade_ticks) as u64;
                        FadeFrameTask {
                            output_path: temp_dir
                                .join(format!("fade_{:06}_{:04}.{}", i, frame_idx, ext)),
                            duration_ticks,
                            numerator,
                            denominator: visual_fade_ticks as u64,
                        }
                    })
                    .collect();

                tasks.par_iter().try_for_each(|task| -> ExportResult<()> {
                    ffmpeg_runner::ensure_export_not_cancelled(export_id)?;
                    let blended = if compose_black {
                        blend_opaque_regions(
                            current_visible.as_ref().expect("image visible courante"),
                            next_visible.as_ref().expect("image visible suivante"),
                            &changed_regions,
                            task.numerator,
                            task.denominator,
                        )
                    } else {
                        blend_premultiplied_regions(
                            &current,
                            &next,
                            &changed_regions,
                            task.numerator,
                            task.denominator,
                        )
                    };
                    write_overlay_frame(&task.output_path, &blended, frame_format)
                })?;

                generated_fade_frames += tasks.len();
                for task in &tasks {
                    write_concat_entry(
                        &mut concat_file,
                        &task.output_path,
                        task.duration_ticks,
                        timebase,
                    )?;
                    total_duration_ticks += task.duration_ticks;
                }
            }
            previous_fade_ticks = timeline_fade_ticks;
        }

        current = next;
        current_visible = next_visible;
    }

    let last_idx = image_paths.len() - 1;
    let last_source_path = match (frame_format, current_visible.as_ref()) {
        (OverlayFrameFormat::Png, None) => PathBuf::from(&image_paths[last_idx]),
        (_, last_source_image) => {
            let ext = overlay_frame_extension(frame_format);
            let path = temp_dir.join(format!("source_{:06}.{}", last_idx, ext));
            write_overlay_frame(&path, last_source_image.unwrap_or(&current), frame_format)?;
            path
        }
    };
    let last_ts = *timestamps_ms.last().unwrap_or(&0);
    let hold_ms = (duration_ms - last_ts).max(1) as u128;
    let final_hold_ticks = (hold_ms * fps_ticks).saturating_sub(previous_fade_ticks);
    write_concat_entry(
        &mut concat_file,
        &last_source_path,
        final_hold_ticks,
        timebase,
    )?;
    total_duration_ticks += final_hold_ticks;

    // Le demuxer concat a besoin de revoir le dernier fichier pour honorer sa duree.
    write_concat_file(&mut concat_file, &last_source_path, timebase)?;
    concat_file.flush()?;

    Ok(FastOverlayPlan {
        concat_path,
        generated_fade_frames,
        source_frame_count: image_paths.len(),
        width: source_width as i32,
        height: source_height as i32,
        all_frames_opaque,
        composited_to_black: compose_black,
        duration_ticks: total_duration_ticks.max(frame_ticks),
        timebase,
    })
}

/// Ajoute des keyframes regulieres pour rendre le seek MP4 rapide.
fn append_seek_friendly_gop_args(cmd: &mut Vec<String>, codec_name: &str, fps: i32) {
    let gop = fps.max(1).to_string();
    cmd.extend_from_slice(&["-g".to_string(), gop.clone()]);
    if codec_name == "libx264" {
        cmd.extend_from_slice(&[
            "-keyint_min".to_string(),
            gop,
            "-sc_threshold".to_string(),
            "0".to_string(),
        ]);
    } else if codec_name.contains("nvenc") {
        cmd.extend_from_slice(&["-forced-idr".to_string(), "1".to_string()]);
    }
}

/// Ajoute les options video rapides pour une sortie visible standard.
fn append_visible_h264_args(
    cmd: &mut Vec<String>,
    prefer_hw: bool,
    width: i32,
    height: i32,
    fps: i32,
    performance_profile: ExportPerformanceProfile,
) {
    let (vcodec, vparams, vextra) = codec::choose_best_codec(
        prefer_hw,
        width,
        height,
        CodecUsage::Final,
        performance_profile,
    );
    cmd.extend_from_slice(&["-c:v".to_string(), vcodec.clone()]);

    if vcodec == "h264_nvenc" {
        cmd.extend_from_slice(&[
            "-preset".to_string(),
            "p1".to_string(),
            "-tune".to_string(),
            "ll".to_string(),
            "-rc".to_string(),
            "constqp".to_string(),
            "-qp".to_string(),
            "18".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    } else {
        if let Some(Some(preset)) = vextra.get("preset") {
            cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
        }
        cmd.extend(vparams);
    }

    append_seek_friendly_gop_args(cmd, &vcodec, fps);
}

/// Ajoute les options vidéo visibles pour le codec final choisi.
fn append_visible_video_args(
    cmd: &mut Vec<String>,
    video_codec: ExportVideoCodec,
    prefer_hw: bool,
    width: i32,
    height: i32,
    fps: i32,
    performance_profile: ExportPerformanceProfile,
) {
    if video_codec == ExportVideoCodec::H265 {
        let (vcodec, vparams, vextra) =
            codec::choose_h265_codec(prefer_hw, width, height, performance_profile);
        cmd.extend_from_slice(&["-c:v".to_string(), vcodec.clone()]);
        if let Some(Some(preset)) = vextra.get("preset") {
            cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
        }
        cmd.extend(vparams);
        append_seek_friendly_gop_args(cmd, &vcodec, fps);
        return;
    }

    append_visible_h264_args(cmd, prefer_hw, width, height, fps, performance_profile);
}

/// Indique si l'audio simple peut etre copie sans reencodage dans la sortie.
fn can_stream_copy_simple_audio(audio_path: &str, out_path: &str) -> bool {
    let audio_ext = Path::new(audio_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let output_ext = Path::new(out_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    matches!(output_ext.as_str(), "mp4" | "m4v" | "mov")
        && matches!(audio_ext.as_str(), "mp3" | "aac" | "m4a")
}

/// Execute FFmpeg avec le contexte de progression principal.
fn run_final_export_command(
    export_id: &str,
    cmd: &[String],
    duration_s: f64,
    app_handle: &tauri::AppHandle,
) -> ExportResult<()> {
    ffmpeg_runner::run_ffmpeg_command(
        export_id,
        cmd,
        Some(FfmpegProgressContext {
            base_time_s: 0.0,
            total_time_s: duration_s.max(0.001),
            local_duration_s: duration_s.max(0.001),
            suppress_error_event: false,
            current_batch_size: None,
        }),
        Some("Adding Subtitles"),
        None,
        app_handle,
    )?;

    Ok(())
}

/// Execute l'export rapide complet avec overlay RGBA, fond, audio et codec final.
#[allow(clippy::too_many_arguments)]
fn run_fast_export(
    export_id: &str,
    out_path: &str,
    image_paths: &[String],
    timestamps_ms: &[i32],
    target_size: (i32, i32),
    fps: i32,
    fade_duration_ms: i32,
    start_time_ms: i32,
    audio_paths: &[String],
    video_inputs: &[VideoInput],
    prefer_hw: bool,
    duration_ms: Option<i32>,
    blur: Option<f64>,
    video_fade_in_enabled: bool,
    video_fade_out_enabled: bool,
    audio_fade_in_enabled: bool,
    audio_fade_out_enabled: bool,
    export_fade_duration_ms: i32,
    export_without_background: bool,
    transparent_export_format: Option<&str>,
    video_codec: ExportVideoCodec,
    video_clip_transition_mode: VideoClipTransitionMode,
    video_clip_transition_duration_ms: i32,
    performance_profile: ExportPerformanceProfile,
    app_handle: tauri::AppHandle,
) -> ExportResult<()> {
    if image_paths.is_empty() {
        return Err(export_error("Aucune image fournie"));
    }
    if fps <= 0 {
        return Err(export_error("FPS invalide"));
    }

    let (w, h) = target_size;
    let tail_ms = fade_duration_ms.max(1000);
    let full_duration_ms = duration_ms
        .unwrap_or_else(|| timestamps_ms[timestamps_ms.len() - 1] + tail_ms)
        .max(1);
    let duration_s = full_duration_ms as f64 / 1000.0;
    let start_s = (start_time_ms as f64 / 1000.0).max(0.0);
    let export_fade_s = (export_fade_duration_ms.max(0) as f64 / 1000.0).min(duration_s.max(0.0));
    let video_clip_transition_s =
        (video_clip_transition_duration_ms.max(0) as f64 / 1000.0).min(duration_s.max(0.0));
    let has_video_clip_transition = video_clip_transition_mode != VideoClipTransitionMode::None
        && video_clip_transition_s > 1e-6;
    let use_mov_alpha =
        batching::transparent_export_uses_mov(export_without_background, transparent_export_format);

    // Filtrer les fichiers audio inexistants (projet ouvert sur une autre machine, etc.)
    let audio_paths: Vec<String> = audio_paths
        .iter()
        .filter(|p| {
            let exists = Path::new(p).exists();
            if !exists {
                println!("[fast_export] fichier audio introuvable, ignoré: {}", p);
            }
            exists
        })
        .cloned()
        .collect();

    let mut temp_dir = create_temp_export_dir(export_id)?;

    ffmpeg_runner::emit_export_progress(
        &app_handle,
        export_id,
        0.0,
        0.0,
        duration_s.max(0.001),
        Some("Initializing..."),
        None,
    );
    println!("[fast_export] Initialisation: generation du plan overlay TGA...");
    println!(
        "[fast_export] fade timeline effectif={}ms",
        fade_duration_ms.max(0)
    );
    let compose_black = !export_without_background
        && video_inputs.is_empty()
        && !video_fade_in_enabled
        && !video_fade_out_enabled;
    let overlay_plan = match build_overlay_concat_plan(
        export_id,
        image_paths,
        timestamps_ms,
        fps,
        fade_duration_ms,
        full_duration_ms,
        &temp_dir.path,
        compose_black,
        OverlayFrameFormat::Tga,
    ) {
        Ok(plan) => plan,
        Err(error) if is_no_space_left_error(error.as_ref()) => {
            println!(
                "[fast_export][warn] plan overlay TGA impossible par manque d'espace, retry PNG: {}",
                error
            );
            fs::remove_dir_all(&temp_dir.path).ok();
            temp_dir = create_temp_export_dir(export_id)?;
            build_overlay_concat_plan(
                export_id,
                image_paths,
                timestamps_ms,
                fps,
                fade_duration_ms,
                full_duration_ms,
                &temp_dir.path,
                compose_black,
                OverlayFrameFormat::Png,
            )?
        }
        Err(error) => return Err(error),
    };
    println!(
        "[fast_export] Frames source={} fades={} taille_source={}x{} opaque={} compose_noir={}",
        overlay_plan.source_frame_count,
        overlay_plan.generated_fade_frames,
        overlay_plan.width,
        overlay_plan.height,
        overlay_plan.all_frames_opaque,
        overlay_plan.composited_to_black
    );

    let preprocessed_background_videos = if !export_without_background && !video_inputs.is_empty() {
        preprocess::preprocess_background_videos(
            video_inputs,
            w,
            h,
            fps,
            prefer_hw,
            start_time_ms,
            Some(full_duration_ms),
            blur,
            performance_profile,
            export_id,
            duration_s,
            &app_handle,
        )
    } else {
        Vec::new()
    };
    ffmpeg_runner::ensure_export_not_cancelled(export_id)?;

    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let mut cmd = vec![
        ffmpeg_exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        overlay_plan.concat_path.to_string_lossy().to_string(),
    ];

    let mut current_idx = 1usize;
    let bg_start_idx = current_idx;
    for bg in &preprocessed_background_videos {
        // Pour la voie directe (non normalisé), ajouter un seek input
        if !bg.is_normalized {
            let seek_s = (start_time_ms as f64 / 1000.0).max(0.0);
            cmd.extend_from_slice(&["-ss".to_string(), format!("{:.6}", seek_s)]);
            println!("[background] input fast seek: {}s for {}", seek_s, bg.path);
        }
        cmd.extend_from_slice(&["-i".to_string(), bg.path.clone()]);
        current_idx += 1;
    }

    let total_bg_s: f64 = preprocessed_background_videos
        .iter()
        .map(|bg| bg.duration_s)
        .sum();
    let total_audio_s: f64 = audio_paths
        .iter()
        .map(|p| ffmpeg_utils::ffprobe_duration_sec(p))
        .sum();
    let have_audio = !audio_paths.is_empty() && start_s < total_audio_s - 1e-6;
    let direct_visible_export = !export_without_background
        && preprocessed_background_videos.is_empty()
        && (overlay_plan.all_frames_opaque || overlay_plan.composited_to_black)
        && overlay_plan.width == w
        && overlay_plan.height == h
        && !video_fade_in_enabled
        && !video_fade_out_enabled
        && !has_video_clip_transition
        && (!have_audio
            || (audio_paths.len() == 1 && !audio_fade_in_enabled && !audio_fade_out_enabled));
    if direct_visible_export {
        println!(
            "[fast_export] chemin direct eligible: export_visible=true, fond_video=false, frames_opacifiees={}, audio_simple={}",
            overlay_plan.composited_to_black,
            !have_audio || audio_paths.len() == 1
        );
    } else {
        let mut reasons = Vec::new();
        if export_without_background {
            reasons.push("export_transparent=true".to_string());
        }
        if !preprocessed_background_videos.is_empty() {
            reasons.push(format!(
                "fond_video={} fichier(s)",
                preprocessed_background_videos.len()
            ));
        }
        if !overlay_plan.all_frames_opaque && !overlay_plan.composited_to_black {
            reasons.push("frames_non_opaques_et_non_composees".to_string());
        }
        if overlay_plan.width != w || overlay_plan.height != h {
            reasons.push(format!(
                "taille_overlay={}x{} taille_sortie={}x{}",
                overlay_plan.width, overlay_plan.height, w, h
            ));
        }
        if video_fade_in_enabled || video_fade_out_enabled {
            reasons.push("fade_video_global=true".to_string());
        }
        if has_video_clip_transition {
            reasons.push("transition_clips_video=true".to_string());
        }
        if have_audio && (audio_paths.len() != 1 || audio_fade_in_enabled || audio_fade_out_enabled)
        {
            reasons.push(format!(
                "audio_complexe=count:{} fade_in:{} fade_out:{}",
                audio_paths.len(),
                audio_fade_in_enabled,
                audio_fade_out_enabled
            ));
        }
        println!("[fast_export] chemin direct ignore: {}", reasons.join(", "));
    }

    let needs_black_background = !direct_visible_export
        && !export_without_background
        && (preprocessed_background_videos.is_empty() || total_bg_s <= 1e-6);
    let black_background_idx = if needs_black_background {
        let idx = current_idx;
        cmd.extend_from_slice(&[
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            format!("color=c=black:s={}x{}:r={}:d={:.6}", w, h, fps, duration_s),
        ]);
        current_idx += 1;
        Some(idx)
    } else {
        None
    };

    let audio_start_idx = current_idx;
    if have_audio {
        for path in &audio_paths {
            if direct_visible_export {
                cmd.extend_from_slice(&["-ss".to_string(), format!("{:.6}", start_s)]);
            }
            cmd.extend_from_slice(&["-i".to_string(), path.clone()]);
        }
    }

    if !direct_visible_export {
        if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
            cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
        }
    }

    if direct_visible_export {
        let direct_duration_s = overlay_plan.duration_ticks as f64 / overlay_plan.timebase as f64;
        println!(
            "[fast_export] voie directe visible sans filtre overlay (duree_concat={:.3}s, duree_ui={:.3}s)",
            direct_duration_s, duration_s
        );
        cmd.extend_from_slice(&[
            "-map".to_string(),
            "0:v".to_string(),
            "-r".to_string(),
            fps.to_string(),
        ]);
        append_visible_video_args(
            &mut cmd,
            video_codec,
            prefer_hw,
            w,
            h,
            fps,
            performance_profile,
        );

        if have_audio {
            cmd.extend_from_slice(&["-map".to_string(), format!("{}:a", audio_start_idx)]);
            if can_stream_copy_simple_audio(&audio_paths[0], out_path) {
                println!("[fast_export] audio direct: copie sans reencodage");
                cmd.extend_from_slice(&["-c:a".to_string(), "copy".to_string()]);
            } else {
                println!("[fast_export] audio direct: fallback reencodage aac");
                cmd.extend_from_slice(&[
                    "-c:a".to_string(),
                    "aac".to_string(),
                    "-b:a".to_string(),
                    "320k".to_string(),
                ]);
            }
        } else {
            cmd.push("-an".to_string());
        }

        cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", direct_duration_s)]);
        let ext = Path::new(out_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
            cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
        }
        cmd.push(out_path.to_string());
        println!("[fast_export] commande directe complete: {}", cmd.join(" "));
        run_final_export_command(export_id, &cmd, direct_duration_s, &app_handle)?;

        if !Path::new(out_path).exists() {
            return Err(export_error("Le fichier de sortie n'a pas ete cree"));
        }

        return Ok(());
    }

    let mut filter_lines = Vec::new();
    filter_lines.push(format!(
        "[0:v]format=rgba,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps={},trim=start=0:end={:.6},setpts=PTS-STARTPTS,setsar=1[overlay_raw]",
        w, h, w, h, fps, duration_s
    ));

    let mut mapped_video_label;
    if export_without_background {
        mapped_video_label = "overlay_raw".to_string();
        if video_fade_in_enabled && export_fade_s > 0.0 {
            filter_lines.push(format!(
                "[{}]fade=t=in:st=0:d={:.6}:alpha=1[vfadein]",
                mapped_video_label, export_fade_s
            ));
            mapped_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled && export_fade_s > 0.0 {
            let fade_out_start = (duration_s - export_fade_s).max(0.0);
            filter_lines.push(format!(
                "[{}]fade=t=out:st={:.6}:d={:.6}:alpha=1[vfadeout]",
                mapped_video_label, fade_out_start, export_fade_s
            ));
            mapped_video_label = "vfadeout".to_string();
        }
        let alpha_format = if use_mov_alpha { "argb" } else { "yuva420p" };
        filter_lines.push(format!(
            "[{}]format={}[vout]",
            mapped_video_label, alpha_format
        ));
        mapped_video_label = "vout".to_string();
    } else {
        filter_lines
            .push("[overlay_raw]premultiply=inplace=1,format=yuva444p[overlay]".to_string());

        let bg_label = if let Some(idx) = black_background_idx {
            format!("{}:v", idx)
        } else if preprocessed_background_videos.len() > 1 {
            // Plusieurs backgrounds : tous sont normalisés par le pré-traitement
            let mut labels = Vec::new();
            let mut durations = Vec::new();
            for i in 0..preprocessed_background_videos.len() {
                let bg = &preprocessed_background_videos[i];
                let label = format!("bg{}", i);
                if bg.is_normalized {
                    filter_lines.push(format!(
                        "[{}:v]setpts=PTS-STARTPTS[bg{}]",
                        bg_start_idx + i,
                        i
                    ));
                    println!(
                        "[background] normalized=true redundant_scale_skipped=true idx={}",
                        i
                    );
                } else {
                    // Fallback: normaliser dans le graphe final
                    filter_lines.push(format!(
                        "[{}:v]setpts=PTS-STARTPTS,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,fps={},setsar=1[bg{}]",
                        bg_start_idx + i, w, h, w, h, fps, i
                    ));
                    println!("[background] normalized=false idx={}", i);
                }
                labels.push(label);
                durations.push(bg.duration_s);
            }
            build_background_transition_chain(
                &mut filter_lines,
                &labels,
                &durations,
                video_clip_transition_mode,
                video_clip_transition_s,
            )
        } else {
            format!("{}:v", bg_start_idx)
        };

        if black_background_idx.is_some() {
            filter_lines.push(format!("[{}]setsar=1[bg_normalized]", bg_label));
        } else {
            let bg_trim_end = duration_s.min(total_bg_s.max(0.001));
            let single_bg = preprocessed_background_videos.get(0);

            if let Some(bg) = single_bg {
                if bg.is_normalized {
                    // Background déjà à la bonne résolution, FPS et SAR
                    println!("[background] normalized=true redundant_scale_skipped=true");
                    filter_lines.push(format!(
                        "[{}]trim=start=0:end={:.6},setpts=PTS-STARTPTS[bgtrim]",
                        bg_label, bg_trim_end
                    ));
                } else {
                    // Background non normalisé (direct single pass ou fallback)
                    println!("[background] normalized=false (full filter chain)");
                    filter_lines.push(format!(
                        "[{}]setpts=PTS-STARTPTS,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,fps={},setsar=1,trim=end={:.6}[bgtrim]",
                        bg_label, w, h, w, h, fps, bg_trim_end
                    ));
                }
            } else {
                // Pas de background unique (ne devrait pas arriver)
                filter_lines.push(format!(
                    "[{}]trim=start=0:end={:.6},setpts=PTS-STARTPTS,scale=w={}:h={}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[bgtrim]",
                    bg_label, bg_trim_end, w, h, w, h
                ));
            }

            if total_bg_s + 1e-6 < duration_s {
                let tail_duration_s = duration_s - total_bg_s;
                filter_lines.push(format!(
                    "color=c=black:s={}x{}:r={}:d={:.6},setsar=1[bgtail]",
                    w, h, fps, tail_duration_s
                ));
                filter_lines.push("[bgtrim][bgtail]concat=n=2:v=1:a=0[bg_normalized]".to_string());
            } else {
                filter_lines.push("[bgtrim]setsar=1[bg_normalized]".to_string());
            }
        }

        filter_lines.push(
            "[bg_normalized][overlay]overlay=shortest=1:x=0:y=0:alpha=premultiplied,format=yuv420p[vcomposed]"
                .to_string(),
        );
        mapped_video_label = "vcomposed".to_string();
        if video_fade_in_enabled && export_fade_s > 0.0 {
            filter_lines.push(format!(
                "[{}]fade=t=in:st=0:d={:.6}[vfadein]",
                mapped_video_label, export_fade_s
            ));
            mapped_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled && export_fade_s > 0.0 {
            let fade_out_start = (duration_s - export_fade_s).max(0.0);
            filter_lines.push(format!(
                "[{}]fade=t=out:st={:.6}:d={:.6}[vfadeout]",
                mapped_video_label, fade_out_start, export_fade_s
            ));
            mapped_video_label = "vfadeout".to_string();
        }
    }

    let mut mapped_audio_label: Option<String> = None;
    if have_audio {
        if audio_paths.len() == 1 {
            filter_lines.push(format!("[{}:a]aresample=48000[aa0]", audio_start_idx));
            filter_lines.push(format!(
                "[aa0]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, duration_s
            ));
        } else {
            let mut inputs = String::new();
            for i in 0..audio_paths.len() {
                filter_lines.push(format!(
                    "[{}:a]aresample=48000[aa{}]",
                    audio_start_idx + i,
                    i
                ));
                inputs.push_str(&format!("[aa{}]", i));
            }
            filter_lines.push(format!(
                "{}concat=n={}:v=0:a=1[aacat]",
                inputs,
                audio_paths.len()
            ));
            filter_lines.push(format!(
                "[aacat]atrim=start={:.6},asetpts=PTS-STARTPTS,atrim=end={:.6}[aoutraw]",
                start_s, duration_s
            ));
        }

        let mut current_audio_label = "aoutraw".to_string();
        if audio_fade_in_enabled && export_fade_s > 0.0 {
            filter_lines.push(format!(
                "[{}]afade=t=in:st=0:d={:.6}[afadein]",
                current_audio_label, export_fade_s
            ));
            current_audio_label = "afadein".to_string();
        }
        if audio_fade_out_enabled && export_fade_s > 0.0 {
            let fade_out_start = (duration_s - export_fade_s).max(0.0);
            filter_lines.push(format!(
                "[{}]afade=t=out:st={:.6}:d={:.6}[afadeout]",
                current_audio_label, fade_out_start, export_fade_s
            ));
            current_audio_label = "afadeout".to_string();
        }
        mapped_audio_label = Some(current_audio_label);
    }

    let filter_complex = filter_lines.join(";");
    let fg_path = temp_dir.path.join("fast-export.ffgraph");
    fs::write(&fg_path, filter_complex)?;
    println!("[fast_export] filter_complex_script -> {:?}", fg_path);

    cmd.extend_from_slice(&[
        "-filter_complex_script".to_string(),
        fg_path.to_string_lossy().to_string(),
        "-map".to_string(),
        format!("[{}]", mapped_video_label),
        "-r".to_string(),
        fps.to_string(),
    ]);

    if export_without_background && use_mov_alpha {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "qtrle".to_string(),
            "-pix_fmt".to_string(),
            "argb".to_string(),
        ]);
    } else if export_without_background {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-crf".to_string(),
            "28".to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-row-mt".to_string(),
            "1".to_string(),
            "-cpu-used".to_string(),
            "2".to_string(),
            "-pix_fmt".to_string(),
            "yuva420p".to_string(),
        ]);
    } else {
        let (vcodec, vparams, vextra) = if video_codec == ExportVideoCodec::H265 {
            codec::choose_h265_codec(prefer_hw, w, h, performance_profile)
        } else {
            codec::choose_best_codec(prefer_hw, w, h, CodecUsage::Final, performance_profile)
        };
        cmd.extend_from_slice(&["-c:v".to_string(), vcodec.clone()]);
        if let Some(Some(preset)) = vextra.get("preset") {
            cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
        }
        cmd.extend(vparams);
        append_seek_friendly_gop_args(&mut cmd, &vcodec, fps);
    }

    if let Some(audio_label) = mapped_audio_label {
        cmd.extend_from_slice(&["-map".to_string(), format!("[{}]", audio_label)]);
        if export_without_background && !use_mov_alpha {
            cmd.extend_from_slice(&[
                "-c:a".to_string(),
                "libopus".to_string(),
                "-b:a".to_string(),
                "256k".to_string(),
            ]);
        } else {
            cmd.extend_from_slice(&[
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        }
    } else {
        cmd.push("-an".to_string());
    }

    cmd.extend_from_slice(&["-t".to_string(), format!("{:.6}", duration_s)]);
    let ext = Path::new(out_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(ext.as_str(), "mp4" | "mov" | "m4v") {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }
    cmd.push(out_path.to_string());

    run_final_export_command(export_id, &cmd, duration_s, &app_handle)?;

    if !Path::new(out_path).exists() {
        return Err(export_error("Le fichier de sortie n'a pas ete cree"));
    }

    Ok(())
}

/// Construit la chaîne FFmpeg des vidéos de fond avec transition optionnelle.
///
/// # Arguments
/// * `filter_lines` - Lignes du filtre complexe à compléter.
/// * `labels` - Labels vidéo normalisés à assembler.
/// * `durations_s` - Durée de chaque label en secondes.
/// * `mode` - Mode de transition demandé.
/// * `transition_s` - Durée de transition en secondes.
///
/// # Retourne
/// Le label vidéo final à utiliser comme fond.
fn build_background_transition_chain(
    filter_lines: &mut Vec<String>,
    labels: &[String],
    durations_s: &[f64],
    mode: VideoClipTransitionMode,
    transition_s: f64,
) -> String {
    if labels.len() <= 1 || mode == VideoClipTransitionMode::None || transition_s <= 1e-6 {
        let mut inputs = String::new();
        for label in labels {
            inputs.push_str(&format!("[{}]", label));
        }
        let out = "bgcat".to_string();
        filter_lines.push(format!(
            "{}concat=n={}:v=1:a=0[{}]",
            inputs,
            labels.len(),
            out
        ));
        return out;
    }

    match mode {
        VideoClipTransitionMode::FadeThroughBlack => {
            let mut inputs = String::new();
            for (index, label) in labels.iter().enumerate() {
                let duration_s = durations_s.get(index).copied().unwrap_or(0.0).max(0.001);
                let fade_s = transition_s.min(duration_s / 2.0);
                let mut filters = Vec::new();
                if index > 0 {
                    filters.push(format!("fade=t=in:st=0:d={:.6}", fade_s));
                }
                if index + 1 < labels.len() {
                    filters.push(format!(
                        "fade=t=out:st={:.6}:d={:.6}",
                        (duration_s - fade_s).max(0.0),
                        fade_s
                    ));
                }

                let out = format!("bgb{}", index);
                if filters.is_empty() {
                    filter_lines.push(format!("[{}]setpts=PTS-STARTPTS[{}]", label, out));
                } else {
                    filter_lines.push(format!("[{}]{}[{}]", label, filters.join(","), out));
                }
                inputs.push_str(&format!("[{}]", out));
            }

            filter_lines.push(format!(
                "{}concat=n={}:v=1:a=0[bgcat]",
                inputs,
                labels.len()
            ));
            "bgcat".to_string()
        }
        VideoClipTransitionMode::Crossfade => {
            let normalized_labels: Vec<String> = labels
                .iter()
                .enumerate()
                .map(|(index, label)| {
                    let out = format!("bgxf{}", index);
                    filter_lines.push(format!(
                        "[{}]setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv444p,setsar=1[{}]",
                        label, out
                    ));
                    out
                })
                .collect();
            let mut current = normalized_labels[0].clone();
            let mut current_duration = durations_s.first().copied().unwrap_or(0.001).max(0.001);

            for index in 0..(normalized_labels.len() - 1) {
                let next_duration = durations_s
                    .get(index + 1)
                    .copied()
                    .unwrap_or(0.001)
                    .max(0.001);
                let fade_s = transition_s.min(current_duration).min(next_duration);
                let out = format!("bgx{}", index);
                if fade_s <= 1e-6 {
                    filter_lines.push(format!(
                        "[{}][{}]concat=n=2:v=1:a=0[{}]",
                        current,
                        normalized_labels[index + 1],
                        out
                    ));
                    current_duration += next_duration;
                } else {
                    filter_lines.push(format!(
                        "[{}][{}]xfade=transition=fade:duration={:.6}:offset={:.6},setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv444p,setsar=1[{}]",
                        current,
                        normalized_labels[index + 1],
                        fade_s,
                        (current_duration - fade_s).max(0.0),
                        out
                    ));
                    current_duration = current_duration + next_duration - fade_s;
                }
                current = out;
            }

            current
        }
        VideoClipTransitionMode::None => unreachable!(),
    }
}

// ---------------------------------------------------------------------------
// Commande Tauri : cancel_export
// ---------------------------------------------------------------------------

/// Annule un export en cours.
///
/// Marque l'export comme annulé (vérifié par `ensure_export_not_cancelled`)
/// et tue le processus FFmpeg associé s'il est encore actif.
#[tauri::command]
pub fn cancel_export(export_id: String) -> Result<String, String> {
    println!(
        "[cancel_export] Demande d'annulation pour export_id: {}",
        export_id
    );
    ffmpeg_runner::mark_export_cancelled(&export_id);

    let mut active_exports = constants::ACTIVE_EXPORTS
        .lock()
        .map_err(|_| "Failed to lock active exports")?;

    if let Some(process_ref) = active_exports.remove(&export_id) {
        if let Ok(mut process_guard) = process_ref.lock() {
            if let Some(mut child) = process_guard.take() {
                match child.kill() {
                    Ok(_) => {
                        println!(
                            "[cancel_export] Processus FFmpeg tué avec succès pour export_id: {}",
                            export_id
                        );
                        let _ = child.wait(); // Nettoyer le processus zombie
                        Ok(format!("Export {} annulé avec succès", export_id))
                    }
                    Err(e) => {
                        println!(
                            "[cancel_export] Erreur lors de l'arrêt du processus: {:?}",
                            e
                        );
                        Err(format!("Erreur lors de l'annulation: {}", e))
                    }
                }
            } else {
                println!(
                    "[cancel_export] Aucun processus actif trouvé pour export_id: {}",
                    export_id
                );
                Err(format!("Aucun processus actif pour l'export {}", export_id))
            }
        } else {
            Err("Failed to lock process".to_string())
        }
    } else {
        println!(
            "[cancel_export] Export_id non trouvé dans les exports actifs: {}",
            export_id
        );
        Ok(format!("Annulation demandée pour l'export {}", export_id))
    }
}

// ---------------------------------------------------------------------------
// Commande Tauri : concat_videos
// ---------------------------------------------------------------------------

/// Concatène plusieurs vidéos en une seule.
///
/// Supporte les fades vidéo/audio optionnels, l'export transparent
/// (MOV ProRes ou WebM VP9 avec alpha), et le stream-copy quand aucun
/// traitement n'est nécessaire.
#[tauri::command]
pub async fn concat_videos(
    export_id: String,
    video_paths: Vec<String>,
    output_path: String,
    video_fade_in_enabled: Option<bool>,
    video_fade_out_enabled: Option<bool>,
    audio_fade_in_enabled: Option<bool>,
    audio_fade_out_enabled: Option<bool>,
    export_fade_duration_ms: Option<i32>,
    export_without_background: Option<bool>,
    transparent_export_format: Option<String>,
    video_codec: Option<ExportVideoCodec>,
    performance_profile: ExportPerformanceProfile,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Normalisation des chemins
    let normalized_video_paths: Vec<String> = video_paths
        .into_iter()
        .map(|p| {
            path_utils::normalize_existing_path(&p)
                .to_string_lossy()
                .to_string()
        })
        .collect();
    let output_path_buf = path_utils::normalize_output_path(&output_path);
    let output_path_str = output_path_buf.to_string_lossy().to_string();

    println!(
        "[concat_videos] Début de la concaténation de {} vidéos",
        normalized_video_paths.len()
    );
    println!("[concat_videos] Fichier de sortie: {}", output_path_str);
    println!(
        "[concat_videos] export_fade: video(in={}, out={}) audio(in={}, out={}) duration(ms)={}",
        video_fade_in_enabled.unwrap_or(false),
        video_fade_out_enabled.unwrap_or(false),
        audio_fade_in_enabled.unwrap_or(false),
        audio_fade_out_enabled.unwrap_or(false),
        export_fade_duration_ms.unwrap_or(0)
    );
    println!(
        "[concat_videos] export_without_background={}",
        export_without_background.unwrap_or(false)
    );
    println!(
        "[concat_videos] transparent_export_format={}",
        transparent_export_format
            .as_deref()
            .unwrap_or("mov_prores_4444")
    );
    let video_codec = video_codec.unwrap_or(ExportVideoCodec::H264);

    let apply_video_fade =
        video_fade_in_enabled.unwrap_or(false) || video_fade_out_enabled.unwrap_or(false);
    let apply_audio_fade =
        audio_fade_in_enabled.unwrap_or(false) || audio_fade_out_enabled.unwrap_or(false);
    let apply_any_fade = apply_video_fade || apply_audio_fade;
    let use_mov_alpha = batching::transparent_export_uses_mov(
        export_without_background.unwrap_or(false),
        transparent_export_format.as_deref(),
    );
    let total_duration_s: f64 = normalized_video_paths
        .iter()
        .map(|p| ffmpeg_utils::ffprobe_duration_sec(p))
        .sum();
    let fade_s = (export_fade_duration_ms.unwrap_or(0) as f64 / 1000.0)
        .max(0.0)
        .min(total_duration_s.max(0.0));

    if normalized_video_paths.is_empty() {
        return Err("Aucune vidéo fournie pour la concaténation".to_string());
    }

    // Cas trivial : une seule vidéo sans fades → copie simple
    if normalized_video_paths.len() == 1 && !apply_any_fade {
        println!("[concat_videos] Une seule vidéo, copie vers le fichier final");
        std::fs::copy(&normalized_video_paths[0], &output_path_str)
            .map_err(|e| format!("Erreur lors de la copie: {}", e))?;
        return Ok(output_path_str);
    }

    // Créer le dossier de sortie
    if let Some(parent) = output_path_buf.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Erreur création dossier de sortie: {}", e))?;
    }

    // Vérification de l'existence des fichiers
    for video_path in &normalized_video_paths {
        if !Path::new(video_path).exists() {
            return Err(format!("Fichier vidéo non trouvé: {}", video_path));
        }
    }

    // Vérification de la présence d'audio dans chaque segment
    let audio_presence: Vec<bool> = normalized_video_paths
        .iter()
        .map(|p| ffmpeg_utils::video_has_audio(p))
        .collect();
    let all_have_audio = !audio_presence.is_empty() && audio_presence.iter().all(|&has| has);
    let any_have_audio = audio_presence.iter().any(|&has| has);
    if any_have_audio && !all_have_audio {
        println!(
            "[concat_videos][warn] Certains segments n'ont pas d'audio; l'audio final sera désactivé"
        );
    }

    // Voie rapide : stream copy sans ré-encodage
    if !apply_any_fade
        && !export_without_background.unwrap_or(false)
        && (!any_have_audio || all_have_audio)
    {
        concat::concat_videos_with_stream_copy(
            &export_id,
            &normalized_video_paths,
            &output_path_str,
            total_duration_s,
            &app,
        )
        .map_err(|e| format!("Erreur concaténation stream-copy FFmpeg: {}", e))?;
        return Ok(output_path_str);
    }

    // Voie complète : ré-encodage avec filtre complexe
    let ffmpeg_exe = ffmpeg_utils::resolve_ffmpeg_binary().unwrap_or_else(|| "ffmpeg".to_string());
    let mut cmd = vec![
        ffmpeg_exe,
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "warning".to_string(),
        "-nostats".to_string(),
        "-progress".to_string(),
        "pipe:2".to_string(),
    ];

    for video_path in &normalized_video_paths {
        cmd.extend_from_slice(&["-i".to_string(), video_path.clone()]);
    }

    if let Some(thread_cap) = codec::compute_ffmpeg_thread_cap(performance_profile) {
        cmd.extend_from_slice(&["-threads".to_string(), thread_cap.to_string()]);
    }

    // Construction du filtre complexe
    let mut filter_lines: Vec<String> = Vec::new();
    let mut video_inputs = String::new();
    for idx in 0..normalized_video_paths.len() {
        filter_lines.push(format!("[{}:v]setpts=PTS-STARTPTS[v{}]", idx, idx));
        video_inputs.push_str(&format!("[v{}]", idx));
    }
    filter_lines.push(format!(
        "{}concat=n={}:v=1:a=0[vcat]",
        video_inputs,
        normalized_video_paths.len()
    ));

    // Fades vidéo
    let mut current_video_label = "vcat".to_string();
    if apply_video_fade && fade_s > 0.0 {
        if video_fade_in_enabled.unwrap_or(false) {
            let fade_expr = if export_without_background.unwrap_or(false) {
                format!("fade=t=in:st=0:d={:.6}:alpha=1", fade_s)
            } else {
                format!("fade=t=in:st=0:d={:.6}", fade_s)
            };
            filter_lines.push(format!("[{}]{}[vfadein]", current_video_label, fade_expr));
            current_video_label = "vfadein".to_string();
        }
        if video_fade_out_enabled.unwrap_or(false) {
            let fade_out_start = (total_duration_s - fade_s).max(0.0);
            let fade_expr = if export_without_background.unwrap_or(false) {
                format!(
                    "fade=t=out:st={:.6}:d={:.6}:alpha=1",
                    fade_out_start, fade_s
                )
            } else {
                format!("fade=t=out:st={:.6}:d={:.6}", fade_out_start, fade_s)
            };
            filter_lines.push(format!("[{}]{}[vfadeout]", current_video_label, fade_expr));
            current_video_label = "vfadeout".to_string();
        }
    }

    // Audio
    let mut current_audio_label: Option<String> = None;
    if all_have_audio {
        let mut audio_inputs = String::new();
        for idx in 0..normalized_video_paths.len() {
            filter_lines.push(format!(
                "[{}:a]aresample=48000,asetpts=PTS-STARTPTS[a{}]",
                idx, idx
            ));
            audio_inputs.push_str(&format!("[a{}]", idx));
        }
        filter_lines.push(format!(
            "{}concat=n={}:v=0:a=1[acat]",
            audio_inputs,
            normalized_video_paths.len()
        ));

        let mut audio_label = "acat".to_string();
        if apply_audio_fade && fade_s > 0.0 {
            if audio_fade_in_enabled.unwrap_or(false) {
                filter_lines.push(format!(
                    "[{}]afade=t=in:st=0:d={:.6}[afadein]",
                    audio_label, fade_s
                ));
                audio_label = "afadein".to_string();
            }
            if audio_fade_out_enabled.unwrap_or(false) {
                let fade_out_start = (total_duration_s - fade_s).max(0.0);
                filter_lines.push(format!(
                    "[{}]afade=t=out:st={:.6}:d={:.6}[afadeout]",
                    audio_label, fade_out_start, fade_s
                ));
                audio_label = "afadeout".to_string();
            }
        }
        current_audio_label = Some(audio_label);
    }

    cmd.extend_from_slice(&[
        "-filter_complex".to_string(),
        filter_lines.join(";"),
        "-map".to_string(),
        format!("[{}]", current_video_label),
    ]);

    // Codec vidéo selon le type d'export
    if export_without_background.unwrap_or(false) && use_mov_alpha {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "qtrle".to_string(),
            "-pix_fmt".to_string(),
            "argb".to_string(),
        ]);
    } else if export_without_background.unwrap_or(false) {
        cmd.extend_from_slice(&[
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-crf".to_string(),
            "28".to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-row-mt".to_string(),
            "1".to_string(),
            "-cpu-used".to_string(),
            "2".to_string(),
            "-pix_fmt".to_string(),
            "yuva420p".to_string(),
        ]);
    } else {
        if video_codec == ExportVideoCodec::H265 {
            let (vcodec, vparams, vextra) =
                codec::choose_h265_codec(true, 0, 0, performance_profile);
            cmd.extend_from_slice(&["-c:v".to_string(), vcodec]);
            if let Some(Some(preset)) = vextra.get("preset") {
                cmd.extend_from_slice(&["-preset".to_string(), preset.clone()]);
            }
            cmd.extend(vparams);
        } else {
            cmd.extend_from_slice(&[
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "veryfast".to_string(),
                "-crf".to_string(),
                "18".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
    }

    // Codec audio
    if let Some(audio_label) = current_audio_label {
        if export_without_background.unwrap_or(false) && use_mov_alpha {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        } else if export_without_background.unwrap_or(false) {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "libopus".to_string(),
                "-b:a".to_string(),
                "256k".to_string(),
            ]);
        } else {
            cmd.extend_from_slice(&[
                "-map".to_string(),
                format!("[{}]", audio_label),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "320k".to_string(),
            ]);
        }
    } else {
        cmd.push("-an".to_string());
    }

    if !export_without_background.unwrap_or(false) {
        cmd.extend_from_slice(&["-movflags".to_string(), "+faststart".to_string()]);
    }
    cmd.push(output_path_str.clone());

    println!("[concat_videos] Exécution de FFmpeg...");

    let progress_context = FfmpegProgressContext {
        base_time_s: 0.0,
        total_time_s: total_duration_s.max(0.001),
        local_duration_s: total_duration_s.max(0.001),
        suppress_error_event: false,
        current_batch_size: None,
    };

    ffmpeg_runner::run_ffmpeg_command(
        &export_id,
        &cmd,
        Some(progress_context),
        Some("Merging Files"),
        None,
        &app,
    )
    .map_err(|e| format!("Erreur exécution FFmpeg: {}", e))?;

    if !Path::new(&output_path_str).exists() {
        return Err("Le fichier de sortie n'a pas été créé".to_string());
    }

    println!(
        "[concat_videos] ✅ Concaténation réussie: {}",
        output_path_str
    );
    Ok(output_path_str)
}
