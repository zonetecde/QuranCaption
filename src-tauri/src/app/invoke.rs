use crate::commands;
use crate::exporter;

/// Enregistre la liste unique des commandes IPC exposées au frontend.
pub fn register_invoke_handler(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        commands::downloads::download_from_youtube,
        commands::media::get_duration,
        commands::files::get_new_file_path,
        commands::files::save_binary_file,
        commands::files::save_file,
        commands::files::download_file,
        commands::files::delete_file,
        commands::files::move_file,
        commands::media::get_system_fonts,
        commands::media::open_explorer_with_file_selected,
        commands::media::get_video_dimensions,
        exporter::commands::export_video,
        exporter::commands::cancel_export,
        exporter::commands::concat_videos,
        commands::media::convert_audio_to_cbr,
        commands::media::cut_audio,
        commands::media::cut_video,
        commands::media::concat_audio,
        commands::segmentation::segment_quran_audio,
        commands::segmentation::estimate_segmentation_duration,
        commands::segmentation::segment_quran_audio_local,
        commands::segmentation::segment_quran_audio_local_multi,
        commands::segmentation::check_local_segmentation_ready,
        commands::segmentation::install_local_segmentation_deps,
        commands::discord::init_discord_rpc,
        commands::discord::update_discord_activity,
        commands::discord::clear_discord_activity,
        commands::discord::close_discord_rpc,
        commands::waveform::get_audio_waveform,
        commands::diagnostics::diagnose_media_binaries
    ])
}
