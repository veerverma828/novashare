import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the native LocalSignaling plugin's event bus, so
// establishLocalSocketConnection/startLocalSocketRoomHost/LocalSocketChannel
// can be exercised without a real Android device — mirrors the FakePeer-style
// harness used elsewhere in this codebase (App.sender.test.jsx etc.).
const state = vi.hoisted(() => ({
  messageListeners: [],
  binaryListeners: [],
  disconnectListeners: [],
  nextConnId: 1,
  sent: [], // { connectionId, message }
  sentRaw: [], // { connectionId, json }
  sentBinary: [], // { connectionId, data }
  startServer: vi.fn(() => Promise.resolve()),
  stopServer: vi.fn(),
  connect: vi.fn(() => Promise.resolve(state.nextConnId++)),
  close: vi.fn()
}));

function emitMessage(connectionId, msg) {
  state.messageListeners.forEach((cb) => cb(connectionId, msg));
}
function emitBinary(connectionId, buf) {
  state.binaryListeners.forEach((cb) => cb(connectionId, buf));
}
function emitDisconnected(connectionId) {
  state.disconnectListeners.forEach((cb) => cb(connectionId));
}

vi.mock('./native', () => ({
  localSignalingStartServer: (...args) => state.startServer(...args),
  localSignalingStopServer: (...args) => state.stopServer(...args),
  localSignalingConnect: (...args) => state.connect(...args),
  localSignalingSend: (connectionId, message) => {
    state.sent.push({ connectionId, message });
    return Promise.resolve();
  },
  localSignalingSendRaw: (connectionId, json) => {
    state.sentRaw.push({ connectionId, json });
    return Promise.resolve();
  },
  localSignalingSendBinary: (connectionId, data) => {
    state.sentBinary.push({ connectionId, data });
    return Promise.resolve();
  },
  localSignalingClose: (...args) => state.close(...args),
  onLocalSignalingMessage: (cb) => {
    state.messageListeners.push(cb);
    return () => { state.messageListeners = state.messageListeners.filter((l) => l !== cb); };
  },
  onLocalSignalingBinaryMessage: (cb) => {
    state.binaryListeners.push(cb);
    return () => { state.binaryListeners = state.binaryListeners.filter((l) => l !== cb); };
  },
  onLocalSignalingPeerDisconnected: (cb) => {
    state.disconnectListeners.push(cb);
    return () => { state.disconnectListeners = state.disconnectListeners.filter((l) => l !== cb); };
  }
}));

const { establishLocalSocketConnection, startLocalSocketRoomHost } = await import('./localSocketTransport');

beforeEach(() => {
  state.messageListeners = [];
  state.binaryListeners = [];
  state.disconnectListeners = [];
  state.nextConnId = 1;
  state.sent = [];
  state.sentRaw = [];
  state.sentBinary = [];
  state.startServer.mockClear();
  state.stopServer.mockClear();
  state.connect.mockClear();
  state.close.mockClear();
});

describe('establishLocalSocketConnection (group owner)', () => {
  it('starts the server, answers a hello with hello-ack, and resolves with the offerer\'s room code/device name', async () => {
    const promise = establishLocalSocketConnection({ isGroupOwner: true, groupOwnerAddress: null, roomCode: 'AAAA', deviceName: 'Owner Phone' });
    await Promise.resolve();
    await Promise.resolve();

    expect(state.startServer).toHaveBeenCalledTimes(1);

    emitMessage(7, { type: 'novashare-local-hello', roomCode: 'BBBB', deviceName: 'Client Phone' });

    const { conn, roomCode, deviceName } = await promise;
    expect(roomCode).toBe('BBBB');
    expect(deviceName).toBe('Client Phone');
    expect(conn.peer).toBe('wifi-direct-peer');
    expect(state.sent).toContainEqual({ connectionId: 7, message: { type: 'novashare-local-hello-ack', roomCode: 'AAAA' } });
  });

  it('rejects with a clear timeout error if no hello ever arrives', async () => {
    const promise = establishLocalSocketConnection({ isGroupOwner: true, groupOwnerAddress: null, roomCode: 'AAAA', deviceName: 'Owner' }, 5);
    await expect(promise).rejects.toThrow('Timed out negotiating a local Wi-Fi Direct connection');
    expect(state.stopServer).toHaveBeenCalled();
  });
});

