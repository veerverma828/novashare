package com.veer.novashare

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

// Writes received file bytes straight into the real, system Downloads folder
// (MediaStore.Downloads on API 29+, Environment.DIRECTORY_DOWNLOADS below that)
// instead of the app's Documents sandbox, and registers the result with
// DownloadManager so Android shows the standard "Download complete"
// notification and the file appears in the system Downloads app.
@CapacitorPlugin(name = "NotifyDownload")
class NotifyDownloadPlugin : Plugin() {

    companion object {
        private const val INCOMING_SUBDIR = "incoming_p2p"

        // Strips path traversal / leading slashes / empty segments from a
        // sender-supplied relative folder path before it ever touches
        // MediaStore.RELATIVE_PATH or a File() on the legacy path.
        private fun sanitizeRelPath(raw: String?): String {
            if (raw.isNullOrBlank()) return ""
            return raw.split("/")
                .map { it.trim() }
                .filter { it.isNotEmpty() && it != "." && it != ".." }
                .joinToString("/")
        }
    }

    // Appends one small (64KB) chunk to a temp file in cache, named by fileId.
    // Keeps the received file on disk the whole time instead of building it up
    // as one giant byte array / base64 string in JS memory, which previously
    // OOM-crashed the WebView on files past ~50-100MB (only the JS side changed;
    // this plugin call is new).
    @PluginMethod
    fun appendChunk(call: PluginCall) {
        val fileId = call.getString("fileId")
        val base64Data = call.getString("data")
        if (fileId == null || base64Data == null) {
            call.reject("fileId and data are required")
            return
        }
        try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            val dir = File(context.cacheDir, INCOMING_SUBDIR)
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, fileId)
            FileOutputStream(file, true).use { it.write(bytes) }
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to write chunk: " + e.message, e)
        }
    }

    // Moves the fully-assembled temp file (written by appendChunk) into the
    // real Downloads folder via a plain stream copy, then deletes the temp
    // file. No base64/byte-array of the whole file ever exists at once.
    @PluginMethod
    fun finishReceive(call: PluginCall) {
        val fileId = call.getString("fileId")
        val fileName = call.getString("fileName")
        val mimeType = call.getString("mimeType", "application/octet-stream")
        // Optional: forward-slash-separated subfolder (from a dragged/picked
        // folder's webkitRelativePath, minus the file name itself) — recreated
        // under Downloads/NovaShare/<relPath> instead of dropping every file
        // from a folder transfer flat into Downloads.
        val relPathRaw = call.getString("relPath")
        val relPath = sanitizeRelPath(relPathRaw)
        if (fileId == null || fileName == null) {
            call.reject("fileId and fileName are required")
            return
        }

        val srcFile = File(File(context.cacheDir, INCOMING_SUBDIR), fileId)
        if (!srcFile.exists()) {
            call.reject("No received data found for $fileId")
            return
        }

        try {
            val context = context
            val length = srcFile.length()
            val fileUri: Uri
            var legacyPath: String? = null
            val subDir = if (relPath.isNotEmpty()) "NovaShare/$relPath" else "NovaShare"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues()
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType)
                values.put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$subDir")
                values.put(MediaStore.Downloads.IS_PENDING, 1)

                val itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (itemUri == null) {
                    call.reject("Could not create entry in Downloads")
                    return
                }

                resolver.openOutputStream(itemUri).use { out ->
                    FileInputStream(srcFile).use { input -> input.copyTo(out!!) }
                }

                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(itemUri, values, null, null)

                fileUri = itemUri
            } else {
                val downloadsDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subDir)
                if (!downloadsDir.exists()) downloadsDir.mkdirs()
                val destFile = File(downloadsDir, fileName)

                FileInputStream(srcFile).use { input ->
                    FileOutputStream(destFile).use { output -> input.copyTo(output) }
                }

                MediaScannerConnection.scanFile(context, arrayOf(destFile.absolutePath), null, null)
                fileUri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", destFile)
                legacyPath = destFile.absolutePath
            }

            val notificationPath = legacyPath
                ?: File(
                    File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), subDir),
                    fileName
                ).absolutePath

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadManager.addCompletedDownload(
                fileName, "Received via NovaShare", true, mimeType, notificationPath, length, true
            )

            srcFile.delete()

            val result = JSObject()
            result.put("success", true)
            result.put("uri", fileUri.toString())
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to save to Downloads: " + e.message, e)
        }
    }

    // SHA-256 of the assembled cache temp file, streamed (never loads the
    // whole file into memory) — called by JS right before finishReceive to
    // verify the on-disk bytes match what the sender's metadata claimed,
    // since the bytes never pass back through JS to be hashed there.
    @PluginMethod
    fun hashFile(call: PluginCall) {
        val fileId = call.getString("fileId")
        if (fileId == null) {
            call.reject("fileId is required")
            return
        }
        val srcFile = File(File(context.cacheDir, INCOMING_SUBDIR), fileId)
        if (!srcFile.exists()) {
            call.reject("No received data found for $fileId")
            return
        }
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(srcFile).use { input ->
                val buffer = ByteArray(64 * 1024)
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                    digest.update(buffer, 0, read)
                }
            }
            val hex = digest.digest().joinToString("") { "%02x".format(it) }
            val result = JSObject()
            result.put("sha256", hex)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to hash file: " + e.message, e)
        }
    }

    // Free space on the volume finishReceive actually writes into (the public
    // Downloads dir on all supported API levels, MediaStore-backed or not —
    // StatFs works on the path regardless of which write path gets used).
    @PluginMethod
    fun checkFreeSpace(call: PluginCall) {
        try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val stat = StatFs(downloadsDir.absolutePath)
            val result = JSObject()
            result.put("freeBytes", stat.availableBytes)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to check free space: " + e.message, e)
        }
    }

    // Lets JS check, after a cold start, whether a partially-written temp file
    // from an interrupted receive is still sitting in cache before offering to
    // resume into it.
    @PluginMethod
    fun getPartialInfo(call: PluginCall) {
        val fileId = call.getString("fileId")
        if (fileId == null) {
            call.reject("fileId is required")
            return
        }
        val srcFile = File(File(context.cacheDir, INCOMING_SUBDIR), fileId)
        val result = JSObject()
        result.put("exists", srcFile.exists())
        result.put("size", if (srcFile.exists()) srcFile.length() else 0)
        call.resolve(result)
    }

    // Deletes an orphaned partial temp file — used when the user declines to
    // resume an interrupted receive, or a checkpoint expires.
    @PluginMethod
    fun discardPartial(call: PluginCall) {
        val fileId = call.getString("fileId")
        if (fileId == null) {
            call.reject("fileId is required")
            return
        }
        val srcFile = File(File(context.cacheDir, INCOMING_SUBDIR), fileId)
        srcFile.delete()
        call.resolve()
    }

    // Hands the content:// URI finishReceive returned to whatever app the
    // user has for that mime type (gallery, PDF viewer, etc.) via a normal
    // ACTION_VIEW chooser — tapping a received file just opens it.
    @PluginMethod
    fun openFile(call: PluginCall) {
        val uriString = call.getString("uri")
        val mimeType = call.getString("mimeType", "*/*")
        if (uriString == null) {
            call.reject("uri is required")
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(uriString), mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(intent, null).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
            call.resolve()
        } catch (e: ActivityNotFoundException) {
            call.reject("No app found to open this file")
        } catch (e: Exception) {
            call.reject("Failed to open file: " + e.message, e)
        }
    }

}
