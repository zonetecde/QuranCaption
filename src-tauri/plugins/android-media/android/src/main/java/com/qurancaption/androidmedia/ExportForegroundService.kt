package com.qurancaption.androidmedia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject

/**
 * Maintient l'export natif actif et expose sa progression dans une notification Android.
 */
class ExportForegroundService : Service() {
    private var exportId = ""
    private var fileName = ""
    private var state = ""
    private var progress = 0
    private var backgroundReady = false
    private var stateLabels = JSONObject()
    private var capturingHint = ""
    private var backgroundHint = ""
    private var completionHint = ""
    private var cancelLabel = ""
    private var cancellingLabel = ""
    private var completed = false
    private var wakeLock: PowerManager.WakeLock? = null

    /**
     * Traite les commandes de cycle de vie et de progression envoyées par le plugin.
     *
     * @param intent Commande native et données de notification.
     * @param flags Drapeaux fournis par Android.
     * @param startId Identifiant de démarrage du service.
     * @return Mode non persistant : un export interrompu ne doit pas redémarrer sans son moteur.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startExport(intent)
            ACTION_UPDATE -> updateExport(intent)
            ACTION_BACKGROUND_READY -> markBackgroundReady(intent)
            ACTION_CANCEL -> cancelExport(intent)
        }
        return START_NOT_STICKY
    }

    /**
     * Aucun binding n'est nécessaire pour ce service commandé par intents.
     *
     * @param intent Intent de binding ignoré.
     * @return Toujours `null`.
     */
    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Libère le verrou CPU si Android détruit le service.
     */
    override fun onDestroy() {
        if (!completed) stopForeground(STOP_FOREGROUND_REMOVE)
        releaseWakeLock()
        super.onDestroy()
    }

    /**
     * Arrête proprement un service ayant dépassé la limite Android 15.
     *
     * @param startId Identifiant du démarrage concerné.
     * @param fgsType Type de service au premier plan expiré.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    /**
     * Initialise la notification et le verrou CPU d'un nouvel export.
     *
     * @param intent Intent contenant les textes localisés et l'identifiant d'export.
     */
    private fun startExport(intent: Intent) {
        exportId = intent.getStringExtra(EXTRA_EXPORT_ID).orEmpty()
        fileName = intent.getStringExtra(EXTRA_FILE_NAME).orEmpty()
        state = intent.getStringExtra(EXTRA_STATE).orEmpty()
        progress = intent.getIntExtra(EXTRA_PROGRESS, 0).coerceIn(0, 100)
        stateLabels = parseLabels(intent.getStringExtra(EXTRA_STATE_LABELS))
        capturingHint = intent.getStringExtra(EXTRA_CAPTURING_HINT).orEmpty()
        backgroundHint = intent.getStringExtra(EXTRA_BACKGROUND_HINT).orEmpty()
        completionHint = intent.getStringExtra(EXTRA_COMPLETION_HINT).orEmpty()
        cancelLabel = intent.getStringExtra(EXTRA_CANCEL_LABEL).orEmpty()
        cancellingLabel = intent.getStringExtra(EXTRA_CANCELLING_LABEL).orEmpty()
        backgroundReady = false
        completed = false

        preferences(this).edit().remove(cancellationKey(exportId)).apply()
        createNotificationChannel(intent.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty())
        acquireWakeLock()
        startForegroundCompat(buildNotification())
    }

    /**
     * Met à jour la phase et la barre de progression sans réveiller visuellement l'utilisateur.
     *
     * @param intent Intent contenant la progression courante.
     */
    private fun updateExport(intent: Intent) {
        if (!matchesExport(intent)) return
        val nextState = intent.getStringExtra(EXTRA_STATE).orEmpty().ifBlank { state }
        val nextProgress = intent.getIntExtra(EXTRA_PROGRESS, progress).coerceIn(0, 100)
        if (nextState == "Exported") {
            Log.i(LOG_TAG, "Finalizing completion notification for export $exportId")
            state = nextState
            progress = nextProgress
            completeExport(intent)
            return
        }
        if (nextState == state && nextProgress == progress) return
        state = nextState
        progress = nextProgress
        notifyProgress()
    }

    /**
     * Indique que la WebView n'est plus nécessaire et que l'application peut être masquée.
     *
     * @param intent Intent identifiant l'export actif.
     */
    private fun markBackgroundReady(intent: Intent) {
        if (!matchesExport(intent)) return
        backgroundReady = true
        notifyProgress()
    }

