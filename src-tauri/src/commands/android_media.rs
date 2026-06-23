use std::path::Path;

use jni::objects::{JObject, JString, JValue};
use jni::JavaVM;

const METADATA_KEY_DURATION: i32 = 9;
const METADATA_KEY_VIDEO_WIDTH: i32 = 18;
const METADATA_KEY_VIDEO_HEIGHT: i32 = 19;

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
