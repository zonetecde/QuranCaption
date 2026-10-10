package com.qurancaption

import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
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
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

class MainActivity : TauriActivity() {
    private var sourceWebView: WebView? = null
    private var overlayWebView: WebView? = null
    private var overlayExportId = ""
    private var overlayBaseUrl = ""
    private var pendingOverlayCapture: (() -> Unit)? = null
    private val overlayCaptureLock = Any()
    private var overlayCaptureSequence = 0L

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
        sourceWebView = webView
    }

    /** Libère le renderer d'export et débloque une capture lors de la destruction de l'activité. */
    override fun onDestroy() {
        releaseOverlayWebView()
        sourceWebView = null
        super.onDestroy()
    }

    /**
     * Dessine l'overlay dans un bitmap transparent, puis encode le PNG sur le thread JNI appelant.
     *
     * @param payload Paramètres JSON du document, des polices, des dimensions et du fichier cible.
     * @return Durées et taille du PNG, ou erreur JSON sans exception JNI pendante.
     */
    @Keep
    fun nativeCaptureOverlay(payload: String): String = synchronized(overlayCaptureLock) {
        var bitmap: Bitmap? = null
        try {
            val args = JSONObject(payload)
            val width = args.getInt("width")
            val height = args.getInt("height")
            require(width > 0 && height > 0 && width.toLong() * height <= Int.MAX_VALUE / 4) {
                "Invalid overlay dimensions"
            }
            val destination = File(args.getString("path")).canonicalFile
            val exports = File(applicationInfo.dataDir, "exports").canonicalFile
            require(destination.path.startsWith(exports.path + File.separator)) { "Invalid overlay destination" }
            val latch = CountDownLatch(1)
            val completed = AtomicBoolean(false)
            val handler = Handler(Looper.getMainLooper())
            var failure: String? = null
            val startedAt = System.nanoTime()
            var drawMs = 0.0

            /**
             * Termine la capture une seule fois et recycle un éventuel résultat tardif.
             * @param image Bitmap dessiné, ou null en cas d'échec.
             * @param error Erreur à transmettre au code Rust.
             */
            fun finish(image: Bitmap?, error: String?) {
                if (!completed.compareAndSet(false, true)) {
                    image?.recycle()
                    return
                }
                bitmap = image
                failure = error
                handler.removeCallbacksAndMessages(null)
                latch.countDown()
            }

            runOnUiThread {
                try {
                    if (completed.get()) return@runOnUiThread
                    check(!isFinishing && !isDestroyed) { "Overlay activity is unavailable" }
                    val source = requireNotNull(sourceWebView) { "Tauri WebView is unavailable" }
                    val delegate = WebViewCompat.getWebViewClient(source)
                    val exportId = args.getString("exportId")
                    val baseUrl = args.getString("baseUrl")
                    var view = overlayWebView
                    val needsLoad = view == null || overlayExportId != exportId ||
                        overlayBaseUrl != baseUrl || view.width != width || view.height != height
                    if (needsLoad) {
                        releaseOverlayWebView()
                        view = WebView(this).apply {
                            setBackgroundColor(Color.TRANSPARENT)
                            settings.javaScriptEnabled = true
                            settings.textZoom = 100
                            settings.useWideViewPort = true
                            settings.loadWithOverviewMode = false
                            // 100 % correspond ici à un pixel physique par pixel CSS, indépendamment du DPI.
                            setInitialScale(100)
                            isHorizontalScrollBarEnabled = false
                            isVerticalScrollBarEnabled = false
                            isFocusable = false
                            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                            translationX = -(width + 16).toFloat()
                        }
                        overlayWebView = view
                        overlayExportId = exportId
                        overlayBaseUrl = baseUrl
                        addContentView(view, ViewGroup.LayoutParams(width, height))
                        view.measure(
                            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
                        )
                        view.layout(0, 0, width, height)
                    }
                    val renderer = requireNotNull(view)
                    val captureId = ++overlayCaptureSequence
                    pendingOverlayCapture = { finish(null, "Overlay renderer released") }
                    var injected = false

                    /** Injecte le DOM et attend les images et les polices sans recharger le document. */
                    fun render() {
                        if (injected || completed.get()) return
                        injected = true
                        renderer.evaluateJavascript(
                            """
                            (async () => {
                                let error = '';
                                try {
                                    const fonts = window.captureFonts ||= new Map();
                                    const usedFonts = new Set(${args.getJSONArray("fontCss")});
                                    const stylesheets = [];
                                    for (const [css, style] of fonts) {
                                        if (usedFonts.has(css)) continue;
                                        style.remove();
                                        fonts.delete(css);
                                    }
                                    for (const css of usedFonts) {
                                        if (fonts.has(css)) continue;
                                        const style = document.createElement('style');
                                        style.textContent = css;
                                        if (css.startsWith('@import')) {
                                            stylesheets.push(new Promise((resolve, reject) => {
                                                style.onload = resolve;
                                                style.onerror = () => reject(new Error('Overlay font stylesheet failed to load'));
                                            }));
                                        }
                                        document.head.appendChild(style);
                                        fonts.set(css, style);
                                    }
                                    await Promise.all(stylesheets);
                                    document.body.innerHTML = ${JSONObject.quote(args.getString("html"))};
                                    document.body.getBoundingClientRect();
                                    await Promise.all(Array.from(document.images, image => image.decode()));
                                    await document.fonts.ready;
                                    if (Array.from(document.fonts).some(font => font.status === 'error')) {
                                        throw new Error('Overlay font failed to load');
                                    }
                                    if (Math.abs(window.innerWidth - $width) > 1) {
                                        throw new Error('Unexpected overlay viewport: ' + window.innerWidth);
                                    }
                                } catch (failure) { error = String(failure); }
                                location.href = 'qurancaption-capture://ready/$captureId?error=' + encodeURIComponent(error);
                            })();
                            """.trimIndent(), null
                        )
                    }

                    renderer.webViewClient = object : WebViewClient() {
                        /** Réutilise les protocoles Tauri pour les polices et ressources locales. */
                        override fun shouldInterceptRequest(
                            view: WebView, request: WebResourceRequest
                        ): WebResourceResponse? = delegate.shouldInterceptRequest(source, request)

                        /** Lance la première capture après le chargement du document transparent. */
                        override fun onPageFinished(view: WebView, url: String) = render()

                        /** Attend le rendu Chromium avant de dessiner les pixels dans le bitmap. */
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val uri = request.url
                            if (uri.scheme == "qurancaption-capture" &&
                                uri.lastPathSegment == captureId.toString() && !completed.get()) {
                                val error = uri.getQueryParameter("error").orEmpty()
                                if (error.isNotEmpty()) {
                                    finish(null, error)
                                } else {
                                    view.postVisualStateCallback(captureId, object : WebView.VisualStateCallback() {
                                        /** Dessine uniquement l'overlay, à la résolution d'export et avec son alpha. */
                                        override fun onComplete(requestId: Long) {
                                            if (completed.get()) return
                                            var image: Bitmap? = null
                                            try {
                                                val drawStartedAt = System.nanoTime()
                                                image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                                                view.draw(Canvas(image))
                                                drawMs = (System.nanoTime() - drawStartedAt) / 1_000_000.0
                                                finish(image, null)
                                            } catch (error: Throwable) {
                                                image?.recycle()
                                                finish(null, error.message ?: error.javaClass.simpleName)
                                            }
                                        }
                                    })
                                }
                            }
                            return true
                        }

                        /** Signale un échec du document principal sans produire de PNG vide. */
                        override fun onReceivedError(
                            view: WebView, request: WebResourceRequest, error: WebResourceError
                        ) {
                            if (request.isForMainFrame) finish(null, error.description.toString())
                        }

                        /** Détruit la WebView si Chromium termine son processus de rendu. */
                        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                            finish(null, "Overlay renderer process exited")
                            releaseOverlayWebView()
                            return true
                        }
                    }
                    handler.postDelayed({ finish(null, "Overlay capture timed out") }, 45_000)
                    if (needsLoad) {
                        renderer.loadDataWithBaseURL(
                            baseUrl,
                            """<!DOCTYPE html><html><head><meta name="viewport" content="width=$width"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body></body></html>""",
                            "text/html", "UTF-8", null
                        )
                    } else render()
                } catch (error: Throwable) {
                    finish(null, error.message ?: error.javaClass.simpleName)
                }
            }
            if (!latch.await(50, TimeUnit.SECONDS)) finish(null, "Overlay capture timed out")
            failure?.let { error(it) }
            val image = requireNotNull(bitmap) { "Overlay capture returned no bitmap" }
            val rasterMs = (System.nanoTime() - startedAt) / 1_000_000.0
            val encodeStartedAt = System.nanoTime()
            try {
                FileOutputStream(destination).use { output ->
                    check(image.compress(Bitmap.CompressFormat.PNG, 100, output)) { "Overlay PNG encoding failed" }
                }
            } catch (error: Throwable) {
                destination.delete()
                throw error
            }
            JSONObject()
                .put("rasterMs", rasterMs)
                .put("drawMs", drawMs)
                .put("pngEncodeMs", (System.nanoTime() - encodeStartedAt) / 1_000_000.0)
                .put("bytes", destination.length())
                .toString()
        } catch (error: Throwable) {
            JSONObject().put("error", error.message ?: error.javaClass.simpleName).toString()
        } finally {
            bitmap?.recycle()
        }
    }

    /**
     * Libère la WebView de cet export après sa dernière capture.
     * @param exportId Identifiant à vérifier pour ne pas fermer un export plus récent.
     */
    @Keep
    fun nativeReleaseOverlayCapture(exportId: String) = synchronized(overlayCaptureLock) {
        val latch = CountDownLatch(1)
        runOnUiThread {
            try {
                if (overlayExportId == exportId) releaseOverlayWebView()
            } finally {
                latch.countDown()
            }
        }
        check(latch.await(5, TimeUnit.SECONDS)) { "Overlay release timed out" }
    }

    /** Détruit le renderer et ses ressources ; doit être appelée sur le thread UI Android. */
    private fun releaseOverlayWebView() {
        pendingOverlayCapture?.invoke()
        pendingOverlayCapture = null
        overlayWebView?.let { view ->
            view.stopLoading()
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        overlayWebView = null
        overlayExportId = ""
        overlayBaseUrl = ""
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
     * Passe en paysage pendant le plein écran vidéo ou restaure le portrait.
     *
     * @param allowed Vrai pour forcer le paysage, faux pour verrouiller le portrait.
     */
    @Keep
    fun nativeSetLandscapeAllowed(allowed: Boolean) = runOnUiThread {
        requestedOrientation = if (allowed) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    /**
     * Charge la galerie dans une WebView temporaire et renvoie les modèles détectés.
     *
     * @param script Script de collecte des modèles et de leurs aperçus.
     * @return Liste JSON des modèles, vide en cas d'erreur ou de délai dépassé.
     */
    @Keep
    fun nativeLoadThumbnailTemplates(script: String): String {
        val latch = CountDownLatch(1)
        var result = "[]"
        runOnUiThread {
            val handler = Handler(Looper.getMainLooper())
            var webView: WebView? = null
            var completed = false

            /**
             * Libère la WebView et débloque l'appel JNI une seule fois.
             * @param data Liste JSON récupérée.
             */
            fun finish(data: String) {
                if (completed) return
                completed = true
                result = data
                handler.removeCallbacksAndMessages(null)
                webView?.let { view ->
                    view.stopLoading()
                    (view.parent as? ViewGroup)?.removeView(view)
                    view.destroy()
                }
                latch.countDown()
            }

            try {
                val view = WebView(this)
                webView = view
                view.visibility = View.INVISIBLE
                view.settings.javaScriptEnabled = true
                view.settings.domStorageEnabled = true
                var injected = false
                view.webViewClient = object : WebViewClient() {
                    /** Exécute la collecte après le chargement de la galerie. */
                    override fun onPageFinished(view: WebView, url: String) {
                        if (!injected && Uri.parse(url).host == "quranthumbnails.com") {
                            injected = true
                            view.evaluateJavascript(script, null)
                        }
                    }

                    /** Intercepte le résultat et limite la navigation au site de la galerie. */
                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: WebResourceRequest
                    ): Boolean {
                        val url = request.url
                        if (url.scheme == "qurancaption-templates") {
                            finish(url.getQueryParameter("data") ?: "[]")
                            return true
                        }
                        return url.scheme != "https" || url.host != "quranthumbnails.com"
                    }

                    /** Libère la WebView lorsque le document principal ne peut pas être chargé. */
                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceError
                    ) {
                        if (request.isForMainFrame) finish("[]")
                    }
                }
                addContentView(view, ViewGroup.LayoutParams(1440, 1000))
                handler.postDelayed({ finish("[]") }, 45_000)
                view.loadUrl("https://quranthumbnails.com/")
            } catch (_: Exception) {
                finish("[]")
            }
        }
        latch.await(50, TimeUnit.SECONDS)
        return result
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
