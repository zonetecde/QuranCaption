package com.qurancaption

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.annotation.Keep
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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
}

private object NativeAudioPlayer {
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
