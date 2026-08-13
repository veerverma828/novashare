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
import java.util.concurrent.ConcurrentHashMap
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

    // One socket plus the single output stream every frame for it is written
    // through. Building a DataOutputStream per write instead would make the
    // `synchronized` below guard a freshly-allocated object on each call —
    // i.e. no mutual exclusion — letting two concurrent writeFrame calls
    // interleave their [type][length][payload] bytes into one corrupt frame.
    // Concurrent writes are the normal case here, not an edge case: a chunk
    // goes out as a JSON header frame immediately followed by its binary
    // frame, both dispatched without awaiting (PeerJsCompatDataConnection.send).
    private class Conn(val socket: Socket) {
        val out: DataOutputStream = DataOutputStream(socket.getOutputStream())
        val writeLock = Any()
    }

    private var serverSocket: ServerSocket? = null
    private val connections = ConcurrentHashMap<Int, Conn>()
    private val nextConnectionId = AtomicInteger(1)

    @PluginMethod
    fun startServer(call: PluginCall) {
        stopAcceptingInternal()
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
                        // Opening the output stream can throw if the peer went
                        // away between accept() and here — drop that one socket
                        // rather than letting it break out of the accept loop
                        // and silently stop the room taking new receivers.
                        val conn = try {
                            Conn(socket)
                        } catch (e: Exception) {
                            try { socket.close() } catch (ignored: Exception) { /* already closed */ }
                            continue
                        }
                        connections[id] = conn
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
                connections[id] = Conn(socket)

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
        val conn = connections[connectionId]
        if (conn == null || conn.socket.isClosed) {
            call.reject("No open connection with id $connectionId")
            return
        }
        try {
            // Whole frame under one lock, on an object shared by every write to
            // this connection — a partial frame from an interleaved write would
            // desync the reader's [type][length][payload] parse for good.
            synchronized(conn.writeLock) {
                conn.out.writeByte(type)
                conn.out.writeInt(payload.size)
                conn.out.write(payload)
                conn.out.flush()
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
        stopAcceptingInternal()
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
        val conn = connections.remove(connectionId) ?: return
        try { conn.socket.close() } catch (e: Exception) { /* already closed */ }
        val data = JSObject()
        data.put("connectionId", connectionId)
        notifyListeners("peerDisconnected", data)
    }

    // Stops accepting NEW connections; established sockets deliberately survive.
    // Tearing them down here made restarting the room host lethal to a transfer
    // already in flight — the sender's next frame would fail with "No open
    // connection with id N" and the receiver would sit at 0% forever. Closing a
    // single connection is already explicit (close()/LocalSocketChannel.close()),
    // so this has no reason to take the rest of them with it.
    private fun stopAcceptingInternal() {
        serverSocket?.let {
            try { it.close() } catch (e: Exception) { /* already closed */ }
        }
        serverSocket = null
    }

    private fun closeAllConnections() {
        connections.keys.toList().forEach { closeConnection(it) }
    }

    override fun handleOnDestroy() {
        stopAcceptingInternal()
        closeAllConnections()
        super.handleOnDestroy()
    }
}
