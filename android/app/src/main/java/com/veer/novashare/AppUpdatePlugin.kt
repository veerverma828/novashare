package com.veer.novashare

import android.app.Activity
import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

// Wraps Google Play's In-App Update (Play Core) flexible-update flow: Play
// Store handles the consent UI and the background download itself, this
// plugin just surfaces availability + progress to JS so the app can render
// its own themed banner instead of Play Core's default (unstyled) UI.
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {

    companion object {
        private const val REQUEST_CODE_FLEXIBLE_UPDATE = 5417
    }

    private lateinit var appUpdateManager: AppUpdateManager
    private var listenerRegistered = false

    // Forwards Play Core's download/install progress straight through as a
    // JS event — JS drives the actual banner state machine from these.
    private val installStateListener = InstallStateUpdatedListener { state ->
        val data = JSObject()
        data.put("status", statusName(state.installStatus()))
        data.put("bytesDownloaded", state.bytesDownloaded())
        data.put("totalBytesToDownload", state.totalBytesToDownload())
        notifyListeners("downloadStateChanged", data)
    }

    override fun load() {
        appUpdateManager = AppUpdateManagerFactory.create(context)
    }

    private fun statusName(status: Int): String = when (status) {
        InstallStatus.PENDING -> "PENDING"
        InstallStatus.DOWNLOADING -> "DOWNLOADING"
        InstallStatus.DOWNLOADED -> "DOWNLOADED"
        InstallStatus.INSTALLING -> "INSTALLING"
        InstallStatus.INSTALLED -> "INSTALLED"
        InstallStatus.FAILED -> "FAILED"
        InstallStatus.CANCELED -> "CANCELED"
        else -> "UNKNOWN"
    }

    // Reads Play Store's locally-cached update info (no network call of our
    // own). Safe to call on every app foreground — also how a flexible
    // update that finished downloading in a previous session (downloadedPending)
    // gets surfaced again after the app was killed/restarted.
    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        if (!listenerRegistered) {
            appUpdateManager.registerListener(installStateListener)
            listenerRegistered = true
        }
        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { info ->
                val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                val result = JSObject()
                result.put("updateAvailable", available)
                result.put("availableVersionCode", info.availableVersionCode())
                result.put("priority", info.updatePriority())
                result.put("flexibleAllowed", available && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE))
                result.put("immediateAllowed", available && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
                result.put("downloadedPending", info.installStatus() == InstallStatus.DOWNLOADED)
                call.resolve(result)
            }
            .addOnFailureListener { e -> call.reject("Could not check for update: " + e.message, e) }
    }

    // Kicks off Play Store's own consent bottom sheet, then the download
    // runs in the background. This call resolves once the user responds to
    // that sheet (accepted/declined) — actual download progress and the
    // DOWNLOADED/FAILED terminal states arrive via downloadStateChanged.
    @PluginMethod
    fun startFlexibleUpdate(call: PluginCall) {
        val activity: Activity = activity ?: run {
            call.reject("No activity available")
            return
        }
        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { info ->
                val inProgress = info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE && !inProgress) {
                    call.reject("No update available")
                    return@addOnSuccessListener
                }
                if (!info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                    call.reject("Flexible update not allowed for this update")
                    return@addOnSuccessListener
                }
                try {
                    saveCall(call)
                    appUpdateManager.startUpdateFlowForResult(
                        info,
                        activity,
                        AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(),
                        REQUEST_CODE_FLEXIBLE_UPDATE
                    )
                } catch (e: Exception) {
                    call.reject("Could not start update flow: " + e.message, e)
                }
            }
            .addOnFailureListener { e -> call.reject("Could not start update flow: " + e.message, e) }
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CODE_FLEXIBLE_UPDATE) return
        val call = savedCall ?: return
        val result = JSObject()
        result.put("accepted", resultCode == Activity.RESULT_OK)
        call.resolve(result)
        freeSavedCall()
    }

    // Applies the update that finished downloading and restarts the app.
    // Must only be called from an explicit user tap (e.g. "Restart now") —
    // it kills and relaunches the process with no further confirmation.
    @PluginMethod
    fun completeFlexibleUpdate(call: PluginCall) {
        appUpdateManager.completeUpdate()
            .addOnSuccessListener { call.resolve() }
            .addOnFailureListener { e -> call.reject("Could not complete update: " + e.message, e) }
    }
}
