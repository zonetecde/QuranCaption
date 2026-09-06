package com.qurancaption

import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.Keep
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.SilenceMediaSource
import androidx.webkit.WebViewCompat
import com.arthenica.ffmpegkit.FFmpegKit
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class MainActivity : TauriActivity() {
    /**
     * Initialise le lecteur audio natif au démarrage de l'activité.
     *
     * @param savedInstanceState État Android restauré.
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeAudioPlayer.initialize(this)
    }

    /** Installe le flux natif des médias locaux sur la WebView créée par Tauri. */
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webView.webViewClient = LocalMediaWebViewClient(WebViewCompat.getWebViewClient(webView))
    }

    /** Transmet le chargement audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioLoad(path: String, positionMs: Long, speed: Float, volume: Float) =
        NativeAudioPlayer.load(path, positionMs, speed, volume)

    /** Transmet la lecture audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioPlay(positionMs: Long) = NativeAudioPlayer.play(positionMs)

    /** Transmet la pause audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioPause() = NativeAudioPlayer.pause()

    /** Transmet le seek audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioSeek(positionMs: Long) = NativeAudioPlayer.seekTo(positionMs)

    /** Transmet la vitesse audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioSetSpeed(speed: Float) = NativeAudioPlayer.setPlaybackSpeed(speed)

    /** Transmet le volume audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioSetVolume(volume: Float) = NativeAudioPlayer.setVolume(volume)

    /** Retourne l'état Media3 au code Rust. */
    @Keep
    fun nativeAudioGetState(): LongArray = NativeAudioPlayer.getState()

    /** Transmet la libération audio JNI au lecteur Media3. */
    @Keep
    fun nativeAudioRelease() = NativeAudioPlayer.release()

    /**
     * Autorise la rotation complète uniquement pendant le plein écran vidéo.
     *
     * @param allowed Vrai pour suivre le capteur, faux pour verrouiller le portrait.
     */
    @Keep
    fun nativeSetLandscapeAllowed(allowed: Boolean) = runOnUiThread {
        requestedOrientation = if (allowed) {
            ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    /**
     * Exécute une commande FFmpegKit transmise par Rust.
     *
     * @param arguments Arguments FFmpeg sans le nom du binaire.
     * @return Résultat JSON contenant le code de retour et les logs.
     */
    @Keep
    fun nativeFfmpegExecute(arguments: Array<String>): String {
        val session = FFmpegKit.executeWithArguments(arguments)
        return JSONObject()
            .put("code", session.returnCode?.value ?: -1)
            .put("output", session.output.orEmpty())
            .put("failureStackTrace", session.failStackTrace.orEmpty())
            .toString()
    }
}

private class LocalMediaWebViewClient(private val delegate: WebViewClient) : WebViewClient() {
    /** Intercepte les médias locaux sans copier leur contenu complet dans le tas Java. */
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        return streamLocalMedia(request) ?: try {
            delegate.shouldInterceptRequest(view, request)
        } catch (_: OutOfMemoryError) {
            Logger.error("Unable to intercept WebView request: insufficient memory")
            null
        }
    }

    /** Délègue la validation des navigations au client Tauri. */
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        return delegate.shouldOverrideUrlLoading(view, request)
    }

    /** Délègue le début du chargement au client Tauri. */
    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        delegate.onPageStarted(view, url, favicon)
    }

    /** Délègue la fin du chargement au client Tauri. */
    override fun onPageFinished(view: WebView, url: String) {
        delegate.onPageFinished(view, url)
    }

    /** Délègue les erreurs de chargement au client Tauri. */
    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
    ) {
        delegate.onReceivedError(view, request, error)
    }

    /**
     * Sert un fichier audio ou vidéo local avec une réponse bornée compatible avec les seeks.
     *
     * @param request Requête WebView ciblant une URL asset locale.
     * @return Réponse de streaming, ou null si la requête ne cible pas un média local.
     */
    private fun streamLocalMedia(request: WebResourceRequest): WebResourceResponse? {
        if (
            request.url.host != "asset.localhost" ||
            (request.method != "GET" && request.method != "HEAD")
        ) {
            return null
        }

        val path = Uri.decode(request.url.encodedPath?.removePrefix("/") ?: return null)
        val file = File(path)
        val mimeType = MEDIA_MIME_TYPES[file.extension.lowercase()] ?: return null
        if (!file.isFile) return null

        return try {
            val fileLength = file.length()
            if (fileLength <= 0) return null

            var start = 0L
            var end = fileLength - 1
            var statusCode = 200
            var reasonPhrase = "OK"
            val rangeHeader = request.requestHeaders.entries
                .firstOrNull { it.key.equals("Range", ignoreCase = true) }
                ?.value
            if (rangeHeader != null) {
                val range = rangeHeader.takeIf { it.startsWith("bytes=") && ',' !in it }
                    ?.removePrefix("bytes=")
                    ?: return rangeNotSatisfiable(fileLength)
                val bounds = range.split('-', limit = 2)
                val requestedStart = bounds.getOrNull(0)?.toLongOrNull()
                val requestedEnd = bounds.getOrNull(1)?.toLongOrNull()
                if (requestedStart == null && requestedEnd != null) {
                    start = (fileLength - requestedEnd).coerceAtLeast(0)
                } else if (requestedStart != null) {
                    start = requestedStart
                    end = requestedEnd?.coerceAtMost(end) ?: end
                } else {
                    return rangeNotSatisfiable(fileLength)
                }

                if (start >= fileLength || end < start) return rangeNotSatisfiable(fileLength)
                statusCode = 206
                reasonPhrase = "Partial Content"
            }

            val contentLength = end - start + 1
            val headers = mutableMapOf(
                "Accept-Ranges" to "bytes",
                "Content-Length" to contentLength.toString(),
                "Access-Control-Allow-Origin" to "*"
            )
            if (statusCode == 206) headers["Content-Range"] = "bytes $start-$end/$fileLength"

            val stream = if (request.method == "HEAD") {
                ByteArrayInputStream(ByteArray(0))
            } else {
                val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                AssetFileDescriptor(descriptor, start, contentLength).createInputStream()
            }
            WebResourceResponse(mimeType, null, statusCode, reasonPhrase, headers, stream)
        } catch (_: Exception) {
            null
        }
    }

    /** Retourne une réponse HTTP indiquant qu'une plage de fichier est invalide. */
    private fun rangeNotSatisfiable(fileLength: Long): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            416,
            "Range Not Satisfiable",
            mapOf("Content-Range" to "bytes */$fileLength"),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    private companion object {
        private val MEDIA_MIME_TYPES = mapOf(
            "aac" to "audio/aac",
            "avi" to "video/x-msvideo",
            "flac" to "audio/flac",
            "flv" to "video/x-flv",
            "m4a" to "audio/mp4",
            "mkv" to "video/x-matroska",
            "mov" to "video/quicktime",
            "mp3" to "audio/mpeg",
            "mp4" to "video/mp4",
            "ogg" to "audio/ogg",
            "opus" to "audio/ogg",
            "wav" to "audio/wav",
            "webm" to "video/webm"
        )
    }
}

