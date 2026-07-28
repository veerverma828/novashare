package com.veer.novashare

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// Keeps NovaShare's process alive and visible while a transfer is running
// and the app is minimized. Without this, Android throttles or kills the
// background WebView (and with it the WebRTC data channels) after a short
// while — the foreground service + persistent notification is what tells
// the OS "the user knows this is running, don't stop it."
class TransferForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "novashare_transfers"
        const val NOTIFICATION_ID = 4201
        const val ACTION_STOP = "com.veer.novashare.action.STOP_TRANSFER"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_PROGRESS = "progress"
        const val EXTRA_INDETERMINATE = "indeterminate"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "NovaShare"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Transfer in progress"
        val progress = intent?.getIntExtra(EXTRA_PROGRESS, 0) ?: 0
        val indeterminate = intent?.getBooleanExtra(EXTRA_INDETERMINATE, false) ?: false

        // Calling this again on an already-running instance just updates the
        // existing notification in place — same call path serves both
        // "start" and "update" from the JS side.
        startForeground(NOTIFICATION_ID, buildNotification(title, text, progress, indeterminate))
        return START_STICKY
    }

    private fun buildNotification(title: String, text: String, progress: Int, indeterminate: Boolean): Notification {
        ensureChannel()

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
            .setProgress(100, progress, indeterminate)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID, "File transfers", NotificationManager.IMPORTANCE_LOW
                )
                channel.description = "Shows progress while NovaShare is sending or receiving files"
                channel.setSound(null, null)
                manager.createNotificationChannel(channel)
            }
        }
    }
}
