package com.veer.novashare

import android.content.Intent
import android.graphics.drawable.Animatable2
import android.graphics.drawable.AnimatedVectorDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
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
     * Un-forms the splash bolt as the splash tears down, so the logo retracts into the app
     * instead of being cut off fully-drawn.
     *
     * Runs splash_laser_bolt_exit.xml (trimPathEnd 1 -> 0) in an ImageView overlaid on the
     * splash, with the system's icon view hidden behind it.
     *
     * Two simpler approaches don't work here, both confirmed on-device rather than assumed:
     *  - reverse() on the entry drawable: reverse()/canReverse() are @hide on the platform
     *    AnimatedVectorDrawable, public only on AnimatedVectorDrawableCompat.
     *  - Swapping the icon view's drawable: there is nothing to swap. The system renders the
     *    animated splash icon into a SurfaceView composited from the system shell process, so
     *    iconView comes back with a null background AND a null image drawable — the bolt on
     *    screen is not drawn by this process at all.
     *
     * The exit drawable opens on the fully-drawn frame the entry animation ends on, and is laid
     * out at its intrinsic size (see the sizing note below), so the handover reads as one
     * continuous bolt rather than a swap.
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
            // remove() is reachable from both the animation callback and the watchdog below,
            // and isn't safe to call twice, so gate it.
            var removed = false
            val finish = {
                if (!removed) {
                    removed = true
                    splashScreenView.remove()
                }
            }

            val icon = splashScreenView.iconView
            val exit = getDrawable(R.drawable.splash_laser_bolt_exit) as? AnimatedVectorDrawable

            if (icon == null || exit == null) {
                // No icon view to animate (OEM splash override), or the drawable didn't
                // inflate. Drop the flourish rather than stranding the splash on screen.
                finish()
                return@setOnExitAnimationListener
            }

            // The entry bolt can't simply be swapped out: the system renders the animated
            // splash icon into a SurfaceView composited from the system shell process, so
            // there is no drawable in our view tree to replace (confirmed on this device —
            // iconView is a SurfaceView with a null background and null image drawable).
            //
            // Instead, hide that surface and overlay our own ImageView running the exit
            // animation in-process. The exit drawable opens on the fully-drawn frame the
            // entry animation ended on, and is laid out to the same box, so the handover
            // reads as one continuous bolt rather than a swap.
            if (icon.width <= 0 || icon.height <= 0) {
                Log.w(TAG, "splash icon has no size (${icon.width}x${icon.height}); skipping")
                finish()
                return@setOnExitAnimationListener
            }

            // Size the overlay to the drawable's INTRINSIC size, not the icon view's. The icon
            // view is 192dp (576px at this device's 3.0 density) while the drawable's canvas is
            // 288dp (864px), and the system draws it at natural size rather than fitting it to
            // that view. Laying out to icon.width/height instead made FIT_CENTER shrink the
            // exit bolt to 576/864 = 0.67 of the entry bolt — a visible pop at the handover.
            val exitView = ImageView(this).apply {
                setImageDrawable(exit)
                scaleType = ImageView.ScaleType.FIT_CENTER
                layoutParams = FrameLayout.LayoutParams(
                    exit.intrinsicWidth,
                    exit.intrinsicHeight,
                    Gravity.CENTER
                )
            }
            icon.visibility = View.INVISIBLE
            splashScreenView.addView(exitView)

            exit.registerAnimationCallback(object : Animatable2.AnimationCallback() {
                override fun onAnimationEnd(drawable: Drawable?) {
                    exit.unregisterAnimationCallback(this)
                    finish()
                }
            })

            // Watchdog: if the animation never reports completion, the splash would hang over
            // a fully-booted app. Budgeted just past the animation's own duration.
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
        // Slightly longer than the 450ms animation in splash_laser_bolt_exit.xml, leaving
        // room for it to finish before the watchdog steps in. Keep the two in step if that
        // duration changes.
        const val SPLASH_EXIT_TIMEOUT_MS = 700L
        const val TAG = "NovaSplash"
    }
}
