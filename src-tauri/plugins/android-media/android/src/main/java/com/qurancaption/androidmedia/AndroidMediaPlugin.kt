package com.qurancaption.androidmedia

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.view.WindowManager
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.Logger
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
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
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
class DownloadYoutubeArgs {
    lateinit var url: String
    lateinit var downloadType: String
    lateinit var downloadPath: String
    lateinit var downloadRequestId: String
}

@InvokeArg
class YoutubeDownloadSessionArgs {
    lateinit var downloadRequestId: String
}

private class YoutubeDownloadSession {
    @Volatile var state = "RUNNING"
    @Volatile var progress = 0.0
    @Volatile var path = ""
    @Volatile var error = ""
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

@TauriPlugin
class AndroidMediaPlugin(activity: Activity) : Plugin(activity) {
    private val hostActivity = activity
    private var youtubeDlUpdateAttempted = false
    private val youtubeDownloadSessions = ConcurrentHashMap<String, YoutubeDownloadSession>()

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
     * Télécharge un média avec yt-dlp et son runtime natif Android.
     *
     * @param invoke Appel Tauri contenant l'URL, le type et le dossier de destination.
     */
    @Command
    fun downloadYoutube(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(DownloadYoutubeArgs::class.java)
        } catch (error: Exception) {
            reject(invoke, "Failed to parse YouTube download arguments", error)
            return
        }

        try {
            val session = YoutubeDownloadSession()
            require(
                youtubeDownloadSessions.putIfAbsent(args.downloadRequestId, session) == null
            ) {
                "Download request already exists: ${args.downloadRequestId}"
            }
            Thread(
                {
                    try {
                        session.path = performYoutubeDownload(args, session)
                        session.progress = 100.0
                        session.state = "COMPLETED"
                    } catch (error: Exception) {
                        session.error = error.message ?: error.javaClass.simpleName
                        session.state = "FAILED"
                        Logger.error("Failed to download media: ${session.error}")
                    }
                },
                "QuranCaption-YoutubeDownload"
            ).start()
            invoke.resolve(JSObject().apply { put("started", true) })
        } catch (error: Exception) {
            reject(invoke, "Failed to start media download", error)
        }
    }

    /**
     * Retourne l'état courant d'un téléchargement yt-dlp Android.
     *
     * @param invoke Appel Tauri contenant l'identifiant du téléchargement.
     */
    @Command
    fun pollYoutubeDownload(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(YoutubeDownloadSessionArgs::class.java)
            val session = requireNotNull(youtubeDownloadSessions[args.downloadRequestId]) {
                "Unknown download request: ${args.downloadRequestId}"
            }
            val response = JSObject().apply {
                put("state", session.state)
                put("progress", session.progress)
                put("path", session.path)
                put("error", session.error)
            }
            if (session.state == "COMPLETED" || session.state == "FAILED") {
                youtubeDownloadSessions.remove(args.downloadRequestId, session)
            }
            invoke.resolve(response)
        } catch (error: Exception) {
            reject(invoke, "Failed to poll media download", error)
        }
    }

    /**
     * Exécute yt-dlp, nettoie son nom de sortie et retourne le chemin final.
     *
     * @param args Paramètres du téléchargement.
     * @param session Session recevant la progression native.
     * @return Chemin absolu du média téléchargé.
     */
    private fun performYoutubeDownload(
        args: DownloadYoutubeArgs,
        session: YoutubeDownloadSession
    ): String {
        val destination = File(args.downloadPath)
        require(destination.isDirectory || (!destination.exists() && destination.mkdirs())) {
            "Cannot create destination directory: ${args.downloadPath}"
        }

        val appContext = hostActivity.applicationContext
        synchronized(YoutubeDL) {
            YoutubeDL.getInstance().init(appContext)
            if (!youtubeDlUpdateAttempted) {
                youtubeDlUpdateAttempted = true
                try {
                    YoutubeDL.getInstance().updateYoutubeDL(
                        appContext,
                        YoutubeDL.UpdateChannel.NIGHTLY
                    )
                } catch (error: Exception) {
                    Logger.error("Failed to update yt-dlp: ${error.message}")
                }
            }
        }
        FFmpeg.getInstance().init(appContext)

        val outputTemplate = File(
            destination,
            "%(title)s (%(uploader)s)${args.downloadRequestId}.%(ext)s"
        ).absolutePath
        val request = YoutubeDLRequest(args.url)
            .addOption("--restrict-filenames")
            .addOption("--trim-filenames", 120)
            .addOption("--no-colors")
            .addOption("--remote-components", "ejs:github")
            .addOption("--cache-dir", File(hostActivity.cacheDir, "yt-dlp").absolutePath)

        val extension = when (args.downloadType) {
            "audio" -> {
                request
                    .addOption("--extract-audio")
                    .addOption("--audio-format", "mp3")
                    .addOption("--audio-quality", "0")
                    .addOption("--postprocessor-args", "ffmpeg:-b:a 320k -ar 44100")
                "mp3"
            }
            "video_no_audio" -> {
                request
                    .addOption(
                        "--format",
                        "bestvideo[vcodec^=avc1][height<=1080][ext=mp4]"
                    )
                    .addOption("--remux-video", "mp4")
                "mp4"
            }
            "video" -> {
                request
                    .addOption(
                        "--format",
                        "bestvideo[vcodec^=avc1][height<=1080][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]/best[vcodec^=avc1][acodec^=mp4a][height<=1080][ext=mp4]"
                    )
                    .addOption("--merge-output-format", "mp4")
                    .addOption(
                        "--postprocessor-args",
                        "Merger+ffmpeg_o:-movflags +faststart"
                    )
                "mp4"
            }
            else -> error("Invalid type: must be 'audio', 'video' or 'video_no_audio'")
        }

        val lowerUrl = args.url.lowercase()
        if (
            lowerUrl.contains("list=") &&
            (lowerUrl.contains("v=") || lowerUrl.contains("youtu.be/"))
        ) {
            request.addOption("--no-playlist")
        }
        request.addOption("--newline").addOption("-o", outputTemplate)
        YoutubeDL.getInstance().execute(request, args.downloadRequestId) { progress, _, _ ->
            session.progress = progress.toDouble().coerceIn(0.0, 100.0)
        }

        val downloadedFile = destination.listFiles()?.firstOrNull { file ->
            file.isFile &&
                file.extension.equals(extension, ignoreCase = true) &&
                file.name.contains(args.downloadRequestId)
        } ?: error("Downloaded file not found")
        val safeStem = sanitizeFileName(downloadedFile.nameWithoutExtension)
            .take(MAX_FILENAME_LENGTH - extension.length - 1)
        val safeFile = File(destination, "$safeStem.$extension")
        if (safeFile.absolutePath == downloadedFile.absolutePath) {
            return downloadedFile.absolutePath
        }

        val target = if (safeFile.exists()) {
            File(destination, "youtube-${args.downloadRequestId}.$extension")
        } else {
            safeFile
        }
        require(downloadedFile.renameTo(target)) {
            "Unable to sanitize downloaded file name"
        }
        return target.absolutePath
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
        private const val COPY_BUFFER_SIZE = 64 * 1024
        private const val MAX_FILENAME_LENGTH = 180
        private const val DEFAULT_IMPORTED_FILE_NAME = "imported_file"
        private val INVALID_FILENAME_CHARACTERS = setOf('/', '\\', ':', '*', '?', '"', '<', '>', '|')
    }
}
