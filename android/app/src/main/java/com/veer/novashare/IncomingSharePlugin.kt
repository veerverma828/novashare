package com.veer.novashare

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import android.webkit.MimeTypeMap

// Bridges Android's share-sheet (ACTION_SEND/SEND_MULTIPLE, wired up in
// MainActivity) into the webview. MainActivity copies whatever the OS handed
// it into our cache dir (content:// URIs aren't readable from JS directly)
// and drops the resulting paths here. Cold-start shares land before the
// webview/plugin exist, so they queue in pendingPaths until the JS side asks
// for them once on mount; shares that arrive while already running go out
// immediately as an event too.
@CapacitorPlugin(name = "IncomingShare")
class IncomingSharePlugin : Plugin() {

    companion object {
        val pendingPaths = mutableListOf<String>()
        var activeInstance: IncomingSharePlugin? = null
    }

    override fun load() {
        activeInstance = this
    }

    @PluginMethod
    fun getPendingFiles(call: PluginCall) {
        val res = JSObject()
        res.put("files", drainPendingAsJSArray())
        call.resolve(res)
    }

    // Called by MainActivity when a share intent arrives while the app (and
    // this plugin instance) is already alive.
    fun notifyNewFiles() {
        val data = JSObject()
        data.put("files", drainPendingAsJSArray())
        notifyListeners("sharedFilesReceived", data)
    }

    private fun drainPendingAsJSArray(): JSArray {
        val result = JSArray()
        for (path in pendingPaths) result.put(pathToEntry(path))
        pendingPaths.clear()
        return result
    }

    private fun pathToEntry(path: String): JSObject {
        val file = File(path)
        val ext = MimeTypeMap.getFileExtensionFromUrl(path)
        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"

        val obj = JSObject()
        obj.put("path", path)
        obj.put("name", file.name)
        obj.put("size", file.length())
        obj.put("mimeType", mimeType)
        return obj
    }
}
