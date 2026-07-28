package com.veer.novashare

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream

// Writes received file bytes straight into the real, system Downloads folder
// (MediaStore.Downloads on API 29+, Environment.DIRECTORY_DOWNLOADS below that)
// instead of the app's Documents sandbox, and registers the result with
// DownloadManager so Android shows the standard "Download complete"
// notification and the file appears in the system Downloads app.
@CapacitorPlugin(name = "NotifyDownload")
class NotifyDownloadPlugin : Plugin() {

    @PluginMethod
    fun saveToDownloads(call: PluginCall) {
        val fileName = call.getString("fileName")
        val mimeType = call.getString("mimeType", "application/octet-stream")
        val base64Data = call.getString("data")

        if (fileName == null || base64Data == null) {
            call.reject("fileName and data are required")
            return
        }

        try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            val context = context
            val length = bytes.size.toLong()
            val fileUri: Uri
            var legacyPath: String? = null

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues()
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType)
                values.put(MediaStore.Downloads.IS_PENDING, 1)

                val itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (itemUri == null) {
                    call.reject("Could not create entry in Downloads")
                    return
                }

                resolver.openOutputStream(itemUri).use { out -> out?.write(bytes) }

                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(itemUri, values, null, null)

                fileUri = itemUri
            } else {
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) downloadsDir.mkdirs()
                val file = File(downloadsDir, fileName)

                FileOutputStream(file).use { fos -> fos.write(bytes) }

                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), null, null)
                fileUri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
                legacyPath = file.absolutePath
            }

            // The 9-arg overload's "uri" param is the originating HTTP/HTTPS source
            // URL, not the local file location — passing our content:// media Uri
            // there throws "Can only download HTTP/HTTPS URIs". There's no real
            // download URL here, so use the plain path-based overload instead; the
            // MediaStore write above still lands at this same real filesystem path.
            val notificationPath = legacyPath
                ?: File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    fileName
                ).absolutePath

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadManager.addCompletedDownload(
                fileName, "Received via NovaShare", true, mimeType, notificationPath, length, true
            )

            val result = JSObject()
            result.put("success", true)
            result.put("uri", fileUri.toString())
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to save to Downloads: " + e.message, e)
        }
    }
}
