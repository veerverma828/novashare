package com.veer.novashare

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger

// A dumb byte-pipe between two Wi-Fi-Direct-linked phones, used only to swap
// one WebRTC SDP offer/answer plus trickle ICE candidates so a fully offline
// RTCPeerConnection can be negotiated with no internet-reachable signaling
// broker. No protocol logic lives here — framing is a 4-byte big-endian
// length prefix + UTF-8 JSON, symmetric on both ends. The Wi-Fi Direct group
// owner calls startServer() and waits for the one inbound socket; the other
// side calls connectToServer() with the group owner's local IP.
@CapacitorPlugin(name = "LocalSignaling")
class LocalSignalingServerPlugin : Plugin() {

    companion object {
        const val PORT = 8916
    }

    private var serverSocket: ServerSocket? = null
    private val connections = mutableMapOf<Int, Socket>()
    private val nextConnectionId = AtomicInteger(1)

    @PluginMethod
    fun startServer(call: PluginCall) {
        stopServerInternal()
        try {
            val server = ServerSocket()
            server.reuseAddress = true
            server.bind(InetSocketAddress(PORT))
            serverSocket = server

            Thread {
                try {
                    while (true) {
                        val socket = server.accept()
                        val id = nextConnectionId.getAndIncrement()
                        connections[id] = socket
                        val data = JSObject()
                        data.put("connectionId", id)
                        notifyListeners("peerConnected", data)
                        listenOnSocket(id, socket)
                    }
                } catch (e: Exception) {
                    // Server socket closed (stopServer()/handleOnDestroy) — normal shutdown path.
                }
            }.start()

            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to start local signaling server: " + e.message, e)
        }
    }

    @PluginMethod
    fun connectToServer(call: PluginCall) {
        val ip = call.getString("ip")
        if (ip == null) {
            call.reject("ip is required")
            return
        }
        val port = call.getInt("port") ?: PORT

        Thread {
            try {
                val socket = Socket()
                socket.connect(InetSocketAddress(ip, port), 8000)
                val id = nextConnectionId.getAndIncrement()
                connections[id] = socket

                val data = JSObject()
                data.put("connectionId", id)
                call.resolve(data)

                val connectedData = JSObject()
                connectedData.put("connectionId", id)
                notifyListeners("peerConnected", connectedData)

                listenOnSocket(id, socket)
            } catch (e: Exception) {
                call.reject("Failed to connect to signaling server: " + e.message, e)
            }
        }.start()
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val connectionId = call.getInt("connectionId")
        val json = call.getString("json")
        if (connectionId == null || json == null) {
            call.reject("connectionId and json are required")
            return
        }
        val socket = connections[connectionId]
        if (socket == null || socket.isClosed) {
            call.reject("No open connection with id $connectionId")
            return
        }

        try {
            val bytes = json.toByteArray(StandardCharsets.UTF_8)
            val out = DataOutputStream(socket.getOutputStream())
            synchronized(out) {
                out.writeInt(bytes.size)
                out.write(bytes)
                out.flush()
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to send signaling message: " + e.message, e)
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val connectionId = call.getInt("connectionId")
        if (connectionId != null) {
            closeConnection(connectionId)
        }
        call.resolve()
    }

    @PluginMethod
    fun stopServer(call: PluginCall) {
        stopServerInternal()
        call.resolve()
    }

    private fun listenOnSocket(connectionId: Int, socket: Socket) {
        Thread {
            try {
                val input = DataInputStream(socket.getInputStream())
                while (true) {
                    val length = input.readInt()
                    if (length < 0 || length > 16 * 1024 * 1024) break // sanity bound, no valid signaling frame is this large
                    val buf = ByteArray(length)
                    input.readFully(buf)
                    val json = String(buf, StandardCharsets.UTF_8)

                    val data = JSObject()
                    data.put("connectionId", connectionId)
                    data.put("json", json)
                    notifyListeners("message", data)
                }
            } catch (e: Exception) {
                // Socket closed/reset — falls through to the disconnect notification below.
            } finally {
                closeConnection(connectionId)
            }
        }.start()
    }

    private fun closeConnection(connectionId: Int) {
        val socket = connections.remove(connectionId) ?: return
        try { socket.close() } catch (e: Exception) { /* already closed */ }
        val data = JSObject()
        data.put("connectionId", connectionId)
        notifyListeners("peerDisconnected", data)
    }

    private fun stopServerInternal() {
        serverSocket?.let {
            try { it.close() } catch (e: Exception) { /* already closed */ }
        }
        serverSocket = null
        connections.keys.toList().forEach { closeConnection(it) }
    }

    override fun handleOnDestroy() {
        stopServerInternal()
        super.handleOnDestroy()
    }
}
