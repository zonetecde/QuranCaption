/// Commandes d'export vidéo et concaténation.
///
/// Ce module est découpé en sous-modules spécialisés pour faciliter la
/// maintenance et la lisibilité :
///
/// - `types`      : structs, enums et types partagés
/// - `constants`  : constantes de configuration et statiques globales
/// - `ffmpeg_runner` : exécution FFmpeg, progression, annulation
/// - `ffmpeg_utils`  : résolution des binaires, ffprobe, chemins temporaires
/// - `memory`     : surveillance de la RAM système
/// - `codec`      : détection et sélection des codecs (NVENC, VideoToolbox, etc.)
/// - `preprocess` : pré-traitement des vidéos de fond
/// - `batching`   : utilitaires de calcul de batch et timing
/// - `concat`     : concaténation et muxage des vidéos
/// - `filter_graph` : construction du filtre complexe FFmpeg (avec batching)
/// - `commands`   : commandes Tauri exposées au frontend
#[allow(dead_code)]
pub mod batching;
pub mod codec;
pub mod commands;
#[allow(dead_code)]
pub mod concat;
#[allow(dead_code)]
pub mod constants;
pub mod ffmpeg_runner;
pub mod ffmpeg_utils;
#[allow(dead_code)]
pub mod filter_graph;
pub mod memory;
pub mod preprocess;
#[allow(dead_code)]
pub mod types;
