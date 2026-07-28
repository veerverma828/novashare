package com.veer.novashare

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// JS-facing control for TransferForegroundService: update() starts the
// service on first call and just refreshes its notification on later calls;
// stop() tears it down. Requests POST_NOTIFICATIONS (Android 13+) lazily,
// the first time a transfer actually needs to show progress.
@CapacitorPlugin(
    name = "TransferNotification",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")]
)
class TransferNotificationPlugin : Plugin() {

    @PluginMethod
    fun update(call: PluginCall) {
        if (needsNotificationPermission()) {
            requestPermissionForAlias("notifications", call, "notificationPermCallback")
            return
        }
        launchService(call)
    }

    @PermissionCallback
    private fun notificationPermCallback(call: PluginCall) {
        // Granted or denied, still start the service — it keeps the process
        // alive either way; a denial just means no visible notification.
        launchService(call)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val intent = Intent(context, TransferForegroundService::class.java).apply {
            action = TransferForegroundService.ACTION_STOP
        }
        context.startService(intent)
        call.resolve()
    }

    private fun launchService(call: PluginCall) {
        val intent = Intent(context, TransferForegroundService::class.java).apply {
            putExtra(TransferForegroundService.EXTRA_TITLE, call.getString("title") ?: "NovaShare")
            putExtra(TransferForegroundService.EXTRA_TEXT, call.getString("text") ?: "Transfer in progress")
            putExtra(TransferForegroundService.EXTRA_PROGRESS, call.getInt("progress") ?: 0)
            putExtra(TransferForegroundService.EXTRA_INDETERMINATE, call.getBoolean("indeterminate") ?: false)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to update transfer notification: " + e.message, e)
        }
    }

    private fun needsNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    }
}
