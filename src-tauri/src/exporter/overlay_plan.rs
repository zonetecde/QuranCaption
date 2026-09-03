use rayon::prelude::*;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::ffmpeg_runner;

type ExportError = Box<dyn std::error::Error + Send + Sync + 'static>;
type ExportResult<T> = Result<T, ExportError>;

pub(super) struct TempExportDir {
    pub(super) path: PathBuf,
}

impl Drop for TempExportDir {
    /// Supprime le dossier temporaire de l'export rapide.
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).ok();
    }
}

struct FastImage {
    pub(super) width: u32,
    pub(super) height: u32,
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
    pub(super) duration_ticks: u128,
    numerator: u64,
    denominator: u64,
}

/// Format des images temporaires du plan overlay.
#[derive(Clone, Copy, Debug)]
pub(super) enum OverlayFrameFormat {
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

pub(super) struct FastOverlayPlan {
    pub(super) concat_path: PathBuf,
    pub(super) generated_fade_frames: usize,
    pub(super) source_frame_count: usize,
    pub(super) width: i32,
    pub(super) height: i32,
    pub(super) all_frames_opaque: bool,
    pub(super) composited_to_black: bool,
    pub(super) duration_ticks: u128,
    pub(super) timebase: u128,
}

/// Cree une erreur simple pour la voie d'export rapide.
pub(super) fn export_error(message: impl Into<String>) -> ExportError {
    Box::new(io::Error::new(io::ErrorKind::Other, message.into()))
}

/// Cree un dossier temporaire unique pour les fichiers intermediaires.
pub(super) fn create_temp_export_dir(export_id: &str) -> ExportResult<TempExportDir> {
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
pub(super) fn is_no_space_left_error(error: &(dyn std::error::Error + 'static)) -> bool {
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
pub(super) fn build_overlay_concat_plan(
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
