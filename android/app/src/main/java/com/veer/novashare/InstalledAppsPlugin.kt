package com.veer.novashare

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

// Lists user-installed (non-system) packages and hands back an installed
// app's own APK bytes, so the existing P2P send flow can share it exactly
// like any other picked file. Icons are fetched one at a time on demand
// (getAppIcon) rather than bundled into the list call, since encoding
// hundreds of bitmaps up front would block the list from ever feeling fast.
@CapacitorPlugin(name = "InstalledApps")
class InstalledAppsPlugin : Plugin() {

    companion object {
        private const val MAX_APK_BYTES = 500L * 1024 * 1024
        private const val ICON_SIZE_PX = 96
        private const val CACHE_SUBDIR = "shared_apks"
    }

    @PluginMethod
    fun listInstalledApps(call: PluginCall) {
        try {
            val pm = context.packageManager
            val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            val result = JSArray()

            for (info in installed) {
                val isSystem = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                if (isSystem) continue

                val pkg = info.packageName
                val label = try {
                    pm.getApplicationLabel(info).toString()
                } catch (e: Exception) {
                    pkg
                }

                val versionName = try {
                    pm.getPackageInfo(pkg, 0).versionName ?: ""
                } catch (e: Exception) {
                    // versionName stays blank if it can't be resolved
                    ""
                }

                val apkSize = info.sourceDir?.let { File(it) }?.takeIf { it.exists() }?.length() ?: 0L

                val obj = JSObject()
                obj.put("packageName", pkg)
                obj.put("appName", label)
                obj.put("versionName", versionName)
                obj.put("apkSize", apkSize)
                result.put(obj)
            }

            val res = JSObject()
            res.put("apps", result)
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("Failed to list installed apps: " + e.message, e)
        }
    }

    @PluginMethod
    fun getAppIcon(call: PluginCall) {
        val pkg = call.getString("packageName")
        if (pkg == null) {
            call.reject("packageName is required")
            return
        }
        try {
            val pm = context.packageManager
            val drawable = pm.getApplicationIcon(pkg)
            val bitmap = drawableToBitmap(drawable, ICON_SIZE_PX)

            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 90, stream)
            val base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)

            val res = JSObject()
            res.put("icon", "data:image/png;base64,$base64")
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("Failed to load icon: " + e.message, e)
        }
    }

    // Copies the installed package's own APK into our app cache dir with a
    // plain file-to-file byte copy — no base64, no JS-bridge JSON payload.
    // The JS side turns the returned path into a webview-loadable URL via
    // Capacitor.convertFileSrc() and fetch()es it straight into a Blob/File,
    // which is far faster than shipping the bytes across the bridge as text
    // (that approach previously OOM'd on large APKs and was slow even chunked).
    @PluginMethod
    fun getApkCachePath(call: PluginCall) {
        val pkg = call.getString("packageName")
        if (pkg == null) {
            call.reject("packageName is required")
            return
        }
        try {
            val pm = context.packageManager
            val info = pm.getApplicationInfo(pkg, 0)
            if (info.sourceDir == null) {
                call.reject("Could not resolve APK path for $pkg")
                return
            }

            val apkFile = File(info.sourceDir)
            if (!apkFile.exists()) {
                call.reject("APK file not found for $pkg")
                return
            }
            if (apkFile.length() > MAX_APK_BYTES) {
                call.reject("APK too large to share directly (${apkFile.length() / (1024 * 1024)} MB)")
                return
            }

            val cacheDir = File(context.cacheDir, CACHE_SUBDIR)
            if (!cacheDir.exists()) cacheDir.mkdirs()
            val destFile = File(cacheDir, "$pkg.apk")

            FileInputStream(apkFile).use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
            }

            val res = JSObject()
            res.put("path", destFile.absolutePath)
            res.put("size", destFile.length())
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("Failed to prepare APK: " + e.message, e)
        }
    }

    // Deletes any APKs staged into the cache dir by getApkCachePath. Safe to
    // call any time — by the point the caller calls this, the Files already
    // fetched into JS memory hold their own copy of the bytes.
    @PluginMethod
    fun clearApkCache(call: PluginCall) {
        try {
            File(context.cacheDir, CACHE_SUBDIR).deleteRecursively()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to clear APK cache: " + e.message, e)
        }
    }

    private fun drawableToBitmap(drawable: Drawable, sizePx: Int): Bitmap {
        if (drawable is BitmapDrawable) {
            return Bitmap.createScaledBitmap(drawable.bitmap, sizePx, sizePx, true)
        }
        val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, sizePx, sizePx)
        drawable.draw(canvas)
        return bitmap
    }
}
