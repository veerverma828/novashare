// One JSON control frame immediately followed by a binary frame is how a
// chunk crosses the wire — decodeMessage below pairs them back up.
const CHUNK_FOLLOWUP_MARKER = '__binaryFollows';

// Adapts an RTCDataChannel-shaped transport (readyState, binaryType,
// onopen/onmessage/onclose/onerror, send(), bufferedAmount) to look like the
// PeerJS DataConnection object the rest of the app already talks to (App.jsx's
// send/on/close calls and its `conn.dataChannel.bufferedAmount` backpressure
// check), so the existing chunking, resume, and security-code logic needs no
// changes to run over a fully offline local link instead of the PeerJS cloud
// broker. Originally backed by a real RTCDataChannel negotiated over
// Wi-Fi Direct; now backed by localSocketTransport.js's LocalSocketChannel
// (a plain TCP socket, matching the same interface) — this class doesn't
// care which, as long as the shape matches.
export class PeerJsCompatDataConnection {
  constructor(dataChannel, peerId) {
    this.dataChannel = dataChannel; // preserves conn.dataChannel.bufferedAmount access as-is
    this.peer = peerId; // mirrors PeerJS's conn.peer
    this.isLocalSocket = !!dataChannel.isLocalSocket;
    this._handlers = { data: [], open: [], close: [], error: [] };
    this._pendingMeta = null;
    // A caller only gets this wrapper once the channel is already confirmed
    // open (see waitForChannelOpen), which means the channel's own 'onopen'
    // has already fired before any .on('open', cb) can be registered — so
    // 'open' is tracked as state, not just an event, and replayed to late
    // subscribers instead of relying on event-timing to line up.
    this._isOpen = dataChannel.readyState === 'open';
    // Some WebViews flip readyState to 'open' a tick before actually
    // dispatching the 'open' event — so even though _isOpen is already true
    // here, dataChannel.onopen below can still fire once for real shortly
    // after construction. Without this flag that fires 'open' to every
    // subscriber a second time (this app resends the whole batch on each
    // 'open', so a receiver gets the file twice) — this makes that redundant
    // real event a no-op since the state was already caught above.
    const openAlreadyObservedAtConstruction = this._isOpen;

    dataChannel.binaryType = 'arraybuffer';
    dataChannel.onopen = () => {
      if (openAlreadyObservedAtConstruction) return;
      this._isOpen = true;
      this._emit('open');
    };
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
