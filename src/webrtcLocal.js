// True-offline WebRTC transport: a manual RTCPeerConnection/RTCDataChannel
// pair negotiated entirely over a local signaling pipe (LocalSignaling native
// plugin, riding on a Wi-Fi Direct link) instead of PeerJS's cloud broker.
// Both devices are guaranteed to share a subnet (Wi-Fi Direct's autonomous
// group range, 192.168.49.0/24), so no STUN/TURN is needed — ICE only ever
// needs to find the direct host candidate on that link.
export const LOCAL_RTC_CONFIG = { iceServers: [] };

export function createLocalPeerConnection() {
  return new RTCPeerConnection(LOCAL_RTC_CONFIG);
}

// Offerer side: opens the data channel itself (the answerer receives it via
// 'ondatachannel'), then produces the SDP offer to send over the signaling pipe.
export async function createOfferAndChannel(pc, label = 'novashare') {
  const channel = pc.createDataChannel(label, { ordered: true });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return { channel, sdp: pc.localDescription.toJSON() };
}

// Answerer side: waits for the offerer's data channel to arrive, applies the
// remote offer, and produces the SDP answer to send back.
export function waitForRemoteChannel(pc) {
  return new Promise((resolve) => {
    pc.ondatachannel = (e) => resolve(e.channel);
  });
}

export async function createAnswerFromOffer(pc, offerSdp) {
  await pc.setRemoteDescription(offerSdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return pc.localDescription.toJSON();
}

export async function applyRemoteAnswer(pc, answerSdp) {
  await pc.setRemoteDescription(answerSdp);
}

export async function addRemoteIceCandidate(pc, candidateInit) {
  if (!candidateInit) return;
  try {
    await pc.addIceCandidate(candidateInit);
  } catch {
    // Late/duplicate candidates are harmless to drop.
  }
}

// Resolves once the RTCDataChannel is actually open, or rejects on timeout —
// used to bound how long a local (Wi-Fi Direct) connection attempt waits
// before the caller falls back to the PeerJS-cloud path.
export function waitForChannelOpen(channel, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (channel.readyState === 'open') {
      resolve(channel);
      return;
    }
    const timer = setTimeout(() => {
      channel.onopen = null;
      reject(new Error('Timed out waiting for local data channel to open'));
    }, timeoutMs);
    channel.onopen = () => {
      clearTimeout(timer);
      resolve(channel);
    };
  });
}

// One JSON control frame immediately followed by a binary frame is how a
// chunk crosses the wire — decodeMessage below pairs them back up.
const CHUNK_FOLLOWUP_MARKER = '__binaryFollows';

// Adapts a raw RTCDataChannel to look like the PeerJS DataConnection object
// the rest of the app already talks to (App.jsx's send/on/close calls and its
// `conn.dataChannel.bufferedAmount` backpressure check), so the existing
// chunking, resume, and security-code logic needs no changes to run over a
// fully offline Wi-Fi Direct link instead of the PeerJS cloud broker.
export class PeerJsCompatDataConnection {
  constructor(dataChannel, peerId) {
    this.dataChannel = dataChannel; // preserves conn.dataChannel.bufferedAmount access as-is
    this.peer = peerId; // mirrors PeerJS's conn.peer
    this._handlers = { data: [], open: [], close: [], error: [] };
    this._pendingMeta = null;
    // A caller only gets this wrapper once the channel is already confirmed
    // open (see waitForChannelOpen), which means the channel's own 'onopen'
    // has already fired before any .on('open', cb) can be registered — so
    // 'open' is tracked as state, not just an event, and replayed to late
    // subscribers instead of relying on event-timing to line up.
    this._isOpen = dataChannel.readyState === 'open';

    dataChannel.binaryType = 'arraybuffer';
    dataChannel.onopen = () => { this._isOpen = true; this._emit('open'); };
    dataChannel.onclose = () => this._emit('close');
    dataChannel.onerror = (e) => this._emit('error', e.error || new Error('Local data channel error'));
    dataChannel.onmessage = (e) => this._handleMessage(e.data);
  }

  on(event, cb) {
    (this._handlers[event] || (this._handlers[event] = [])).push(cb);
    if (event === 'open' && this._isOpen) cb();
  }

  // Mirrors PeerJS's conn.send(obj): plain objects go straight over as JSON;
  // a chunk message's ArrayBuffer can't ride inside JSON, so it's split into
  // a small JSON header naming the follow-up, then the binary payload itself.
  send(obj) {
    if (obj && obj.type === 'chunk' && obj.chunk instanceof ArrayBuffer) {
      const { chunk, ...meta } = obj;
      this.dataChannel.send(JSON.stringify({ [CHUNK_FOLLOWUP_MARKER]: true, ...meta }));
      this.dataChannel.send(chunk);
    } else {
      this.dataChannel.send(JSON.stringify(obj));
    }
  }

  close() {
    try { this.dataChannel.close(); } catch { /* already closed */ }
  }

  _handleMessage(raw) {
    if (raw instanceof ArrayBuffer) {
      if (!this._pendingMeta) return; // stray binary frame with no preceding header — drop
      const meta = this._pendingMeta;
      this._pendingMeta = null;
      this._emit('data', { ...meta, chunk: raw });
      return;
    }

    const obj = JSON.parse(raw);
    if (obj[CHUNK_FOLLOWUP_MARKER]) {
      const meta = { ...obj };
      delete meta[CHUNK_FOLLOWUP_MARKER];
      this._pendingMeta = meta;
      return;
    }
    this._emit('data', obj);
  }

  _emit(event, arg) {
    (this._handlers[event] || []).forEach((cb) => cb(arg));
  }
}
