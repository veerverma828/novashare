package com.veer.novashare

import android.util.Base64
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

// A dumb byte-pipe between two locally-linked phones (Wi-Fi Direct or
// hotspot-fallback group). Originally used only to swap a WebRTC SDP
// offer/answer, it now carries the whole file transfer directly — no
// RTCPeerConnection/ICE negotiation needed on a link the two devices are
// already directly connected on, which is also what production sharing apps
// (Xender, SHAREit, Nearby Share) do: plain local socket, no WebRTC, since
// there's no NAT to traverse and no reason to pay SCTP/DTLS overhead once a
// direct link already exists. WebRTC stays reserved for the internet/cloud
// path (PeerJS in App.jsx) where NAT traversal is the actual problem.
//
// Framing: [1-byte type][4-byte big-endian length][payload], symmetric on
// both ends. Type 0 = UTF-8 JSON text frame (control messages + the
// small-file/text-snippet fast path). Type 1 = raw binary frame (file chunk
// bytes, base64-encoded crossing the JS bridge since Capacitor plugin calls
// are JSON). The Wi-Fi Direct group owner calls startServer() and waits for
// the one inbound socket; the other side calls connectToServer() with the
// group owner's local IP.
@CapacitorPlugin(name = "LocalSignaling")
class LocalSignalingServerPlugin : Plugin() {

    companion object {
        const val PORT = 8916
        const val CONNECT_BUDGET_MS = 25000L
        const val CONNECT_ATTEMPT_TIMEOUT_MS = 1000
        const val RETRY_DELAY_MS = 300L
        const val FRAME_TYPE_JSON: Int = 0
        const val FRAME_TYPE_BINARY: Int = 1
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
            // The group owner's ServerSocket may not be bound yet when we get here —
            // both sides kick off right after the Wi-Fi Direct group forms, with no
            // ordering guarantee. A bare connect() can hit ECONNREFUSED instantly
            // instead of blocking, so retry with backoff until CONNECT_BUDGET_MS runs out.
            val deadline = System.currentTimeMillis() + CONNECT_BUDGET_MS
            var lastError: Exception? = null
            var socket: Socket? = null

            while (System.currentTimeMillis() < deadline) {
                try {
                    val s = Socket()
                    s.connect(InetSocketAddress(ip, port), CONNECT_ATTEMPT_TIMEOUT_MS)
                    socket = s
                    break
                } catch (e: Exception) {
                    lastError = e
                    Thread.sleep(RETRY_DELAY_MS)
                }
            }

            if (socket == null) {
                call.reject("Failed to connect to signaling server: " + lastError?.message, lastError)
                return@Thread
            }

            try {
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
        writeFrame(connectionId, FRAME_TYPE_JSON, json.toByteArray(StandardCharsets.UTF_8), call)
    }

    // File chunk bytes — same socket/connection as send(), just tagged with
    // the binary frame type. base64 in (JS bridge calls are JSON) — see
    // arrayBufferToBase64 on the JS side, which already exists for this
    // exact chunk-sized-payload reason (NotifyDownloadPlugin's appendChunk
    // uses the same pattern for the receive side).
    @PluginMethod
    fun sendBinary(call: PluginCall) {
        val connectionId = call.getInt("connectionId")
        val base64 = call.getString("data")
        if (connectionId == null || base64 == null) {
            call.reject("connectionId and data are required")
            return
        }
        val bytes = try {
            Base64.decode(base64, Base64.NO_WRAP)
        } catch (e: Exception) {
            call.reject("Invalid base64 data: " + e.message, e)
            return
        }
        writeFrame(connectionId, FRAME_TYPE_BINARY, bytes, call)
    }

    private fun writeFrame(connectionId: Int, type: Int, payload: ByteArray, call: PluginCall) {
        val socket = connections[connectionId]
        if (socket == null || socket.isClosed) {
            call.reject("No open connection with id $connectionId")
            return
        }
        try {
            val out = DataOutputStream(socket.getOutputStream())
            synchronized(out) {
                out.writeByte(type)
                out.writeInt(payload.size)
                out.write(payload)
                out.flush()
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to send: " + e.message, e)
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
                    val type = input.readUnsignedByte()
                    val length = input.readInt()
                    if (length < 0 || length > 16 * 1024 * 1024) break // sanity bound, no valid frame is this large
                    val buf = ByteArray(length)
                    input.readFully(buf)

                    if (type == FRAME_TYPE_BINARY) {
                        val data = JSObject()
                        data.put("connectionId", connectionId)
                        data.put("data", Base64.encodeToString(buf, Base64.NO_WRAP))
                        notifyListeners("binaryMessage", data)
                    } else {
                        val json = String(buf, StandardCharsets.UTF_8)
                        val data = JSObject()
                        data.put("connectionId", connectionId)
                        data.put("json", json)
                        notifyListeners("message", data)
                    }
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
