package com.veer.novashare

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

// Delivers images committed straight from the keyboard (Gboard's GIF/sticker/
// image pickers) to the JS layer. RichContentWebView is inflated from the
// layout and never gets a Bridge handle of its own, so the live plugin
// instance is parked here for it to hand commits off to.
@CapacitorPlugin(name = "RichContent")
class RichContentPlugin : Plugin() {

    override fun load() {
        instance = this
        super.load()
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        super.handleOnDestroy()
    }

    companion object {
        @Volatile
        private var instance: RichContentPlugin? = null

        // No-op when nothing is listening yet (commit before the WebView
        // finished loading) — dropping the image beats crashing the IME.
        fun emitImage(base64: String, mime: String, name: String) {
            val plugin = instance ?: return
            val data = JSObject()
            data.put("data", base64)
            data.put("mime", mime)
            data.put("name", name)
            plugin.notifyListeners("imageCommitted", data)
        }
    }
}