@UnstableApi
private object NativeAudioPlayer {
    private const val SILENCE_PATH = "__qurancaption_silence__"
    private const val SILENCE_DURATION_US = 86_400_000_000L
    private val mainHandler = Handler(Looper.getMainLooper())
    private var applicationContext: Context? = null
    private var player: ExoPlayer? = null
    private var loadedPath: String? = null

    /**
     * Initialise le contexte utilisé par le lecteur Media3.
     *
     * @param context Contexte Android courant.
     */
    fun initialize(context: Context) {
        applicationContext = context.applicationContext
    }

    /**
     * Charge un fichier local à la position demandée sans démarrer la lecture.
     *
     * @param path Chemin absolu du fichier audio.
     * @param positionMs Position initiale en millisecondes.
     * @param speed Vitesse de lecture.
     * @param volume Volume compris entre 0 et 1.
     */
    fun load(path: String, positionMs: Long, speed: Float, volume: Float) {
        mainHandler.post {
            val currentPlayer = getOrCreatePlayer()
            currentPlayer.setPlaybackSpeed(speed)
            currentPlayer.volume = volume.coerceIn(0f, 1f)
            if (loadedPath == path) {
                currentPlayer.seekTo(positionMs.coerceAtLeast(0))
                return@post
            }

            loadedPath = path
            if (path == SILENCE_PATH) {
                currentPlayer.setMediaSource(
                    SilenceMediaSource.Factory()
                        .setDurationUs(SILENCE_DURATION_US)
                        .createMediaSource(),
                    positionMs.coerceAtLeast(0)
                )
                currentPlayer.prepare()
                return@post
            }

            currentPlayer.setMediaItem(
                MediaItem.fromUri(Uri.fromFile(File(path))),
                positionMs.coerceAtLeast(0)
            )
            currentPlayer.prepare()
        }
    }

