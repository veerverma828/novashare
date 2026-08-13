package com.veer.novashare

import android.content.Context
import android.util.AttributeSet
import android.util.Base64
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.core.view.inputmethod.EditorInfoCompat
import androidx.core.view.inputmethod.InputConnectionCompat
import com.getcapacitor.CapacitorWebView

// An IME only offers its GIF/sticker/image pickers if the focused editor
// declares which MIME types it accepts. Capacitor's CapacitorWebView never
// sets any, so every <input>/<textarea> in the app makes Gboard report "This
// app does not support images here". Declaring them here — plus handling the
// commit — turns rich-content input on for the whole WebView at once.
//
// Must extend CapacitorWebView rather than WebView: Capacitor's Bridge looks
// up R.id.webview and casts it to CapacitorWebView, and super's
// onCreateInputConnection still applies the captureInput config option.
class RichContentWebView(context: Context, attrs: AttributeSet) : CapacitorWebView(context, attrs) {

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val target = super.onCreateInputConnection(outAttrs) ?: return null
        EditorInfoCompat.setContentMimeTypes(outAttrs, ACCEPTED_MIME_TYPES)

        val onCommit = InputConnectionCompat.OnCommitContentListener { info, flags, _ ->
            // The content URI is owned by the IME's process. Without this grant
            // the resolver read below throws SecurityException on most devices.
            if (flags and InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION != 0) {
                try {
                    info.requestPermission()
                } catch (e: Exception) {
                    return@OnCommitContentListener false
                }
            }

            var handled = false
            try {
                val uri = info.contentUri
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null && bytes.isNotEmpty()) {
                    val mime = context.contentResolver.getType(uri)
                        ?: info.description.getMimeType(0)
                        ?: "image/*"
                    val name = fileNameFor(mime, info.description.label?.toString())
                    RichContentPlugin.emitImage(Base64.encodeToString(bytes, Base64.NO_WRAP), mime, name)
                    handled = true
                }
            } catch (e: Exception) {
                handled = false
            } finally {
                // Bytes are already copied out above, so the grant can go back
                // immediately rather than leaking until the IME reclaims it.
                try { info.releasePermission() } catch (e: Exception) { /* never granted */ }
            }
            handled
        }

        return InputConnectionCompat.createWrapper(target, outAttrs, onCommit)
    }

    // IMEs put a human description in the label ("two dogs dancing on a purple
    // surface"), not a filename, and it carries no extension. The UI picks the
    // inline image preview off the extension (getFileType), so an
    // extension-less name renders a GIF as a generic file card — with the whole
    // sentence as its title, which is also what blows out that card's width.
    // Keep a short, sanitised slice of the label for readability and always
    // stamp on the extension the MIME type actually implies.
    private fun fileNameFor(mime: String, rawLabel: String?): String {
        val ext = when {
            mime.contains("gif") -> "gif"
            mime.contains("png") -> "png"
            mime.contains("webp") -> "webp"
            else -> "jpg"
        }
        val base = rawLabel
            ?.replace(Regex("[^A-Za-z0-9 _-]"), "")
            ?.trim()
            ?.take(32)
            ?.trim()
        return if (base.isNullOrEmpty()) "keyboard-${System.currentTimeMillis()}.$ext" else "$base.$ext"
    }

    companion object {
        // Explicit list rather than "image/*": some IMEs only surface a picker
        // when the concrete type it wants to send is named.
        private val ACCEPTED_MIME_TYPES = arrayOf(
            "image/gif",
            "image/png",
            "image/jpeg",
            "image/webp"
        )
    }
}
