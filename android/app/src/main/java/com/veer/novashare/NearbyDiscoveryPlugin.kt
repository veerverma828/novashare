package com.veer.novashare

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.InetAddress

// Local-network "who else is running NovaShare right now" discovery, so a
// sender's open room can be found and joined without typing/scanning a code
// when both devices are on the same Wi-Fi. Two independent roles:
//   - Advertise: the sender publishes an NSD service whose TXT record carries
//     the live room code, updated whenever a new room opens.
//   - Discover: the receiver browses for that service type and resolves each
//     instance found, emitting a JS event per peer appear/disappear.
// Both roles are optional and web/desktop peers are unaffected — this is a
// convenience layer on top of the existing PeerJS code-based flow, never a
// replacement for it (browsing continues to work with typed/QR codes).
@CapacitorPlugin(name = "NearbyDiscovery")
class NearbyDiscoveryPlugin : Plugin() {

    companion object {
        private const val SERVICE_TYPE = "_novashare._tcp."
        private const val TXT_ROOM = "room"
        private const val TXT_NAME = "name"
        private const val TXT_DEVICE_ID = "did"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var nsdManager: NsdManager

    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    // serviceName -> last known {room, name} so resolve failures / duplicate
    // "found" callbacks (NSD is notorious for re-announcing) don't spam JS.
    private val knownPeers = mutableMapOf<String, JSObject>()

    override fun load() {
        nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    // ---------------------------------------------------------------
    // Advertise (sender side): publish this device + the live room code
    // ---------------------------------------------------------------
    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val roomCode = call.getString("roomCode") ?: ""
        val deviceName = call.getString("deviceName") ?: Build.MODEL ?: "NovaShare device"
        // Carried through to the discovering side so it can recognize (and
        // filter out) its own advertisement — see resolveService below.
        val deviceId = call.getString("deviceId")

        stopAdvertisingInternal()

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = "NovaShare-${if (roomCode.isNotBlank()) roomCode else (deviceId ?: "idle")}"
            serviceType = SERVICE_TYPE
            port = 7913 // Not actually dialed — PeerJS handles the real connection.
            setAttribute(TXT_ROOM, roomCode)
            setAttribute(TXT_NAME, deviceName)
            if (deviceId != null) setAttribute(TXT_DEVICE_ID, deviceId)
        }

        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) { /* no-op */ }
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) { /* no-op: advertising is best-effort */ }
            override fun onServiceUnregistered(info: NsdServiceInfo) { /* no-op */ }
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) { /* no-op */ }
        }
        registrationListener = listener

        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to start advertising: " + e.message, e)
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        stopAdvertisingInternal()
        call.resolve()
    }

    private fun stopAdvertisingInternal() {
        registrationListener?.let {
            try { nsdManager.unregisterService(it) } catch (e: Exception) { /* wasn't registered */ }
        }
        registrationListener = null
    }

    // ---------------------------------------------------------------
    // Discover (receiver side): browse for other NovaShare devices nearby
    // ---------------------------------------------------------------
    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        stopDiscoveryInternal()
        knownPeers.clear()

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) { /* no-op */ }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { /* no-op: leaves the UI with no nearby peers */ }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { /* no-op */ }
            override fun onDiscoveryStopped(serviceType: String) { /* no-op */ }

            override fun onServiceFound(info: NsdServiceInfo) {
                if (info.serviceType.trimEnd('.') != SERVICE_TYPE.trimEnd('.')) return
                resolveService(info)
            }

            override fun onServiceLost(info: NsdServiceInfo) {
                val cached = knownPeers.remove(info.serviceName) ?: return
                mainHandler.post {
                    val data = JSObject()
                    data.put("roomCode", cached.getString("roomCode"))
                    notifyListeners("peerLost", data)
                }
            }
        }
        discoveryListener = listener

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to start discovery: " + e.message, e)
        }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        stopDiscoveryInternal()
        call.resolve()
    }

    private fun stopDiscoveryInternal() {
        discoveryListener?.let {
            try { nsdManager.stopServiceDiscovery(it) } catch (e: Exception) { /* wasn't running */ }
        }
        discoveryListener = null
    }

    @Suppress("DEPRECATION")
    private fun resolveService(info: NsdServiceInfo) {
        nsdManager.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { /* transient — the next re-announce will retry */ }

            override fun onServiceResolved(resolved: NsdServiceInfo) {
                val attrs = resolved.attributes
                val roomCode = attrs[TXT_ROOM]?.let { String(it) } ?: ""
                val deviceName = attrs[TXT_NAME]?.let { String(it) } ?: "Nearby device"
                val deviceId = attrs[TXT_DEVICE_ID]?.let { String(it) }
                val host: InetAddress? = resolved.host

                val data = JSObject()
                data.put("roomCode", roomCode)
                data.put("deviceName", deviceName)
                if (deviceId != null) data.put("deviceId", deviceId)
                data.put("host", host?.hostAddress ?: "")
                knownPeers[resolved.serviceName] = data

                mainHandler.post { notifyListeners("peerFound", data) }
            }
        })
    }

    override fun handleOnDestroy() {
        stopAdvertisingInternal()
        stopDiscoveryInternal()
        super.handleOnDestroy()
    }
}
