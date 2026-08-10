package com.veer.novashare

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest

// Android WebView ignores <input webkitdirectory> (it falls back to a plain
// file/content picker with no folder-tree browsing), so real folder
// selection needs the native Storage Access Framework instead: launch
// ACTION_OPEN_DOCUMENT_TREE, walk the returned tree with DocumentFile, and
// copy each leaf file into our cache dir (content:// tree URIs aren't
// readable from JS directly) — same cache-copy trick IncomingSharePlugin
// uses for share-sheet files.
@CapacitorPlugin(name = "FolderPicker")
class FolderPickerPlugin : Plugin() {

    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        startActivityForResult(call, intent, "folderPickerResult")
    }

    @ActivityCallback
    private fun folderPickerResult(call: PluginCall, result: androidx.activity.result.ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
            call.reject("No folder selected")
            return
        }
        val treeUri: Uri = result.data!!.data!!

        Thread {
            try {
                context.contentResolver.takePersistableUriPermission(
                    treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
                val root = DocumentFile.fromTreeUri(context, treeUri)
                val folderName = root?.name ?: "folder"
                val destDir = File(context.cacheDir, "picked_folder/${System.currentTimeMillis()}")
                destDir.mkdirs()

                val out = JSArray()
                if (root != null) collect(root, folderName, destDir, out)

                val res = JSObject()
                res.put("files", out)
                call.resolve(res)
            } catch (e: Exception) {
                call.reject("Failed to read folder: ${e.message}")
            }
        }.start()
    }

    // Recursively copies every leaf file under `doc` into destDir, preserving
    // the folder path (relPath) so the JS side can rebuild it as
    // webkitRelativePath for the existing send/receive folder-structure code.
    private fun collect(doc: DocumentFile, relPath: String, destDir: File, out: JSArray) {
        if (doc.isDirectory) {
            for (child in doc.listFiles()) {
                collect(child, "$relPath/${child.name}", destDir, out)
            }
            return
        }

        val name = doc.name ?: return
        val destFile = File(destDir, relPath.replace("/", "_"))
        // SHA-256 computed inline via DigestOutputStream during the same copy
        // pass — feeds duplicate-skip/delta-sync (feature #7) without a
        // second read of every file.
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            context.contentResolver.openInputStream(doc.uri)?.use { input ->
                DigestOutputStream(FileOutputStream(destFile), digest).use { output -> input.copyTo(output) }
            }
        } catch (e: Exception) {
            return
        }

        val entry = JSObject()
        entry.put("path", destFile.absolutePath)
        entry.put("name", name)
        entry.put("relativePath", relPath)
        entry.put("size", destFile.length())
        entry.put("mimeType", doc.type ?: "application/octet-stream")
        entry.put("hash", digest.digest().joinToString("") { "%02x".format(it) })
        out.put(entry)
    }
}
