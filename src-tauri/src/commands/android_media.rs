use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use jni::objects::{JLongArray, JObject, JString, JValue};
use jni::JavaVM;
use tauri_plugin_android_media::AndroidMediaExt;

const METADATA_KEY_DURATION: i32 = 9;
const METADATA_KEY_HAS_AUDIO: i32 = 16;
const METADATA_KEY_VIDEO_WIDTH: i32 = 18;
const METADATA_KEY_VIDEO_HEIGHT: i32 = 19;
static ANDROID_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Résultat d'une commande FFmpegKit Android.
pub struct AndroidFfmpegOutput {
    pub success: bool,
    pub output: String,
}

/// Conserve le handle Tauri nécessaire aux conversions FFmpegKit partagées.
///
/// @param app_handle Handle de l'application Android initialisée.
/// @returns Erreur si un autre handle avait déjà été enregistré.
pub fn initialize_ffmpeg(app_handle: tauri::AppHandle) -> Result<(), String> {
    ANDROID_APP_HANDLE
        .set(app_handle)
        .map_err(|_| "Android FFmpeg handle is already initialized".to_string())
}

/// Autorise le paysage Android ou restaure le verrouillage en portrait.
///
/// @param allowed `true` pour suivre le capteur, `false` pour forcer le portrait.
/// @returns Erreur JNI éventuelle.
pub fn set_landscape_allowed(allowed: bool) -> Result<(), String> {
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
        .map_err(|e| format!("Unable to access Android JVM: {}", e))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Unable to attach Android orientation thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(context.context().cast()) };
    env.call_method(
        &activity,
        "nativeSetLandscapeAllowed",
        "(Z)V",
        &[JValue::Bool(if allowed { 1 } else { 0 })],
    )
    .map_err(|e| format!("Unable to update Android orientation: {}", e))?;
    Ok(())
}