    /**
     * Remplace la progression par une notification de réussite ouvrable par l'utilisateur.
     *
     * @param intent Intent identifiant l'export publié.
     */
    private fun completeExport(intent: Intent) {
        if (!matchesExport(intent)) return
        completed = true
        state = "Exported"
        progress = 100
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildCompletionNotification())
        Log.i(LOG_TAG, "Completion notification posted for export $exportId")
        stopSelf()
    }

    /**
     * Marque l'export comme annulé pour les boucles Rust et JavaScript.
     *
     * @param intent Intent identifiant l'export à annuler.
     */
    private fun cancelExport(intent: Intent) {
        if (!matchesExport(intent)) return
        preferences(this).edit().putBoolean(cancellationKey(exportId), true).apply()
        state = cancellingLabel
        notifyProgress(cancellable = false)
        Handler(Looper.getMainLooper()).postDelayed(
            {
                if (isCancellationRequested(this, exportId)) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            },
            CANCELLATION_STOP_TIMEOUT_MS
        )
    }

    /**
     * Vérifie que la commande vise bien le service actif.
     *
     * @param intent Intent reçu.
     * @return `true` lorsque son identifiant correspond.
     */
    private fun matchesExport(intent: Intent): Boolean =
        exportId.isNotBlank() && intent.getStringExtra(EXTRA_EXPORT_ID) == exportId

    /**
     * Crée le canal Android persistant utilisé par tous les exports.
     *
     * @param localizedName Nom localisé du canal.
     */
    private fun createNotificationChannel(localizedName: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                localizedName.ifBlank { "Video exports" },
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = localizedName
                setSound(null, null)
                enableVibration(false)
            }
        )
    }

    /**
     * Démarre le service avec le type Android dédié au traitement multimédia.
     *
     * @param notification Notification initiale obligatoire.
     */
    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    /**
     * Construit la notification avec progression, raccourci vers l'application et annulation.
     *
     * @param cancellable Affiche ou masque l'action d'annulation.
     * @return Notification prête à être publiée.
     */
    private fun buildNotification(cancellable: Boolean = true): Notification {
        val localizedState = stateLabels.optString(state, state)
        val hint = if (backgroundReady) backgroundHint else capturingHint
        val contentText = listOf(localizedState, "$progress %")
            .filter { it.isNotBlank() }
            .joinToString(" · ")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        builder
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(fileName)
            .setContentText(contentText)
            .setSubText(hint)
            .setStyle(Notification.BigTextStyle().bigText("$contentText\n$hint"))
            .setProgress(100, progress, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setContentIntent(openApplicationIntent())

        if (cancellable && cancelLabel.isNotBlank()) {
            builder.addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                cancelLabel,
                serviceIntent(ACTION_CANCEL)
            )
        }
        return builder.build()
    }

    /**
     * Construit la notification finale conservée après l'arrêt du service.
     *
     * @return Notification de réussite ouvrant Quran Caption.
     */
    private fun buildCompletionNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(stateLabels.optString(state, state))
            .setContentText(completionHint)
            .setSubText(fileName)
            .setProgress(0, 0, false)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setOngoing(false)
            .setCategory(Notification.CATEGORY_STATUS)
            .setContentIntent(openApplicationIntent())
            .build()
    }

    /**
     * Met à jour la notification déjà affichée.
     *
     * @param cancellable Affiche ou masque l'action d'annulation.
     */
    private fun notifyProgress(cancellable: Boolean = true) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(cancellable))
    }

    /**
     * Construit l'action qui rouvre l'activité principale existante.
     *
     * @return PendingIntent vers l'application.
     */
    private fun openApplicationIntent(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        } ?: return null
        return PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /**
     * Construit une action dirigée vers le service courant.
     *
     * @param action Action à exécuter.
     * @return PendingIntent de service.
     */
    private fun serviceIntent(action: String): PendingIntent =
        PendingIntent.getService(
            this,
            action.hashCode(),
            Intent(this, ExportForegroundService::class.java).apply {
                this.action = action
                putExtra(EXTRA_EXPORT_ID, exportId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    /**
     * Maintient le CPU actif pendant les traitements natifs, même écran éteint.
     */
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(PowerManager::class.java)
        wakeLock = powerManager
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:video-export")
            .apply { acquire(MAX_WAKE_LOCK_DURATION_MS) }
    }

    /**
     * Libère le verrou CPU détenu par le service.
     */
    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    /**
     * Parse sans échec la table des états localisés.
     *
     * @param value Objet JSON sérialisé par le frontend.
     * @return Objet vide lorsque la valeur est invalide.
     */
    private fun parseLabels(value: String?): JSONObject =
        try {
            JSONObject(value.orEmpty())
        } catch (_: Exception) {
            JSONObject()
        }

    companion object {
        const val ACTION_START = "com.qurancaption.export.START"
        const val ACTION_UPDATE = "com.qurancaption.export.UPDATE"
        const val ACTION_BACKGROUND_READY = "com.qurancaption.export.BACKGROUND_READY"
        const val ACTION_CANCEL = "com.qurancaption.export.CANCEL"
        const val EXTRA_EXPORT_ID = "exportId"
        const val EXTRA_FILE_NAME = "fileName"
        const val EXTRA_STATE = "state"
        const val EXTRA_PROGRESS = "progress"
        const val EXTRA_STATE_LABELS = "stateLabels"
        const val EXTRA_CAPTURING_HINT = "capturingHint"
        const val EXTRA_BACKGROUND_HINT = "backgroundHint"
        const val EXTRA_COMPLETION_HINT = "completionHint"
        const val EXTRA_CANCEL_LABEL = "cancelLabel"
        const val EXTRA_CANCELLING_LABEL = "cancellingLabel"
        const val EXTRA_CHANNEL_NAME = "channelName"
        private const val CHANNEL_ID = "quran_caption_exports"
        private const val LOG_TAG = "QuranCaptionExport"
        private const val NOTIFICATION_ID = 7301
        private const val PREFERENCES_NAME = "quran_caption_export_service"
        private const val MAX_WAKE_LOCK_DURATION_MS = 6 * 60 * 60 * 1000L
        private const val CANCELLATION_STOP_TIMEOUT_MS = 30_000L

        /**
         * Retourne le marqueur d'annulation partagé avec le moteur Rust.
         *
         * @param context Contexte Android.
         * @param exportId Identifiant d'export.
         * @return `true` après une annulation depuis la notification.
         */
        fun isCancellationRequested(context: Context, exportId: String): Boolean =
            preferences(context).getBoolean(cancellationKey(exportId), false)

        /**
         * Ouvre les préférences privées du service.
         *
         * @param context Contexte Android.
         * @return Préférences partagées du service.
         */
        private fun preferences(context: Context) =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

        /**
         * Construit la clé stable d'un marqueur d'annulation.
         *
         * @param exportId Identifiant d'export.
         * @return Clé de préférences.
         */
        private fun cancellationKey(exportId: String): String = "cancelled_$exportId"
    }
}