describe('establishLocalSocketConnection (client)', () => {
  it('connects, sends a hello, and resolves once hello-ack arrives', async () => {
    const promise = establishLocalSocketConnection({ isGroupOwner: false, groupOwnerAddress: '192.168.49.1', roomCode: 'AAAA', deviceName: 'Client Phone' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.connect).toHaveBeenCalledWith('192.168.49.1', 8916);
    expect(state.sent).toContainEqual({ connectionId: 1, message: { type: 'novashare-local-hello', roomCode: 'AAAA', deviceName: 'Client Phone' } });

    emitMessage(1, { type: 'novashare-local-hello-ack', roomCode: 'AAAA' });

    const { conn, roomCode } = await promise;
    expect(roomCode).toBe('AAAA');
    expect(conn.peer).toBe('192.168.49.1');
  });

  it('ignores a hello-ack meant for a different connection id', async () => {
    const promise = establishLocalSocketConnection({ isGroupOwner: false, groupOwnerAddress: '192.168.49.1', roomCode: 'AAAA', deviceName: 'Client' }, 20);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    emitMessage(999, { type: 'novashare-local-hello-ack', roomCode: 'ZZZZ' });
    await expect(promise).rejects.toThrow('Timed out negotiating a local Wi-Fi Direct connection');
  });
});

describe('LocalSocketChannel (via the resolved connection)', () => {
  async function connectAsOwner() {
    const promise = establishLocalSocketConnection({ isGroupOwner: true, groupOwnerAddress: null, roomCode: 'AAAA', deviceName: 'Owner' });
    await Promise.resolve();
    await Promise.resolve();
    emitMessage(3, { type: 'novashare-local-hello', roomCode: 'BBBB', deviceName: 'Client' });
    return promise;
  }

  it('sends plain objects as a raw JSON frame and ArrayBuffer chunks as binary frames', async () => {
    const { conn } = await connectAsOwner();

    conn.send({ type: 'metadata', name: 'a.txt' });
    expect(state.sentRaw).toContainEqual({ connectionId: 3, json: JSON.stringify({ type: 'metadata', name: 'a.txt' }) });

    const buf = new ArrayBuffer(8);
    conn.send({ type: 'chunk', fileId: 'f1', index: 0, chunk: buf });
    expect(state.sentBinary).toContainEqual({ connectionId: 3, data: buf });
  });

  it('tracks bufferedAmount while a send is in flight and clears it once settled', async () => {
    const { conn } = await connectAsOwner();
    expect(conn.dataChannel.bufferedAmount).toBe(0);

    const buf = new ArrayBuffer(1024);
    conn.send({ type: 'chunk', fileId: 'f1', index: 0, chunk: buf });
    // A chunk send is two frames (JSON header + binary payload, see
    // PeerJsCompatDataConnection.send), both in flight for this tick — so
    // bufferedAmount is the 1024-byte chunk plus the small header string.
    expect(conn.dataChannel.bufferedAmount).toBeGreaterThan(1024);
    await Promise.resolve();
    await Promise.resolve();
    expect(conn.dataChannel.bufferedAmount).toBe(0);
  });

  it('delivers a JSON message and a binary chunk to on("data") the same way PeerJsCompatDataConnection expects', async () => {
    const { conn } = await connectAsOwner();
    const dataCb = vi.fn();
    conn.on('data', dataCb);

    emitMessage(3, { type: 'done' });
    expect(dataCb).toHaveBeenCalledWith({ type: 'done' });

    dataCb.mockClear();
    emitMessage(3, { __binaryFollows: true, type: 'chunk', fileId: 'f1', index: 5 });
    const buf = new ArrayBuffer(4);
    emitBinary(3, buf);
    expect(dataCb).toHaveBeenCalledWith({ type: 'chunk', fileId: 'f1', index: 5, chunk: buf });
  });

  it('ignores messages/binary frames scoped to a different connection id', async () => {
    const { conn } = await connectAsOwner();
    const dataCb = vi.fn();
    conn.on('data', dataCb);

    emitMessage(999, { type: 'done' });
    expect(dataCb).not.toHaveBeenCalled();
  });

  it('fires "close" when the underlying socket disconnects', async () => {
    const { conn } = await connectAsOwner();
    const closeCb = vi.fn();
    conn.on('close', closeCb);

    emitDisconnected(3);
    expect(closeCb).toHaveBeenCalledTimes(1);
  });

  it('closes the native connection and stops listening on conn.close()', async () => {
    const { conn } = await connectAsOwner();
    conn.close();
    expect(state.close).toHaveBeenCalledWith(3);

    const dataCb = vi.fn();
    conn.on('data', dataCb);
    emitMessage(3, { type: 'done' });
    expect(dataCb).not.toHaveBeenCalled();
  });
});

describe('startLocalSocketRoomHost', () => {
  it('starts the server and hands each hello-completing connection to onConnection', async () => {
    const onConnection = vi.fn();
    const stop = startLocalSocketRoomHost('ROOM1', onConnection);
    await Promise.resolve();

    expect(state.startServer).toHaveBeenCalledTimes(1);

    emitMessage(1, { type: 'novashare-local-hello', roomCode: 'ignored', deviceName: 'Receiver A' });
    emitMessage(2, { type: 'novashare-local-hello', roomCode: 'ignored', deviceName: 'Receiver B' });

    expect(onConnection).toHaveBeenCalledTimes(2);
    expect(onConnection.mock.calls[0][0].peer).toBe('lan-1');
    expect(onConnection.mock.calls[0][1]).toBe('ROOM1');
    expect(onConnection.mock.calls[1][0].peer).toBe('lan-2');

    expect(state.sent).toContainEqual({ connectionId: 1, message: { type: 'novashare-local-hello-ack', roomCode: 'ROOM1' } });
    expect(state.sent).toContainEqual({ connectionId: 2, message: { type: 'novashare-local-hello-ack', roomCode: 'ROOM1' } });

    stop();
    expect(state.stopServer).toHaveBeenCalledTimes(1);
  });

  it('ignores non-hello messages', async () => {
    const onConnection = vi.fn();
    startLocalSocketRoomHost('ROOM1', onConnection);
    await Promise.resolve();

    emitMessage(1, { type: 'something-else' });
    expect(onConnection).not.toHaveBeenCalled();
  });
});
