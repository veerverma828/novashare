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
import android.window.SplashScreenView
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity
import java.io.File
import java.io.FileOutputStream
import java.time.Duration
import java.time.Instant

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
            // The icon has just folded into a paper plane, so the exit is its take-off: a
            // climb up and slightly across, accelerating the whole way out. The drift is a
            // fraction of width rather than a fixed dp so the flight path keeps the same
            // angle on any screen.
            val lift = -splashScreenView.height * SPLASH_EXIT_LIFT_FRACTION
            val drift = splashScreenView.width * SPLASH_EXIT_DRIFT_FRACTION
            val animations = mutableListOf<Animator>(
                ObjectAnimator.ofFloat(splashScreenView, View.ALPHA, 1f, 0f),
                ObjectAnimator.ofFloat(splashScreenView, View.TRANSLATION_Y, 0f, lift),
                ObjectAnimator.ofFloat(splashScreenView, View.TRANSLATION_X, 0f, drift)
            )

            // This listener fires the instant the app is ready to draw, which on a warm start
            // can be long before the bolt has finished folding into the plane. Taking off from
            // a half-morphed shape is the one thing that must never happen, so the exit waits
            // out whatever is left of the icon animation. The system reports both when that
            // animation started and how long it runs, so the wait is measured rather than
            // guessed — it self-corrects on a slow device (nothing left to wait for, exit is
            // immediate) and on a fast one (waits the full remainder).
            val holdForIcon = remainingIconAnimationMs(splashScreenView)

            val exit = AnimatorSet().apply {
                playTogether(animations)
                duration = SPLASH_EXIT_DURATION_MS
                startDelay = holdForIcon
                interpolator = AccelerateInterpolator(2f)
                addListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) = finish()
                })
            }

            // Watchdog: if the animator never reports completion, the splash would hang over a
            // fully-booted app. Budgeted past the animation's own duration, and past the hold
            // as well — a fixed backstop would otherwise fire mid-hold and cut the morph.
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, holdForIcon + SPLASH_EXIT_TIMEOUT_MS)

            exit.start()
        }
    }

    /**
     * How much of the splash icon animation has yet to play, in ms.
     *
     * Both values come from the system rather than from our own constants, which is the point:
     * the drawable's timings, the theme's windowSplashScreenAnimationDuration and whatever cap
     * a given OEM applies can all disagree, and only the system knows what it actually started
     * and for how long. Reading them keeps the hand-off correct without this file having to
     * track the drawable.
     *
     * Returns 0 when the animation is already done, when the device reports no animated icon
     * (some OEM launchers, or a static fallback), or when the clock reads backwards — in every
     * one of those cases there is nothing to wait for and the exit should just run.
     *
     * The result is capped: if a device were ever to report an implausibly long duration, an
     * uncapped wait would strand the user on a splash over an app that is already running.
     */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun remainingIconAnimationMs(splashScreenView: SplashScreenView): Long {
        val start = splashScreenView.iconAnimationStart ?: return 0L
        val total = splashScreenView.iconAnimationDuration ?: return 0L
        val elapsed = Duration.between(start, Instant.now()).toMillis()
        val remaining = total.toMillis() - elapsed
        return remaining.coerceIn(0L, SPLASH_MAX_ICON_HOLD_MS)
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
        const val SPLASH_EXIT_DURATION_MS = 420L

        // How far the plane climbs as it leaves, as a fraction of the splash height. Much
        // larger than a plain fade-out would want: the shape is a plane by this point, and
        // it has to actually clear the screen for the exit to read as flying off rather
        // than drifting. The acceleration curve keeps the start of the climb gentle.
        const val SPLASH_EXIT_LIFT_FRACTION = 0.85f

        // Sideways drift over the same climb, as a fraction of width — enough to angle the
        // flight path, not so much that the plane exits sideways.
        const val SPLASH_EXIT_DRIFT_FRACTION = 0.22f

        // Backstop if the animator never reports completion. Must stay above the duration
        // above, or it would cut the animation short. Applied on top of the icon hold.
        const val SPLASH_EXIT_TIMEOUT_MS = 700L

        // Ceiling on how long the exit will wait for the icon animation to finish. Sits just
        // above the drawable's own length (900ms) so a normal cold start is never clipped,
        // while a device reporting a nonsense duration still can't strand the splash.
        const val SPLASH_MAX_ICON_HOLD_MS = 1000L
    }
}
