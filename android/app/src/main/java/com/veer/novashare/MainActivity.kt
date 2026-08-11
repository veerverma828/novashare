package com.veer.novashare

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.View
import android.view.animation.AccelerateInterpolator
import android.view.ViewGroup
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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
        registerPlugin(WifiDirectPlugin::class.java)
        registerPlugin(HotspotPlugin::class.java)
        registerPlugin(LocalSignalingServerPlugin::class.java)
        registerPlugin(AppUpdatePlugin::class.java)
        super.onCreate(savedInstanceState)

        // Must run after super.onCreate() — Capacitor's SplashScreen plugin installs the
        // splash during plugin load, and whichever exit listener is registered last wins.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setupSplashExitAnimation()
        }

        // Cold start via share-sheet: the plugin/webview aren't ready yet, so
        // this just queues into IncomingSharePlugin.pendingPaths — JS drains
        // it once on mount via getPendingFiles().
        handleIncomingShare(intent, notifyIfActive = false)

        // Android 15+ (targetSdk 35+) forces edge-to-edge and ignores
        // setDecorFitsSystemWindows(true), so the WebView draws underneath both
        // the status bar and the gesture nav bar unless we pad it ourselves —
        // otherwise the header renders under the status bar icons and bottom
        // content (e.g. the Connect & Download button) renders behind/under
        // the gesture bar.
        // WebView doesn't reliably reposition its rendered content in response
        // to View.setPadding, so use layout margins instead — those actually
        // move/resize the view within its parent.
        ViewCompat.setOnApplyWindowInsetsListener(bridge.webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val params = view.layoutParams as ViewGroup.MarginLayoutParams
            params.setMargins(bars.left, bars.top, bars.right, bars.bottom)
            view.layoutParams = params
            insets
        }
    }

    /**
     * Animates the splash away as it hands off to the app, so the bolt collapses out instead of
     * being cut abruptly.
     *
     * This deliberately transforms the SplashScreenView as a whole (lift + fade) rather than
     * touching the icon inside it. Reaching into the icon is not portable: the system renders
     * the animated splash icon into a SurfaceView composited from the system shell process, so
     * on this device iconView comes back with a null background AND a null image drawable —
     * the bolt on screen is not drawn by this process at all. Anything that depends on how a
     * given OEM builds that icon (its drawable, its size, its position) is a guess that holds
     * on one device and breaks on the next. Transforming the view is documented, supported API
     * and behaves the same everywhere.
     *
     * Two things make this load-bearing rather than cosmetic:
     *  - Registering an exit listener stops the system from auto-removing the splash view, so
     *    EVERY path out of here must call remove() or the splash stays on screen forever.
     *  - launchFadeOutDuration is 0 in capacitor.config.json specifically so Capacitor's
     *    plugin doesn't register a competing fade-out listener that would replace this one.
     */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun setupSplashExitAnimation() {
        splashScreen.setOnExitAnimationListener { splashScreenView ->
            // remove() is reachable from both the animator and the watchdog below, and isn't
            // safe to call twice, so gate it.
            var removed = false
            val finish = {
                if (!removed) {
                    removed = true
                    splashScreenView.remove()
                }
            }

            // Translation is the transform to reach for here, and it is not interchangeable
            // with scale/alpha. The system draws the icon into a SurfaceView composited as its
            // own layer, which ignores scale and alpha applied to the view tree — whether set
            // on splashScreenView or directly on iconView, both were tried on-device and left
            // a fully opaque, full-size bolt sitting over a background that had already faded,
            // then popping. Position does sync to the surface, so a lift carries the icon with
            // it and the fade rides along. This is also the transform Google's own exit-anim
            // sample uses.
            val lift = -splashScreenView.height * SPLASH_EXIT_LIFT_FRACTION
            val animations = mutableListOf<Animator>(
                ObjectAnimator.ofFloat(splashScreenView, View.ALPHA, 1f, 0f),
                ObjectAnimator.ofFloat(splashScreenView, View.TRANSLATION_Y, 0f, lift)
            )

            val exit = AnimatorSet().apply {
                playTogether(animations)
                duration = SPLASH_EXIT_DURATION_MS
                interpolator = AccelerateInterpolator(1.4f)
                addListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) = finish()
                })
            }

            // Watchdog: if the animator never reports completion, the splash would hang over a
            // fully-booted app. Budgeted just past the animation's own duration.
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, SPLASH_EXIT_TIMEOUT_MS)

            exit.start()
        }
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

    private companion object {
        // Kept short: by this point the app is booted and waiting behind the splash, so this
        // is delay the user feels.
        const val SPLASH_EXIT_DURATION_MS = 320L

        // How far the splash lifts as it leaves, as a fraction of its height. Small on
        // purpose: the fade carries most of the effect, and a full-height slide this quick
        // reads as a jerk rather than a lift.
        const val SPLASH_EXIT_LIFT_FRACTION = 0.18f

        // Backstop if the animator never reports completion. Must stay above the duration
        // above, or it would cut the animation short.
        const val SPLASH_EXIT_TIMEOUT_MS = 600L
    }
}
