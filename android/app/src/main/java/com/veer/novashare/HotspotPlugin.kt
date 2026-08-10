package com.veer.novashare

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Fallback link for when Wi-Fi Direct's WifiP2pManager connect fails (known
// flaky on several OEMs — MIUI, some Samsung builds — and on hardware with
// buggy WFD drivers). One phone opens a LocalOnlyHotspot — a private,
// app-scoped Wi-Fi AP the OS tears down automatically when the app dies or
// releases it, unlike a persistent user hotspot — and the other joins it
// programmatically via WifiNetworkSpecifier (Android 10+), with no trip to
// system Wi-Fi settings. SSID/passphrase travel to the joining side
// out-of-band (the existing QR code UI already used for room codes).
// Signaling then reuses LocalSignalingServerPlugin exactly as Wi-Fi Direct
// does — just pointed at the gateway IP this plugin resolves, since a
// LocalOnlyHotspot's gateway isn't a fixed documented address the way Wi-Fi
// Direct's group-owner 192.168.49.1 is.
//
// NOT verified on real hardware — implemented against documented Android
// APIs only. LocalOnlyHotspot/WifiNetworkSpecifier behavior (default
// security type, gateway addressing) is known to vary across OEM Wi-Fi
// stacks; treat this as needing real two-phone testing before trusting it.
@CapacitorPlugin(name = "Hotspot")
class HotspotPlugin : Plugin() {

    private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var boundNetwork: Network? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    // Same requirement as WifiDirectPlugin's lock: the WebRTC handshake
    // negotiated over this hotspot link relies on mDNS-resolved ICE
    // candidates, which Android silently drops without this held.
    private fun acquireMulticastLock() {
        releaseMulticastLock()
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
        try {
            val lock = wifiManager.createMulticastLock("novashare-hotspot-mdns")
            lock.setReferenceCounted(false)
            lock.acquire()
            multicastLock = lock
        } catch (e: Exception) { /* best-effort */ }
    }

    private fun releaseMulticastLock() {
        multicastLock?.let {
            try { if (it.isHeld) it.release() } catch (e: Exception) { /* already released */ }
        }
        multicastLock = null
    }

    @PluginMethod
    fun isSupported(call: PluginCall) {
        val result = JSObject()
        result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        call.resolve(result)
    }

    // Host side: opens a LocalOnlyHotspot and returns its credentials so the
    // caller can display/QR-encode them for the other device to scan.
    @PluginMethod
    @Suppress("DEPRECATION")
    fun startHotspot(call: PluginCall) {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        if (wifiManager == null) {
            call.reject("WifiManager unavailable")
            return
        }
        try {
            wifiManager.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
                    reservation = res
                    acquireMulticastLock()
                    val result = JSObject()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        val config = res.softApConfiguration
                        result.put("ssid", config.ssid ?: "")
                        result.put("passphrase", config.passphrase ?: "")
                    } else {
                        val config = res.wifiConfiguration
                        // WifiConfiguration.SSID is quote-wrapped ("MySSID") for a
                        // string-configured network, as LocalOnlyHotspot always sets
                        // it — strip the quotes so JS gets a plain SSID.
                        result.put("ssid", config?.SSID?.trim('"') ?: "")
                        result.put("passphrase", config?.preSharedKey?.trim('"') ?: "")
                    }
                    mainHandler.post { call.resolve(result) }
                }

                override fun onStopped() {
                    reservation = null
                    notifyListeners("hotspotStopped", JSObject())
                }

                override fun onFailed(reason: Int) {
                    reservation = null
                    mainHandler.post { call.reject("LocalOnlyHotspot failed to start: reason $reason") }
                }
            }, mainHandler)
        } catch (e: Exception) {
            call.reject("Failed to start hotspot: " + e.message, e)
        }
    }

    @PluginMethod
    fun stopHotspot(call: PluginCall) {
        reservation?.close()
        reservation = null
        releaseMulticastLock()
        call.resolve()
    }

    // Client side: joins the given SSID/passphrase and binds this process's
    // default network to it, so the LocalSignaling socket connect (and
    // everything else the app opens next) actually routes over the hotspot
    // instead of the phone's normal Wi-Fi/cellular default. Resolves with
    // the gateway IP to hand to LocalSignaling.connectToServer.
    @PluginMethod
    fun joinHotspot(call: PluginCall) {
        val ssid = call.getString("ssid")
        val passphrase = call.getString("passphrase")
        if (ssid == null || passphrase == null) {
            call.reject("ssid and passphrase are required")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Joining a hotspot programmatically requires Android 10+")
            return
        }

        val connectivityManager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        // LocalOnlyHotspot is WPA2-PSK by default on every currently-shipping
        // Android version this targets; if a future OEM build defaults to
        // WPA3-SAE instead, this would need setWpa3Passphrase/setIsEnhancedOpen
        // handling — flagged here rather than silently mismatching.
        val specifier = WifiNetworkSpecifier.Builder()
            .setSsid(ssid)
            .setWpa2Passphrase(passphrase)
            .build()

        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            // A LocalOnlyHotspot has no internet uplink — without dropping this
            // capability requirement the request would never resolve.
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .setNetworkSpecifier(specifier)
            .build()

        var settled = false
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (settled) return
                settled = true
                connectivityManager.bindProcessToNetwork(network)
                boundNetwork = network
                acquireMulticastLock()

                val gatewayIp = connectivityManager.getLinkProperties(network)
                    ?.routes
                    ?.firstOrNull { it.gateway != null }
                    ?.gateway
                    ?.hostAddress

                val result = JSObject()
                result.put("gatewayIp", gatewayIp ?: "")
                mainHandler.post { call.resolve(result) }
            }

            override fun onUnavailable() {
                if (settled) return
                settled = true
                mainHandler.post { call.reject("Could not join hotspot (unavailable)") }
            }

            override fun onLost(network: Network) {
                notifyListeners("hotspotLost", JSObject())
            }
        }
        networkCallback = callback

        try {
            connectivityManager.requestNetwork(request, callback, 20000)
        } catch (e: Exception) {
            call.reject("Failed to request hotspot network: " + e.message, e)
        }
    }

    @PluginMethod
    fun leaveHotspot(call: PluginCall) {
        unbindInternal()
        call.resolve()
    }

    private fun unbindInternal() {
        val connectivityManager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        networkCallback?.let {
            try { connectivityManager?.unregisterNetworkCallback(it) } catch (e: Exception) { /* already unregistered */ }
        }
        networkCallback = null
        if (boundNetwork != null) {
            connectivityManager?.bindProcessToNetwork(null)
            boundNetwork = null
        }
        releaseMulticastLock()
    }

    override fun handleOnDestroy() {
        reservation?.close()
        reservation = null
        releaseMulticastLock()
        unbindInternal()
        super.handleOnDestroy()
    }
}