    /**
     * Lance la lecture depuis la position exacte de la timeline.
     *
     * @param positionMs Position de départ en millisecondes dans le fichier.
     */
    fun play(positionMs: Long) {
        mainHandler.post {
            getOrCreatePlayer().apply {
                seekTo(positionMs.coerceAtLeast(0))
                play()
            }
        }
    }

    /** Met la lecture en pause. */
    fun pause() {
        mainHandler.post { player?.pause() }
    }

    /**
     * Déplace la lecture à une position donnée.
     *
     * @param positionMs Position cible en millisecondes.
     */
    fun seekTo(positionMs: Long) {
        mainHandler.post { player?.seekTo(positionMs.coerceAtLeast(0)) }
    }

    /**
     * Modifie la vitesse de lecture.
     *
     * @param speed Nouvelle vitesse de lecture.
     */
    fun setPlaybackSpeed(speed: Float) {
        mainHandler.post { player?.setPlaybackSpeed(speed) }
    }

    /**
     * Modifie le volume du lecteur.
     *
     * @param volume Volume compris entre 0 et 1.
     */
    fun setVolume(volume: Float) {
        mainHandler.post { player?.volume = volume.coerceIn(0f, 1f) }
    }

    /**
     * Retourne la position, l'état de lecture et l'état de fin.
     *
     * @return Tableau contenant positionMs, isPlaying et ended.
     */
    fun getState(): LongArray {
        return runOnMainThread {
            val currentPlayer = player
            longArrayOf(
                currentPlayer?.currentPosition?.coerceAtLeast(0) ?: 0,
                if (currentPlayer?.isPlaying == true) 1 else 0,
                if (currentPlayer?.playbackState == Player.STATE_ENDED) 1 else 0
            )
        }
    }

    /** Libère le lecteur et le fichier courant. */
    fun release() {
        mainHandler.post {
            player?.release()
            player = null
            loadedPath = null
        }
    }

    /**
     * Crée le lecteur à la demande sur le thread Android principal.
     *
     * @return Instance Media3 persistante.
     */
    private fun getOrCreatePlayer(): ExoPlayer {
        return player ?: ExoPlayer.Builder(
            requireNotNull(applicationContext) { "NativeAudioPlayer is not initialized" }
        ).build().also { player = it }
    }

    /**
     * Exécute une lecture d'état sur le thread principal Media3.
     *
     * @param block Lecture d'état à exécuter.
     * @return Valeur retournée par la lecture.
     */
    private fun <T> runOnMainThread(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()

        val latch = CountDownLatch(1)
        var result: Result<T>? = null
        mainHandler.post {
            result = runCatching(block)
            latch.countDown()
        }
        check(latch.await(1, TimeUnit.SECONDS)) { "Timed out while reading Media3 state" }
        return requireNotNull(result).getOrThrow()
    }
}
