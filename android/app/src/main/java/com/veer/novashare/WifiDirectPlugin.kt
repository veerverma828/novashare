package com.veer.novashare

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pDeviceList
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// Fully offline device-to-device transport: two phones can pair and exchange
// data with zero router, zero shared Wi-Fi network, and zero internet — one
// side becomes the Wi-Fi Direct "group owner" (fixed IP 192.168.49.1) and the
// other joins directly. This plugin only handles discovery + group formation;
// the actual WebRTC signaling handshake that rides on top of the resulting
// local link lives in LocalSignalingServerPlugin.
@CapacitorPlugin(
    name = "WifiDirect",
    permissions = [
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.NEARBY_WIFI_DEVICES], alias = "nearbyWifi")
    ]
)
class WifiDirectPlugin : Plugin() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var manager: WifiP2pManager? = null
    private var channel: WifiP2pManager.Channel? = null
    private var receiver: BroadcastReceiver? = null
    private var intentFilter: IntentFilter? = null

    override fun load() {
        manager = context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
    }

    @PluginMethod
    fun isSupported(call: PluginCall) {
        val supported = context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT) && manager != null
        val result = JSObject()
        result.put("supported", supported)
        call.resolve(result)
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        if (needsDiscoveryPermission()) {
            requestDiscoveryPermission(call)
            return
        }
        doInitialize(call)
    }

    @PermissionCallback
    private fun discoveryPermCallback(call: PluginCall) {
        if (needsDiscoveryPermission()) {
            call.reject("Location/Nearby Wi-Fi Devices permission is required for Wi-Fi Direct discovery")
            return
        }
        doInitialize(call)
    }

    private fun requestDiscoveryPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAlias("nearbyWifi", call, "discoveryPermCallback")
        } else {
            requestPermissionForAlias("location", call, "discoveryPermCallback")
        }
    }

    private fun needsDiscoveryPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            !hasSpecificPermission(Manifest.permission.NEARBY_WIFI_DEVICES)
        } else {
            !hasSpecificPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    private fun doInitialize(call: PluginCall) {
        val mgr = manager
        if (mgr == null) {
            call.reject("Wi-Fi Direct is not supported on this device")
            return
        }

        unregisterReceiverInternal()

        channel = mgr.initialize(context, context.mainLooper, null)

        val filter = IntentFilter().apply {
            addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
        }
        intentFilter = filter

        val br = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.action) {
                    WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                        val state = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1)
                        val enabled = state == WifiP2pManager.WIFI_P2P_STATE_ENABLED
                        val data = JSObject()
                        data.put("enabled", enabled)
                        notifyListeners("stateChanged", data)
                    }
                    WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> requestPeersInternal()
                    WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> requestConnectionInfoInternal()
                    WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION -> {
                        val device: WifiP2pDevice? = intent.getParcelableExtra(WifiP2pManager.EXTRA_WIFI_P2P_DEVICE)
                        val data = JSObject()
                        data.put("deviceName", device?.deviceName ?: "")
                        notifyListeners("selfChanged", data)
                    }
                }
            }
        }
        receiver = br
        // targetSdk 36 requires an explicit exported flag for any dynamically
        // registered receiver, or this throws SecurityException at runtime.
        // These are system broadcasts we only ever listen to, never re-emit,
        // so RECEIVER_NOT_EXPORTED is correct (no other app should trigger them).
        ContextCompat.registerReceiver(context, br, filter, ContextCompat.RECEIVER_NOT_EXPORTED)

        call.resolve()
    }

    @PluginMethod
    fun discoverPeers(call: PluginCall) {
        val mgr = manager
        val ch = channel
        if (mgr == null || ch == null) {
            call.reject("Call initialize() first")
            return
        }
        if (needsDiscoveryPermission()) {
            call.reject("Missing discovery permission")
            return
        }
        try {
            mgr.discoverPeers(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { mainHandler.post { call.resolve() } }
                override fun onFailure(reason: Int) { mainHandler.post { call.reject("discoverPeers failed: $reason") } }
            })
        } catch (e: SecurityException) {
            call.reject("Missing permission for discoverPeers: " + e.message, e)
        }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        val mgr = manager
        val ch = channel
        if (mgr == null || ch == null) {
            call.resolve()
            return
        }
        mgr.stopPeerDiscovery(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { mainHandler.post { call.resolve() } }
            override fun onFailure(reason: Int) { mainHandler.post { call.resolve() } }
        })
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val deviceAddress = call.getString("deviceAddress")
        if (deviceAddress == null) {
            call.reject("deviceAddress is required")
            return
        }
        val mgr = manager
        val ch = channel
        if (mgr == null || ch == null) {
            call.reject("Call initialize() first")
            return
        }

        val config = WifiP2pConfig().apply {
            this.deviceAddress = deviceAddress
            wps.setup = android.net.wifi.WpsInfo.PBC
        }

        try {
            mgr.connect(ch, config, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { mainHandler.post { call.resolve() } }
                override fun onFailure(reason: Int) { mainHandler.post { call.reject("connect failed: $reason") } }
            })
        } catch (e: SecurityException) {
            call.reject("Missing permission for connect: " + e.message, e)
        }
    }

    @PluginMethod
    fun cancelConnect(call: PluginCall) {
        val mgr = manager
        val ch = channel
        if (mgr == null || ch == null) {
            call.resolve()
            return
        }
        mgr.cancelConnect(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { mainHandler.post { call.resolve() } }
            override fun onFailure(reason: Int) { mainHandler.post { call.resolve() } }
        })
    }

    @PluginMethod
    fun requestGroupInfo(call: PluginCall) {
        val mgr = manager
        val ch = channel
        if (mgr == null || ch == null) {
            call.reject("Call initialize() first")
            return
        }
        mgr.requestConnectionInfo(ch) { info: WifiP2pInfo ->
            val data = JSObject()
            data.put("groupFormed", info.groupFormed)
            data.put("isGroupOwner", info.isGroupOwner)
            data.put("groupOwnerAddress", info.groupOwnerAddress?.hostAddress ?: "")
            call.resolve(data)
        }
    }

    @PluginMethod
    fun removeGroup(call: PluginCall) {
        val mgr = manager
        val ch = channel
        if (mgr == null || ch == null) {
            call.resolve()
            return
        }
        mgr.removeGroup(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { mainHandler.post { call.resolve() } }
            override fun onFailure(reason: Int) { mainHandler.post { call.resolve() } }
        })
    }

    private fun requestPeersInternal() {
        val mgr = manager ?: return
        val ch = channel ?: return
        try {
            mgr.requestPeers(ch) { peerList: WifiP2pDeviceList ->
                val peers = JSArray()
                for (device in peerList.deviceList) {
                    val p = JSObject()
                    p.put("deviceName", device.deviceName)
                    p.put("deviceAddress", device.deviceAddress)
                    p.put("status", device.status)
                    peers.put(p)
                }
                val data = JSObject()
                data.put("peers", peers)
                notifyListeners("peersChanged", data)
            }
        } catch (e: SecurityException) {
            // Missing permission — nothing to report until it's granted.
        }
    }

    private fun requestConnectionInfoInternal() {
        val mgr = manager ?: return
        val ch = channel ?: return
        mgr.requestConnectionInfo(ch) { info: WifiP2pInfo ->
            val data = JSObject()
            data.put("groupFormed", info.groupFormed)
            data.put("isGroupOwner", info.isGroupOwner)
            data.put("groupOwnerAddress", info.groupOwnerAddress?.hostAddress ?: "")
            notifyListeners("connectionChanged", data)
        }
    }

    private fun hasSpecificPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun unregisterReceiverInternal() {
        receiver?.let {
            try { context.unregisterReceiver(it) } catch (e: Exception) { /* wasn't registered */ }
        }
        receiver = null
    }

    override fun handleOnDestroy() {
        unregisterReceiverInternal()
        val mgr = manager
        val ch = channel
        if (mgr != null && ch != null) {
            try { mgr.removeGroup(ch, null) } catch (e: Exception) { /* best-effort cleanup */ }
        }
        super.handleOnDestroy()
    }
}