/// Exécute FFmpegKit dans Android avec une liste d'arguments préservée.
///
/// @param arguments Arguments FFmpeg sans le nom du binaire.
/// @returns Code de réussite et sortie complète de FFmpegKit.
pub fn execute_ffmpeg(arguments: &[String]) -> Result<AndroidFfmpegOutput, String> {
    let app_handle = ANDROID_APP_HANDLE
        .get()
        .ok_or_else(|| "Android FFmpeg handle is not initialized".to_string())?;
    let session_id = app_handle
        .android_media()
        .start_ffmpeg(arguments.to_vec())
        .map_err(|error| error.to_string())?;

    loop {
        let snapshot = match app_handle.android_media().poll_ffmpeg(session_id) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let _ = app_handle.android_media().cancel_ffmpeg(session_id);
                return Err(error.to_string());
            }
        };
        if snapshot.state == "COMPLETED" || snapshot.state == "FAILED" {
            let output = if snapshot.failure_stack_trace.is_empty() {
                snapshot.output
            } else {
                format!("{}\n{}", snapshot.output, snapshot.failure_stack_trace)
            };
            return Ok(AndroidFfmpegOutput {
                success: snapshot.return_code == Some(0),
                output,
            });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Exécute FFprobeKit dans Android avec une liste d'arguments préservée.
///
/// @param arguments Arguments FFprobe sans le nom du binaire.
/// @returns Code de réussite et sortie complète de FFprobeKit.
pub fn execute_ffprobe(arguments: &[String]) -> Result<AndroidFfmpegOutput, String> {
    let app_handle = ANDROID_APP_HANDLE
        .get()
        .ok_or_else(|| "Android FFmpeg handle is not initialized".to_string())?;
    let (success, output) = app_handle
        .android_media()
        .execute_ffprobe(arguments.to_vec())
        .map_err(|error| error.to_string())?;
    Ok(AndroidFfmpegOutput { success, output })
}

pub struct AndroidAudioPlayer {
    vm: JavaVM,
}

impl AndroidAudioPlayer {
    /// Ouvre une passerelle vers le singleton Media3 Android.
    ///
    /// @returns Passerelle JNI prête à recevoir des commandes.
    pub fn new() -> Result<Self, String> {
        let context = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
            .map_err(|e| format!("Unable to access Android JVM: {}", e))?;
        Ok(Self { vm })
    }

    /// Charge un fichier dans Media3.
    ///
    /// @param path Chemin absolu du fichier audio.
    /// @param position_ms Position initiale en millisecondes.
    /// @param speed Vitesse de lecture.
    /// @param volume Volume compris entre 0 et 1.
    /// @returns Erreur JNI éventuelle.
    pub fn load(
        &self,
        path: &str,
        position_ms: i64,
        speed: f32,
        volume: f32,
    ) -> Result<(), String> {
        let mut env = self.env()?;
        let path = env
            .new_string(path)
            .map_err(|e| format!("Unable to build Android audio path: {}", e))?;
        let path = JObject::from(path);
        let activity = Self::activity();
        env.call_method(
            &activity,
            "nativeAudioLoad",
            "(Ljava/lang/String;JFF)V",
            &[
                JValue::Object(&path),
                JValue::Long(position_ms),
                JValue::Float(speed),
                JValue::Float(volume),
            ],
        )
        .map_err(|e| format!("Unable to load Android audio: {}", e))?;
        Ok(())
    }

    /// Lance Media3 à une position donnée.
    ///
    /// @param position_ms Position de départ en millisecondes.
    /// @returns Erreur JNI éventuelle.
    pub fn play(&self, position_ms: i64) -> Result<(), String> {
        self.call_long("nativeAudioPlay", position_ms)
    }

    /// Met Media3 en pause.
    ///
    /// @returns Erreur JNI éventuelle.
    pub fn pause(&self) -> Result<(), String> {
        self.call_void("nativeAudioPause")
    }

    /// Déplace Media3 à une position donnée.
    ///
    /// @param position_ms Position cible en millisecondes.
    /// @returns Erreur JNI éventuelle.
    pub fn seek(&self, position_ms: i64) -> Result<(), String> {
        self.call_long("nativeAudioSeek", position_ms)
    }

    /// Modifie la vitesse de Media3.
    ///
    /// @param speed Nouvelle vitesse de lecture.
    /// @returns Erreur JNI éventuelle.
    pub fn set_speed(&self, speed: f32) -> Result<(), String> {
        self.call_float("nativeAudioSetSpeed", speed)
    }

    /// Modifie le volume de Media3.
    ///
    /// @param volume Volume compris entre 0 et 1.
    /// @returns Erreur JNI éventuelle.
    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.call_float("nativeAudioSetVolume", volume)
    }

    /// Lit la position, l'état de lecture et l'état de fin Media3.
    ///
    /// @returns Tableau d'état du lecteur.
    pub fn state(&self) -> Result<[i64; 3], String> {
        let mut env = self.env()?;
        let activity = Self::activity();
        let array = env
            .call_method(&activity, "nativeAudioGetState", "()[J", &[])
            .and_then(|value| value.l())
            .map(JLongArray::from)
            .map_err(|e| format!("Unable to read Android audio state: {}", e))?;
        let mut state = [0_i64; 3];
        env.get_long_array_region(&array, 0, &mut state)
            .map_err(|e| format!("Unable to decode Android audio state: {}", e))?;
        Ok(state)
    }

    /// Libère Media3.
    ///
    /// @returns Erreur JNI éventuelle.
    pub fn release(&self) -> Result<(), String> {
        self.call_void("nativeAudioRelease")
    }

    /// Attache le thread courant à la JVM Android.
    ///
    /// @returns Environnement JNI attaché.
    fn env(&self) -> Result<jni::AttachGuard<'_>, String> {
        self.vm
            .attach_current_thread()
            .map_err(|e| format!("Unable to attach Android JVM thread: {}", e))
    }

    /// Retourne l'activité Tauri conservée par le contexte Android.
    ///
    /// @returns Référence JNI vers MainActivity.
    fn activity<'a>() -> JObject<'a> {
        let context = ndk_context::android_context();
        unsafe { JObject::from_raw(context.context().cast()) }
    }

    /// Appelle une méthode Media3 sans argument.
    ///
    /// @param method Nom de la méthode Kotlin.
    /// @returns Erreur JNI éventuelle.
    fn call_void(&self, method: &str) -> Result<(), String> {
        let mut env = self.env()?;
        let activity = Self::activity();
        env.call_method(&activity, method, "()V", &[])
            .map_err(|e| format!("Unable to call Android audio {}: {}", method, e))?;
        Ok(())
    }

    /// Appelle une méthode Media3 avec une position.
    ///
    /// @param method Nom de la méthode Kotlin.
    /// @param value Valeur longue transmise.
    /// @returns Erreur JNI éventuelle.
    fn call_long(&self, method: &str, value: i64) -> Result<(), String> {
        let mut env = self.env()?;
        let activity = Self::activity();
        env.call_method(&activity, method, "(J)V", &[JValue::Long(value)])
            .map_err(|e| format!("Unable to call Android audio {}: {}", method, e))?;
        Ok(())
    }

    /// Appelle une méthode Media3 avec une valeur flottante.
    ///
    /// @param method Nom de la méthode Kotlin.
    /// @param value Valeur flottante transmise.
    /// @returns Erreur JNI éventuelle.
    fn call_float(&self, method: &str, value: f32) -> Result<(), String> {
        let mut env = self.env()?;
        let activity = Self::activity();
        env.call_method(&activity, method, "(F)V", &[JValue::Float(value)])
            .map_err(|e| format!("Unable to call Android audio {}: {}", method, e))?;
        Ok(())
    }
}

