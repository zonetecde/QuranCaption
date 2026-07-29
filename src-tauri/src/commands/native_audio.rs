use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioState {
    position_ms: i64,
    is_playing: bool,
    ended: bool,
}

/// Charge l'audio dans Media3 sur Android.
///
/// @param file_path Chemin absolu du fichier audio.
/// @param position_ms Position initiale en millisecondes.
/// @param speed Vitesse de lecture.
/// @param volume Volume compris entre 0 et 1.
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_load(
    file_path: String,
    position_ms: i64,
    speed: f32,
    volume: f32,
) -> Result<(), String> {
    native(|player| player.load(&file_path, position_ms, speed, volume))
}

/// Lance Media3 à la position demandée.
///
/// @param position_ms Position en millisecondes dans le fichier.
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_play(position_ms: i64) -> Result<(), String> {
    native(|player| player.play(position_ms))
}

/// Met Media3 en pause.
///
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_pause() -> Result<(), String> {
    native(|player| player.pause())
}

/// Déplace Media3 à la position demandée.
///
/// @param position_ms Position cible en millisecondes.
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_seek(position_ms: i64) -> Result<(), String> {
    native(|player| player.seek(position_ms))
}

/// Modifie la vitesse de Media3.
///
/// @param speed Nouvelle vitesse de lecture.
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_set_speed(speed: f32) -> Result<(), String> {
    native(|player| player.set_speed(speed))
}

/// Modifie le volume de Media3.
///
/// @param volume Volume compris entre 0 et 1.
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_set_volume(volume: f32) -> Result<(), String> {
    native(|player| player.set_volume(volume))
}

/// Retourne l'état courant de Media3.
///
/// @returns Position et état de lecture natifs.
#[tauri::command]
pub fn native_audio_get_state() -> Result<NativeAudioState, String> {
    native(|player| {
        let state = player.state()?;
        Ok(NativeAudioState {
            position_ms: state[0],
            is_playing: state[1] == 1,
            ended: state[2] == 1,
        })
    })
}

/// Libère le lecteur Media3.
///
/// @returns Erreur native éventuelle.
#[tauri::command]
pub fn native_audio_release() -> Result<(), String> {
    native(|player| player.release())
}

/// Exécute une commande sur le lecteur Android ou refuse sur les autres plateformes.
///
/// @param command Commande à exécuter avec le lecteur.
/// @returns Résultat produit par le lecteur natif.
#[cfg(target_os = "android")]
fn native<T>(
    command: impl FnOnce(super::android_media::AndroidAudioPlayer) -> Result<T, String>,
) -> Result<T, String> {
    command(super::android_media::AndroidAudioPlayer::new()?)
}

/// Refuse une commande Media3 hors Android afin de préserver le fallback Howler.
///
/// @param command Commande native inutilisée hors Android.
/// @returns Erreur indiquant que Media3 est indisponible.
#[cfg(not(target_os = "android"))]
fn native<T>(
    _command: impl FnOnce(AndroidAudioPlayerUnavailable) -> Result<T, String>,
) -> Result<T, String> {
    Err("Native audio is only available on Android".to_string())
}

#[cfg(not(target_os = "android"))]
pub struct AndroidAudioPlayerUnavailable;

#[cfg(not(target_os = "android"))]
impl AndroidAudioPlayerUnavailable {
    /// Refuse le chargement natif hors Android.
    pub fn load(&self, _: &str, _: i64, _: f32, _: f32) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse la lecture native hors Android.
    pub fn play(&self, _: i64) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse la pause native hors Android.
    pub fn pause(&self) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse le déplacement natif hors Android.
    pub fn seek(&self, _: i64) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse la vitesse native hors Android.
    pub fn set_speed(&self, _: f32) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse le volume natif hors Android.
    pub fn set_volume(&self, _: f32) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse la lecture d'état native hors Android.
    pub fn state(&self) -> Result<[i64; 3], String> {
        Err("Native audio is unavailable".to_string())
    }
    /// Refuse la libération native hors Android.
    pub fn release(&self) -> Result<(), String> {
        Err("Native audio is unavailable".to_string())
    }
}
