package com.qurancaption.androidmedia

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.FFmpegSessionCompleteCallback
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.SessionState
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

@InvokeArg
class StartFfmpegArgs {
    lateinit var arguments: Array<String>
}

@InvokeArg
class FfmpegSessionArgs {
    var sessionId: Long = 0
}

@InvokeArg
class ExecuteFfprobeArgs {
    lateinit var arguments: Array<String>
}

@InvokeArg
class PublishFileArgs {
    lateinit var sourcePath: String
    lateinit var destinationUri: String
}

@InvokeArg
class OpenUriArgs {
    lateinit var uri: String
    lateinit var mimeType: String
}

@InvokeArg
class ImportUriArgs {
    lateinit var uri: String
    lateinit var destinationDir: String
}

@InvokeArg
class KeepScreenOnArgs {
    var enabled: Boolean = false
}

@InvokeArg
class StartExportServiceArgs {
    lateinit var exportId: String
    lateinit var fileName: String
    lateinit var state: String
    lateinit var stateLabels: String
    lateinit var capturingHint: String
    lateinit var backgroundHint: String
    lateinit var completionHint: String
    lateinit var cancelLabel: String
    lateinit var cancellingLabel: String
    lateinit var channelName: String
}

@InvokeArg
class UpdateExportServiceArgs {
    lateinit var exportId: String
    lateinit var state: String
    var progress: Int = 0
}

@InvokeArg
class ExportServiceArgs {
    lateinit var exportId: String
}

@InvokeArg
class SecureValueArgs {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
class SecureKeyArgs {
    lateinit var key: String
}

@TauriPlugin
class AndroidMediaPlugin(activity: Activity) : Plugin(activity) {
    private val hostActivity = activity
    private val securePreferences by lazy {
        hostActivity.getSharedPreferences(SECURE_PREFERENCES_NAME, Activity.MODE_PRIVATE)
    }

    init {
        hostActivity.window.navigationBarColor = Color.BLACK
        WindowInsetsControllerCompat(hostActivity.window, hostActivity.window.decorView)
            .isAppearanceLightNavigationBars = false
    }

    /**
     * Démarre FFmpegKit sur son exécuteur asynchrone et renvoie immédiatement l'identifiant.
     *
     * @param invoke Appel Tauri contenant la liste des arguments FFmpeg sans nom de binaire.
     */
    @Command
    fun startFfmpeg(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(StartFfmpegArgs::class.java)
            require(args.arguments.isNotEmpty()) { "FFmpeg arguments cannot be empty" }

            val session = FFmpegKit.executeWithArgumentsAsync(
                args.arguments,
                FFmpegSessionCompleteCallback { }
            )
            invoke.resolve(
                JSObject().apply {
                    put("sessionId", session.sessionId)
                }
            )
        } catch (error: Exception) {
            reject(invoke, "Failed to start FFmpeg", error)
        }
    }

