// True-offline file transport over a direct local link (Wi-Fi Direct group
// or hotspot-fallback network): a plain TCP socket via the LocalSignaling
// native plugin, carrying the whole transfer directly — no WebRTC/ICE/SDP
// negotiation involved. This mirrors what production sharing apps do (Xender,
// SHAREit, Nearby Share all run a local socket/HTTP server, not WebRTC, once
// two devices already share a direct link) — WebRTC's SCTP/DTLS stack exists
// to solve NAT traversal across the internet, which isn't a problem here, so
// paying for it just adds overhead and, worse, requires ICE candidates that
// depend on mDNS resolution working over the Wi-Fi Direct interface (flaky on
// several OEMs). The cloud/PeerJS path (App.jsx) keeps WebRTC — that one
// genuinely needs NAT traversal.
import {
  localSignalingStartServer,
  localSignalingStopServer,
  localSignalingConnect,
  localSignalingSend,
  localSignalingSendRaw,
  localSignalingSendBinary,
  localSignalingClose,
  onLocalSignalingMessage,
  onLocalSignalingBinaryMessage,
  onLocalSignalingPeerDisconnected
} from './native';
import { PeerJsCompatDataConnection } from './webrtcLocal';

export const LOCAL_SIGNALING_PORT = 8916;

// Internal handshake message types, exchanged once right after the raw
// socket connects and before any app-level protocol traffic — carries the
// room code / device name that used to ride inside the WebRTC SDP offer.
const HELLO = 'novashare-local-hello';
const HELLO_ACK = 'novashare-local-hello-ack';

// Adapts a connected LocalSignaling socket to look like an RTCDataChannel
// (readyState, binaryType, onopen/onmessage/onclose/onerror, send(),
// bufferedAmount) so PeerJsCompatDataConnection — already written against
// that exact interface for the previous WebRTC-backed local path — can wrap
// it completely unchanged.
class LocalSocketChannel {
  constructor(connectionId) {
    this.connectionId = connectionId;
    // The TCP socket is already connected by the time this is constructed
    // (see establishLocalSocketConnection/startLocalSocketRoomHost below) —
    // there's no separate "open" event to wait for the way an RTCDataChannel
    // has one.
    this.readyState = 'open';
    this.binaryType = 'arraybuffer';
    this.isLocalSocket = true;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._bufferedAmount = 0;

    this._offMessage = onLocalSignalingMessage((connId, msg) => {
      if (connId !== connectionId) return;
      this.onmessage?.({ data: JSON.stringify(msg) });
    });
    this._offBinary = onLocalSignalingBinaryMessage((connId, buf) => {
      if (connId !== connectionId) return;
      this.onmessage?.({ data: buf });
    });
    this._offDisconnected = onLocalSignalingPeerDisconnected((connId) => {
      if (connId !== connectionId || this.readyState === 'closed') return;
      this.readyState = 'closed';
      this.onclose?.();
    });
  }

  get bufferedAmount() {
    return this._bufferedAmount;
  }

  // Mirrors RTCDataChannel.send()'s contract: a string (already-JSON'd by
  // PeerJsCompatDataConnection) or an ArrayBuffer (chunk bytes) — never both
  // in one call, so no framing negotiation needed here beyond what the
  // native plugin's frame type byte already does.
  send(data) {
    if (data instanceof ArrayBuffer) {
      this._bufferedAmount += data.byteLength;
      localSignalingSendBinary(this.connectionId, data)
        .catch((err) => this.onerror?.({ error: err }))
        .finally(() => { this._bufferedAmount -= data.byteLength; });
    } else {
      const size = data.length;
      this._bufferedAmount += size;
      localSignalingSendRaw(this.connectionId, data)
        .catch((err) => this.onerror?.({ error: err }))
        .finally(() => { this._bufferedAmount -= size; });
    }
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this._offMessage();
    this._offBinary();
    this._offDisconnected();
    localSignalingClose(this.connectionId);
  }
}

// One-shot local connection: used for Wi-Fi Direct connect-out and hotspot
// fallback (both sides know up front they're negotiating exactly one link).
// isGroupOwner starts the socket server and waits for the inbound
// connection + hello; the other side dials in and sends the hello itself.
export async function establishLocalSocketConnection({ isGroupOwner, groupOwnerAddress, roomCode, deviceName }, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let offMessage = () => {};

    const timer = setTimeout(() => {
      fail(new Error('Timed out negotiating a local Wi-Fi Direct connection'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      offMessage();
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (isGroupOwner) localSignalingStopServer();
      reject(err);
    };

    const finish = (connectionId, resolvedRoomCode, resolvedDeviceName) => {
      if (settled) return;
      settled = true;
      cleanup();
      const channel = new LocalSocketChannel(connectionId);
      const peerId = groupOwnerAddress || 'wifi-direct-peer';
      resolve({ conn: new PeerJsCompatDataConnection(channel, peerId), roomCode: resolvedRoomCode, deviceName: resolvedDeviceName });
    };

    if (isGroupOwner) {
      offMessage = onLocalSignalingMessage((connId, msg) => {
        if (msg.type !== HELLO) return;
        localSignalingSend(connId, { type: HELLO_ACK, roomCode });
        finish(connId, msg.roomCode || roomCode, msg.deviceName || deviceName);
      });
      localSignalingStartServer().catch(fail);
    } else {
      (async () => {
        try {
          const connId = await localSignalingConnect(groupOwnerAddress, LOCAL_SIGNALING_PORT);
          offMessage = onLocalSignalingMessage((incomingConnId, msg) => {
            if (incomingConnId !== connId || msg.type !== HELLO_ACK) return;
            finish(connId, msg.roomCode || roomCode, deviceName);
          });
          await localSignalingSend(connId, { type: HELLO, roomCode, deviceName });
        } catch (err) {
          fail(err);
        }
      })();
    }
  });
}

// Persistent local host: used for the same-Wi-Fi "Nearby" list (NSD
// discovery), where the room stays open and multiple receivers may connect
// over its lifetime — same role split as the cloud PeerJS 'connection' event.
// onConnection(conn, roomCode) is called once per receiver that completes
// the hello handshake.
export function startLocalSocketRoomHost(code, onConnection) {
  const offMessage = onLocalSignalingMessage((connId, msg) => {
    if (msg.type !== HELLO) return;
    localSignalingSend(connId, { type: HELLO_ACK, roomCode: code });
    const channel = new LocalSocketChannel(connId);
    onConnection(new PeerJsCompatDataConnection(channel, `lan-${connId}`), code);
  });

  localSignalingStartServer().catch(() => {
    // No native LocalSignaling support (web/desktop) — receivers on this
    // list transparently fall back to the cloud path.
  });

  return () => {
    offMessage();
    localSignalingStopServer();
  };
}
