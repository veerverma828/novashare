package com.veer.novashare

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import com.getcapacitor.BridgeActivity
import java.io.File
import java.io.FileOutputStream

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(NotifyDownloadPlugin::class.java)
        registerPlugin(InstalledAppsPlugin::class.java)
        registerPlugin(IncomingSharePlugin::class.java)
        registerPlugin(TransferNotificationPlugin::class.java)
        registerPlugin(NearbyDiscoveryPlugin::class.java)
        registerPlugin(FolderPickerPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Cold start via share-sheet: the plugin/webview aren't ready yet, so
        // this just queues into IncomingSharePlugin.pendingPaths — JS drains
        // it once on mount via getPendingFiles().
        handleIncomingShare(intent, notifyIfActive = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // App already running: push straight to JS via the plugin's event.
        handleIncomingShare(intent, notifyIfActive = true)
    }

    private fun handleIncomingShare(intent: Intent?, notifyIfActive: Boolean) {
        if (intent == null) return

        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val single = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (single != null) listOf(single) else emptyList()
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
            }
            else -> emptyList()
        }
        if (uris.isEmpty()) return

        // File copying is I/O, keep it off the main thread; nothing here
        // touches UI, so a bare Thread is enough for a short-lived copy.
        Thread {
            val destDir = File(cacheDir, "shared_incoming")
            if (!destDir.exists()) destDir.mkdirs()

            for (uri in uris) {
                try {
                    val name = queryDisplayName(uri) ?: "shared_${System.currentTimeMillis()}"
                    val destFile = File(destDir, name)
                    contentResolver.openInputStream(uri)?.use { input ->
                        FileOutputStream(destFile).use { output -> input.copyTo(output) }
                    }
                    IncomingSharePlugin.pendingPaths.add(destFile.absolutePath)
                } catch (e: Exception) {
                    // Skip files we couldn't read; the rest of the batch still goes through.
                }
            }

            if (notifyIfActive) {
                IncomingSharePlugin.activeInstance?.notifyNewFiles()
            }
        }.start()
    }

    private fun queryDisplayName(uri: Uri): String? {
        return try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0 && cursor.moveToFirst()) cursor.getString(nameIndex) else null
            }
        } catch (e: Exception) {
            null
        }
    }
}