/// Lit la durée d'un média via MediaMetadataRetriever Android.
///
/// @param file_path Chemin du fichier média à analyser.
/// @returns Durée en millisecondes.
pub fn get_duration_ms(file_path: &Path) -> Result<i64, String> {
    with_retriever(file_path, |env, retriever| {
        let duration = extract_metadata(env, retriever, METADATA_KEY_DURATION)?
            .ok_or_else(|| "Android media duration metadata is missing".to_string())?;
        duration
            .parse::<i64>()
            .map_err(|e| format!("Android media duration metadata is invalid: {}", e))
    })
}

/// Indique si un média expose une piste audio via MediaMetadataRetriever Android.
///
/// @param file_path Chemin du fichier média à analyser.
/// @returns `true` lorsque la métadonnée Android confirme une piste audio.
pub fn has_audio(file_path: &Path) -> Result<bool, String> {
    with_retriever(file_path, |env, retriever| {
        Ok(extract_metadata(env, retriever, METADATA_KEY_HAS_AUDIO)?
            .map(|value| value.eq_ignore_ascii_case("yes") || value == "1")
            .unwrap_or(false))
    })
}

/// Lit les dimensions vidéo via MediaMetadataRetriever Android.
///
/// @param file_path Chemin du fichier média à analyser.
/// @returns Largeur et hauteur vidéo.
pub fn get_video_dimensions(file_path: &Path) -> Result<(i64, i64), String> {
    with_retriever(file_path, |env, retriever| {
        let width = extract_metadata(env, retriever, METADATA_KEY_VIDEO_WIDTH)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let height = extract_metadata(env, retriever, METADATA_KEY_VIDEO_HEIGHT)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);

        if width <= 0 || height <= 0 {
            return Err("Android media video dimensions metadata is missing".to_string());
        }

        Ok((width, height))
    })
}

/// Initialise un MediaMetadataRetriever Android pour le chemin donné.
///
/// @param file_path Chemin du fichier média à analyser.
/// @param read Fonction qui lit les métadonnées nécessaires.
/// @returns Résultat produit par le lecteur.
fn with_retriever<T>(
    file_path: &Path,
    read: impl FnOnce(&mut jni::JNIEnv, &JObject) -> Result<T, String>,
) -> Result<T, String> {
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
        .map_err(|e| format!("Unable to access Android JVM: {}", e))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Unable to attach Android JVM thread: {}", e))?;
    let retriever = env
        .new_object("android/media/MediaMetadataRetriever", "()V", &[])
        .map_err(|e| format!("Unable to create Android media retriever: {}", e))?;
    let path = env
        .new_string(file_path.to_string_lossy())
        .map_err(|e| format!("Unable to build Android media path: {}", e))?;
    let path_object = JObject::from(path);

    env.call_method(
        &retriever,
        "setDataSource",
        "(Ljava/lang/String;)V",
        &[JValue::Object(&path_object)],
    )
    .map_err(|e| format!("Unable to set Android media data source: {}", e))?;

    let result = read(&mut env, &retriever);
    let _ = env.call_method(&retriever, "release", "()V", &[]);
    result
}

/// Extrait une métadonnée String depuis MediaMetadataRetriever.
///
/// @param env Environnement JNI courant.
/// @param retriever Instance Android MediaMetadataRetriever.
/// @param key Clé Android de la métadonnée.
/// @returns Valeur texte de la métadonnée si elle existe.
fn extract_metadata(
    env: &mut jni::JNIEnv,
    retriever: &JObject,
    key: i32,
) -> Result<Option<String>, String> {
    let value = env
        .call_method(
            retriever,
            "extractMetadata",
            "(I)Ljava/lang/String;",
            &[JValue::Int(key)],
        )
        .map_err(|e| format!("Unable to extract Android media metadata: {}", e))?
        .l()
        .map_err(|e| format!("Invalid Android media metadata value: {}", e))?;

    if value.is_null() {
        return Ok(None);
    }

    let value = JString::from(value);
    env.get_string(&value)
        .map(|value| Some(value.into()))
        .map_err(|e| format!("Unable to read Android media metadata string: {}", e))
}