    /**
     * Retourne un instantané non bloquant de l'état et de la progression FFmpegKit.
     *
     * Les logs complets ne sont lus qu'une fois la session terminée pour éviter de recopier
     * une sortie toujours plus volumineuse à chaque interrogation.
     *
     * @param invoke Appel Tauri contenant l'identifiant de session.
     */
    @Command
    fun pollFfmpeg(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(FfmpegSessionArgs::class.java)
            val session = FFmpegKitConfig.getSession(args.sessionId) as? FFmpegSession
            if (session == null) {
                invoke.reject("Unknown FFmpeg session: ${args.sessionId}")
                return
            }

            val isTerminal = session.state == SessionState.COMPLETED ||
                session.state == SessionState.FAILED
            val returnCode = session.returnCode?.value
            invoke.resolve(
                JSObject().apply {
                    put("sessionId", session.sessionId)
                    put("state", session.state.name)
                    put("returnCode", returnCode ?: JSONObject.NULL)
                    put(
                        "output",
                        if (isTerminal && returnCode != 0) session.output.orEmpty() else ""
                    )
                    put(
                        "failureStackTrace",
                        if (isTerminal) session.failStackTrace.orEmpty() else ""
                    )
                    put("timeMs", session.lastReceivedStatistics?.time ?: 0.0)
                }
            )
        } catch (error: Exception) {
            reject(invoke, "Failed to poll FFmpeg", error)
        }
    }

    /**
     * Annule une session FFmpegKit encore connue de l'historique natif.
     *
     * @param invoke Appel Tauri contenant l'identifiant de session.
     */
    @Command
    fun cancelFfmpeg(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(FfmpegSessionArgs::class.java)
            val sessionExists = FFmpegKitConfig.getSession(args.sessionId) is FFmpegSession
            if (sessionExists) {
                FFmpegKit.cancel(args.sessionId)
            }
            invoke.resolve(
                JSObject().apply {
                    put("cancelled", sessionExists)
                }
            )
        } catch (error: Exception) {
            reject(invoke, "Failed to cancel FFmpeg", error)
        }
    }

    /**
     * Exécute FFprobeKit hors du thread principal pour lire les métadonnées de tout codec inclus.
     *
     * @param invoke Appel Tauri contenant les arguments FFprobe sans nom de binaire.
     */
    @Command
    fun executeFfprobe(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(ExecuteFfprobeArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse FFprobe arguments", error)
            return
        }

        runInBackground(invoke, "Failed to execute FFprobe") {
            val session = FFprobeKit.executeWithArguments(args.arguments)
            val failure = session.failStackTrace.orEmpty()
            JSObject().apply {
                put("success", session.returnCode?.value == 0)
                put(
                    "output",
                    if (failure.isBlank()) session.output.orEmpty()
                    else "${session.output.orEmpty()}\n$failure"
                )
            }
        }
    }

    /**
     * Copie un fichier local vers une URI Android sans charger son contenu en mémoire.
     *
     * Un chemin de destination local, brut ou préfixé par `file://`, est aussi accepté.
     *
     * @param invoke Appel Tauri contenant le chemin source et l'URI de destination.
     */
    @Command
    fun publishFile(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(PublishFileArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse publish arguments", error)
            return
        }

        runInBackground(invoke, "Failed to publish file") {
            val source = localFile(args.sourcePath)
            require(source.isFile) { "Source file does not exist: ${args.sourcePath}" }

            var publishedUri = args.destinationUri
            BufferedInputStream(FileInputStream(source), COPY_BUFFER_SIZE).use { input ->
                val (output, normalizedUri) = openPublishDestination(args.destinationUri)
                publishedUri = normalizedUri
                BufferedOutputStream(output, COPY_BUFFER_SIZE).use { destination ->
                    input.copyTo(destination, COPY_BUFFER_SIZE)
                }
            }

            JSObject().apply {
                put("uri", publishedUri)
            }
        }
    }

    /**
     * Ouvre une URI Android dans l'application associée à son type MIME.
     *
     * @param invoke Appel Tauri contenant l'URI et son type MIME.
     */
    @Command
    fun openUri(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(OpenUriArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse URI arguments", error)
            return
        }

        hostActivity.runOnUiThread {
            try {
                val uri = shareableUri(args.uri)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, args.mimeType.ifBlank { "*/*" })
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val opened = try {
                    hostActivity.startActivity(intent)
                    true
                } catch (_: ActivityNotFoundException) {
                    false
                }
                invoke.resolve(
                    JSObject().apply {
                        put("opened", opened)
                    }
                )
            } catch (error: Exception) {
                reject(invoke, "Failed to open URI", error)
            }
        }
    }

    /**
     * Ouvre la feuille de partage Android pour une URI ou un fichier local.
     *
     * @param invoke Appel Tauri contenant le fichier et son type MIME.
     */
    @Command
    fun shareUri(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(OpenUriArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse share arguments", error)
            return
        }

        hostActivity.runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = args.mimeType.ifBlank { "*/*" }
                    putExtra(Intent.EXTRA_STREAM, shareableUri(args.uri))
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                hostActivity.startActivity(Intent.createChooser(intent, null))
                invoke.resolve(JSObject().apply { put("opened", true) })
            } catch (error: Exception) {
                reject(invoke, "Failed to share URI", error)
            }
        }
    }

    /**
     * Importe une URI Android dans un dossier local sans charger son contenu en mémoire.
     *
     * Le nom affiché par le fournisseur est nettoyé et suffixé si un fichier homonyme existe.
     *
     * @param invoke Appel Tauri contenant l'URI source et le dossier local de destination.
     */
    @Command
    fun importUri(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(ImportUriArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse import arguments", error)
            return
        }

        runInBackground(invoke, "Failed to import URI") {
            val destinationDirectory = File(args.destinationDir)
            require(
                destinationDirectory.isDirectory ||
                    (!destinationDirectory.exists() && destinationDirectory.mkdirs())
            ) {
                "Cannot create destination directory: ${args.destinationDir}"
            }

            val safeName = sanitizeFileName(resolveDisplayName(args.uri))
            val destination = createAvailableFile(destinationDirectory, safeName)
            try {
                openImportSource(args.uri).use { input ->
                    BufferedOutputStream(
                        FileOutputStream(destination),
                        COPY_BUFFER_SIZE
                    ).use { output ->
                        input.copyTo(output, COPY_BUFFER_SIZE)
                    }
                }
            } catch (error: Exception) {
                destination.delete()
                throw error
            }

            JSObject().apply {
                put("path", destination.absolutePath)
            }
        }
    }

    /**
     * Ouvre le sélecteur Android de dossiers pour la pool d'arrière-plans.
     *
     * @param invoke Appel Tauri à résoudre avec le chemin de la pool importée.
     */
    @Command
    fun pickBackgroundFolder(invoke: Invoke) {
        hostActivity.runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
                    )
                }
                startActivityForResult(invoke, intent, "backgroundFolderPickerResult")
            } catch (error: Exception) {
                reject(invoke, "Failed to open background folder picker", error)
            }
        }
    }

    /**
     * Traite le dossier choisi par le sélecteur SAF et importe ses médias compatibles.
     *
     * @param invoke Appel Tauri en attente de la sélection.
     * @param result Résultat de l'activité Android.
     */
    @ActivityCallback
    fun backgroundFolderPickerResult(invoke: Invoke, result: ActivityResult) {
        try {
            when (result.resultCode) {
                Activity.RESULT_OK -> {
                    val uri = result.data?.data
                    if (uri == null) {
                        invoke.reject("Background folder picker returned no folder")
                        return
                    }

                    try {
                        hostActivity.contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    } catch (_: SecurityException) {
                        // Certains fournisseurs n'autorisent pas la persistance, mais l'accès courant suffit.
                    }
                    runInBackground(invoke, "Failed to import background folder") {
                        importBackgroundFolder(uri)
                    }
                }
                Activity.RESULT_CANCELED -> invoke.reject("Background folder picker cancelled")
                else -> invoke.reject("Failed to pick background folder")
            }
        } catch (error: Exception) {
            reject(invoke, "Failed to read background folder selection", error)
        }
    }

    /**
     * Empêche l'écran de s'éteindre pendant le rendu, sans acquérir de verrou système global.
     *
     * @param invoke Appel Tauri indiquant si le drapeau doit être actif.
     */
    @Command
    fun setKeepScreenOn(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(KeepScreenOnArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse screen flag arguments", error)
            return
        }

        hostActivity.runOnUiThread {
            try {
                if (args.enabled) {
                    hostActivity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    hostActivity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                invoke.resolve(
                    JSObject().apply {
                        put("enabled", args.enabled)
                    }
                )
            } catch (error: Exception) {
                reject(invoke, "Failed to update screen flag", error)
            }
        }
    }

    /**
     * Démarre le service Android au premier plan qui protège et affiche l'export.
     *
     * @param invoke Appel Tauri contenant l'identifiant et les textes localisés.
     */
    @Command
    fun startExportService(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(StartExportServiceArgs::class.java)
            require(args.exportId.isNotBlank()) { "Export id cannot be empty" }
            val intent = Intent(hostActivity, ExportForegroundService::class.java).apply {
                action = ExportForegroundService.ACTION_START
                putExtra(ExportForegroundService.EXTRA_EXPORT_ID, args.exportId)
                putExtra(ExportForegroundService.EXTRA_FILE_NAME, args.fileName)
                putExtra(ExportForegroundService.EXTRA_STATE, args.state)
                putExtra(ExportForegroundService.EXTRA_PROGRESS, 0)
                putExtra(ExportForegroundService.EXTRA_STATE_LABELS, args.stateLabels)
                putExtra(ExportForegroundService.EXTRA_CAPTURING_HINT, args.capturingHint)
                putExtra(ExportForegroundService.EXTRA_BACKGROUND_HINT, args.backgroundHint)
                putExtra(ExportForegroundService.EXTRA_COMPLETION_HINT, args.completionHint)
                putExtra(ExportForegroundService.EXTRA_CANCEL_LABEL, args.cancelLabel)
                putExtra(ExportForegroundService.EXTRA_CANCELLING_LABEL, args.cancellingLabel)
                putExtra(ExportForegroundService.EXTRA_CHANNEL_NAME, args.channelName)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                hostActivity.startForegroundService(intent)
            } else {
                hostActivity.startService(intent)
            }
            invoke.resolve(JSObject().apply { put("started", true) })
        } catch (error: Exception) {
            reject(invoke, "Failed to start export service", error)
        }
    }

    /**
     * Met à jour la notification et renvoie le marqueur d'annulation natif.
     *
     * @param invoke Appel Tauri contenant la phase et la progression.
     */
    @Command
    fun updateExportService(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateExportServiceArgs::class.java)
            hostActivity.startService(
                Intent(hostActivity, ExportForegroundService::class.java).apply {
                    action = ExportForegroundService.ACTION_UPDATE
                    putExtra(ExportForegroundService.EXTRA_EXPORT_ID, args.exportId)
                    putExtra(ExportForegroundService.EXTRA_STATE, args.state)
                    putExtra(ExportForegroundService.EXTRA_PROGRESS, args.progress)
                }
            )
            invoke.resolve(
                JSObject().apply {
                    put(
                        "cancelled",
                        ExportForegroundService.isCancellationRequested(hostActivity, args.exportId)
                    )
                }
            )
        } catch (error: Exception) {
            reject(invoke, "Failed to update export service", error)
        }
    }

    /**
     * Bascule la notification vers le message autorisant l'arrière-plan.
     *
     * @param invoke Appel Tauri contenant l'identifiant d'export.
     */
    @Command
    fun markExportBackgroundReady(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ExportServiceArgs::class.java)
            hostActivity.startService(
                Intent(hostActivity, ExportForegroundService::class.java).apply {
                    action = ExportForegroundService.ACTION_BACKGROUND_READY
                    putExtra(ExportForegroundService.EXTRA_EXPORT_ID, args.exportId)
                }
            )
            invoke.resolve(JSObject().apply { put("ready", true) })
        } catch (error: Exception) {
            reject(invoke, "Failed to update export background state", error)
        }
    }

    /**
     * Arrête le service et retire sa notification.
     *
     * @param invoke Appel Tauri contenant l'identifiant d'export.
     */
    @Command
    fun stopExportService(invoke: Invoke) {
        try {
            invoke.parseArgs(ExportServiceArgs::class.java)
            val stopped = hostActivity.stopService(
                Intent(hostActivity, ExportForegroundService::class.java)
            )
            invoke.resolve(JSObject().apply { put("stopped", stopped) })
        } catch (error: Exception) {
            reject(invoke, "Failed to stop export service", error)
        }
    }

    /**
     * Lit le marqueur posé par l'action Annuler de la notification.
     *
     * @param invoke Appel Tauri contenant l'identifiant d'export.
     */
    @Command
    fun isExportCancellationRequested(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ExportServiceArgs::class.java)
            invoke.resolve(
                JSObject().apply {
                    put(
                        "cancelled",
                        ExportForegroundService.isCancellationRequested(hostActivity, args.exportId)
                    )
                }
            )
        } catch (error: Exception) {
            reject(invoke, "Failed to read export cancellation state", error)
        }
    }

    /**
     * Chiffre puis stocke une valeur OAuth avec une clé AES non exportable de l'Android Keystore.
     *
     * @param invoke Appel Tauri contenant la clé autorisée et sa valeur.
     */
    @Command
    fun secureSet(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureValueArgs::class.java)
            val storageKey = secureStorageKey(args.key)
            val encryptedValue = encryptSecureValue(args.value)
            check(securePreferences.edit().putString(storageKey, encryptedValue).commit()) {
                "Encrypted preferences write failed"
            }
            invoke.resolve(JSObject().apply { put("success", true) })
        } catch (error: Exception) {
            reject(invoke, "Failed to store OAuth data securely", error)
        }
    }

    /**
     * Lit et déchiffre une valeur OAuth depuis le stockage privé de l'application.
     *
     * @param invoke Appel Tauri contenant la clé autorisée.
     */
    @Command
    fun secureGet(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureKeyArgs::class.java)
            val storageKey = secureStorageKey(args.key)
            val encryptedValue = securePreferences.getString(storageKey, null)
            val value = encryptedValue?.let {
                try {
                    decryptSecureValue(it)
                } catch (_: Exception) {
                    // Une sauvegarde restaurée ne possède plus la clé Keystore d'origine.
                    securePreferences.edit().remove(storageKey).commit()
                    null
                }
            }
            invoke.resolve(JSObject().apply { put("value", value ?: JSONObject.NULL) })
        } catch (error: Exception) {
            reject(invoke, "Failed to read OAuth data securely", error)
        }
    }

    /**
     * Supprime une valeur OAuth du stockage chiffré.
     *
     * @param invoke Appel Tauri contenant la clé autorisée.
     */
    @Command
    fun secureDelete(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecureKeyArgs::class.java)
            check(securePreferences.edit().remove(secureStorageKey(args.key)).commit()) {
                "Encrypted preferences delete failed"
            }
            invoke.resolve(JSObject().apply { put("success", true) })
        } catch (error: Exception) {
            reject(invoke, "Failed to delete OAuth data securely", error)
        }
    }

    /**
     * Valide une clé OAuth avant de construire sa clé SharedPreferences.
     *
     * @param key Clé logique demandée par le frontend.
     * @return Clé de stockage privée et préfixée.
     */
    private fun secureStorageKey(key: String): String {
        require(key == SESSION_KEY || key == PENDING_VERIFIER_KEY) {
            "Unsupported secure storage key"
        }
        return "$SECURE_VALUE_PREFIX$key"
    }

    /**
     * Retourne la clé AES Android existante ou en génère une non exportable.
     *
     * @return Clé AES protégée par l'Android Keystore.
     */
    private fun getOrCreateSecureKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEYSTORE_ALIAS, null) as? SecretKey)?.let { return it }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }

    /**
     * Chiffre une valeur UTF-8 en AES-GCM et sérialise l'IV avec le texte chiffré.
     *
     * @param value Valeur OAuth en clair.
     * @return Charge utile Base64 prête à persister.
     */
    private fun encryptSecureValue(value: String): String {
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecureKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val encodedIv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val encodedValue = Base64.encodeToString(encrypted, Base64.NO_WRAP)
        return "$encodedIv.$encodedValue"
    }

    /**
     * Déchiffre une charge utile AES-GCM produite par [encryptSecureValue].
     *
     * @param value IV et texte chiffré encodés en Base64.
     * @return Valeur OAuth UTF-8 déchiffrée.
     */
    private fun decryptSecureValue(value: String): String {
        val parts = value.split('.', limit = 2)
        require(parts.size == 2) { "Invalid encrypted OAuth value" }
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecureKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }

    /**
     * Exécute une opération de fichiers hors du thread principal Android.
     *
     * @param invoke Appel Tauri à résoudre ou rejeter.
     * @param context Contexte utilisé si l'opération échoue.
     * @param operation Opération native produisant la réponse JSON.
     */
    private fun runInBackground(
        invoke: Invoke,
        context: String,
        operation: () -> JSObject
    ) {
        Thread(
            {
                try {
                    invoke.resolve(operation())
                } catch (error: Exception) {
                    reject(invoke, context, error)
                }
            },
            "QuranCaption-AndroidMedia"
        ).start()
    }

    /**
     * Convertit un chemin local brut ou une URI `file://` en fichier.
     *
     * @param value Chemin ou URI locale.
     * @return Fichier local correspondant.
     */
    private fun localFile(value: String): File {
        val uri = Uri.parse(value)
        return if (uri.scheme.equals("file", ignoreCase = true)) {
            File(requireNotNull(uri.path) { "File URI has no path: $value" })
        } else {
            File(value)
        }
    }

    /**
     * Convertit un chemin local en URI partageable ou conserve une URI de contenu existante.
     *
     * @param value URI ou chemin local.
     * @return URI lisible par une application Android externe.
     */
    private fun shareableUri(value: String): Uri {
        if (value.startsWith("content://")) return Uri.parse(value)
        return FileProvider.getUriForFile(
            hostActivity,
            "${hostActivity.packageName}.fileprovider",
            localFile(value),
        )
    }

    /**
     * Ouvre la destination d'une publication et normalise sa valeur de retour.
     *
     * @param value URI Android ou chemin local de destination.
     * @return Flux de sortie et URI ou chemin publié.
     */
    private fun openPublishDestination(value: String): Pair<OutputStream, String> {
        val uri = Uri.parse(value)
        if (uri.scheme.equals("content", ignoreCase = true)) {
            try {
                hostActivity.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // Certains fournisseurs accordent uniquement l'accès pour la session courante.
            }
            val stream = try {
                hostActivity.contentResolver.openOutputStream(uri, "rwt")
            } catch (_: FileNotFoundException) {
                null
            } ?: hostActivity.contentResolver.openOutputStream(uri, "w")
                ?: error("Cannot open destination URI: $value")
            return stream to uri.toString()
        }

        require(uri.scheme == null || uri.scheme.equals("file", ignoreCase = true)) {
            "Unsupported destination URI: $value"
        }
        val destination = localFile(value)
        destination.parentFile?.let { parent ->
            require(parent.isDirectory || (!parent.exists() && parent.mkdirs())) {
                "Cannot create destination directory: ${parent.absolutePath}"
            }
        }
        return FileOutputStream(destination) to if (uri.scheme == null) {
            destination.absolutePath
        } else {
            uri.toString()
        }
    }

    /**
     * Ouvre une URI Android ou un chemin local en lecture bufferisée.
     *
     * @param value URI ou chemin local à importer.
     * @return Flux de lecture bufferisé.
     */
    private fun openImportSource(value: String): InputStream {
        val uri = Uri.parse(value)
        val stream = if (uri.scheme == null || uri.scheme.equals("file", ignoreCase = true)) {
            FileInputStream(localFile(value))
        } else {
            hostActivity.contentResolver.openInputStream(uri)
                ?: error("Cannot open source URI: $value")
        }
        return BufferedInputStream(stream, COPY_BUFFER_SIZE)
    }

    /**
     * Copie les fichiers multimédias directs d'un dossier SAF dans le stockage privé de l'app.
     *
     * @param treeUri URI SAF du dossier sélectionné.
     * @return Réponse contenant le dossier local utilisable par l'export.
     */
    private fun importBackgroundFolder(treeUri: Uri): JSObject {
        val treeDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            treeDocumentId
        )
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )
        val mediaEntries = mutableListOf<Pair<String, String>>()
        val cursor = hostActivity.contentResolver.query(
            childrenUri,
            projection,
            null,
            null,
            null
        ) ?: error("Cannot read selected background folder")

        cursor.use {
            val documentIdIndex = it.getColumnIndexOrThrow(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID
            )
            val displayNameIndex = it.getColumnIndexOrThrow(
                DocumentsContract.Document.COLUMN_DISPLAY_NAME
            )
            val mimeTypeIndex = it.getColumnIndexOrThrow(
                DocumentsContract.Document.COLUMN_MIME_TYPE
            )
            while (it.moveToNext()) {
                val documentId = it.getString(documentIdIndex).orEmpty()
                val displayName = it.getString(displayNameIndex).orEmpty()
                val mimeType = it.getString(mimeTypeIndex).orEmpty()
                if (
                    documentId.isNotBlank() &&
                    mimeType != DocumentsContract.Document.MIME_TYPE_DIR &&
                    isSupportedBackgroundFile(displayName)
                ) {
                    mediaEntries += documentId to displayName
                }
            }
        }

        require(mediaEntries.isNotEmpty()) {
            "Selected folder contains no supported background media"
        }

        val destinationDirectory = File(
            hostActivity.applicationInfo.dataDir,
            RANDOM_BACKGROUND_POOL_DIRECTORY
        )
        resetDirectory(destinationDirectory)
        var copiedCount = 0
        for ((documentId, displayName) in mediaEntries) {
            val sourceUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
            val destination = createAvailableFile(
                destinationDirectory,
                sanitizeFileName(displayName)
            )
            try {
                openImportSource(sourceUri.toString()).use { input ->
                    BufferedOutputStream(
                        FileOutputStream(destination),
                        COPY_BUFFER_SIZE
                    ).use { output ->
                        input.copyTo(output, COPY_BUFFER_SIZE)
                    }
                }
                copiedCount += 1
            } catch (_: Exception) {
                destination.delete()
            }
        }

        require(copiedCount > 0) {
            "Unable to import media from selected background folder"
        }
        return JSObject().apply {
            put("path", destinationDirectory.absolutePath)
        }
    }

    /**
     * Vérifie l'extension d'un fichier de fond pris en charge par l'export.
     *
     * @param fileName Nom fourni par le fournisseur Android.
     * @return `true` si le fichier peut être ajouté à la pool.
     */
    private fun isSupportedBackgroundFile(fileName: String): Boolean {
        val extension = fileName.substringAfterLast('.', "").lowercase()
        return extension in RANDOM_BACKGROUND_EXTENSIONS
    }

    /**
     * Vide ou crée le dossier local de la pool sans supprimer le dossier lui-même.
     *
     * @param directory Dossier de destination.
     */
    private fun resetDirectory(directory: File) {
        require(directory.isDirectory || (!directory.exists() && directory.mkdirs())) {
            "Cannot create background pool directory: ${directory.absolutePath}"
        }
        directory.listFiles()?.forEach { entry ->
            require(entry.deleteRecursively()) {
                "Cannot clear background pool entry: ${entry.absolutePath}"
            }
        }
    }

    /**
     * Lit le nom affiché par le fournisseur de documents Android.
     *
     * @param value URI ou chemin local source.
     * @return Nom proposé pour le fichier importé.
     */
    private fun resolveDisplayName(value: String): String {
        val uri = Uri.parse(value)
        if (uri.scheme.equals("content", ignoreCase = true)) {
            hostActivity.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0 && cursor.moveToFirst()) {
                    cursor.getString(nameIndex)?.takeIf { it.isNotBlank() }?.let { return it }
                }
            }
        }

        return if (uri.scheme == null || uri.scheme.equals("file", ignoreCase = true)) {
            localFile(value).name
        } else {
            uri.lastPathSegment.orEmpty()
        }.ifBlank { DEFAULT_IMPORTED_FILE_NAME }
    }

    /**
     * Retire les séparateurs et caractères dangereux d'un nom fourni par une URI.
     *
     * @param displayName Nom affiché par le fournisseur Android.
     * @return Nom sûr limité à une longueur raisonnable.
     */
    private fun sanitizeFileName(displayName: String): String {
        val leafName = displayName.substringAfterLast('/').substringAfterLast('\\')
        return leafName
            .map { character ->
                if (character.code < 32 || character in INVALID_FILENAME_CHARACTERS) {
                    '_'
                } else {
                    character
                }
            }
            .joinToString("")
            .trim()
            .trim('.')
            .take(MAX_FILENAME_LENGTH)
            .ifBlank { DEFAULT_IMPORTED_FILE_NAME }
    }

    /**
     * Réserve un fichier disponible en ajoutant un suffixe numérique si nécessaire.
     *
     * @param directory Dossier local de destination.
     * @param fileName Nom de fichier déjà sécurisé.
     * @return Nouveau fichier réservé sans écraser de contenu existant.
     */
    private fun createAvailableFile(directory: File, fileName: String): File {
        val extensionSeparator = fileName.lastIndexOf('.').takeIf { it > 0 }
        val baseName = extensionSeparator?.let { fileName.substring(0, it) } ?: fileName
        val extension = extensionSeparator?.let { fileName.substring(it) }.orEmpty()
        var suffix = 0

        while (true) {
            val candidateName = if (suffix == 0) {
                fileName
            } else {
                "$baseName ($suffix)$extension"
            }
            val candidate = File(directory, candidateName)
            if (candidate.createNewFile()) {
                return candidate
            }
            suffix += 1
        }
    }

    /**
     * Journalise puis rejette proprement un appel natif en échec.
     *
     * @param invoke Appel Tauri à rejeter.
     * @param context Contexte court de l'opération.
     * @param error Erreur native rencontrée.
     */
    private fun reject(invoke: Invoke, context: String, error: Exception) {
        val message = "$context: ${error.message ?: error.javaClass.simpleName}"
        Logger.error(message)
        invoke.reject(message)
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEYSTORE_ALIAS = "qurancaption_quran_auth"
        private const val SECURE_PREFERENCES_NAME = "qurancaption_secure_auth"
        private const val SECURE_VALUE_PREFIX = "oauth."
        private const val SESSION_KEY = "quran_auth_session"
        private const val PENDING_VERIFIER_KEY = "quran_auth_pending_verifier"
        private const val COPY_BUFFER_SIZE = 64 * 1024
        private const val MAX_FILENAME_LENGTH = 180
        private const val DEFAULT_IMPORTED_FILE_NAME = "imported_file"
        private const val RANDOM_BACKGROUND_POOL_DIRECTORY = "random-background-pool"
        private val RANDOM_BACKGROUND_EXTENSIONS = setOf(
            "png",
            "jpg",
            "jpeg",
            "gif",
            "bmp",
            "webp",
            "mp4",
            "avi",
            "mov",
            "mkv",
            "flv",
            "webm"
        )
        private val INVALID_FILENAME_CHARACTERS = setOf('/', '\\', ':', '*', '?', '"', '<', '>', '|')
    }
}
