import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Fake PeerJS: sender does `new Peer(roomCode, {...})`, then
// `.on('open'|'connection'|'error', cb)`. We collect instances so tests can
// reach in and fire events. Defined via vi.hoisted since vi.mock's factory
// is hoisted above normal top-level declarations.
const { FakePeer } = vi.hoisted(() => {
  class FakePeer {
    constructor(id, opts) {
      this.id = id;
      this.opts = opts;
      this.handlers = {};
      this.destroyed = false;
      FakePeer.instances.push(this);
    }
    on(event, cb) {
      (this.handlers[event] ||= []).push(cb);
    }
    emit(event, ...args) {
      (this.handlers[event] || []).forEach((cb) => cb(...args));
    }
    destroy() {
      this.destroyed = true;
    }
  }
  FakePeer.instances = [];
  return { FakePeer };
});

vi.mock('peerjs', () => ({
  default: FakePeer
}));

// Fake DataConnection (the "receiver" side of a cloud connection). Exposes
// on/emit like FakePeer, plus send() recording and a dataChannel with
// bufferedAmount for backpressure checks (matches what streamChunksForPeer
// reads: peerState.conn.dataChannel.bufferedAmount).
function makeFakeConn(peerId = 'receiver-1') {
  const conn = {
    peer: peerId,
    handlers: {},
    sent: [],
    closed: false,
    dataChannel: { bufferedAmount: 0 },
    on(event, cb) {
      (conn.handlers[event] ||= []).push(cb);
    },
    emit(event, ...args) {
      (conn.handlers[event] || []).forEach((cb) => cb(...args));
    },
    send(obj) {
      conn.sent.push(obj);
    },
    close() {
      conn.closed = true;
      conn.emit('close');
    }
  };
  return conn;
}

vi.mock('./native', () => ({
  triggerHaptic: vi.fn(),
  listInstalledApps: vi.fn(async () => []),
  getAppIcon: vi.fn(async () => null),
  getAppApkFile: vi.fn(async () => null),
  clearApkCache: vi.fn(async () => {}),
  getPendingSharedFiles: vi.fn(async () => []),
  onSharedFilesReceived: vi.fn(() => () => {}),
  sharedEntryToFile: vi.fn(async () => null),
  pushTransferNotification: vi.fn(async () => {}),
  stopTransferNotification: vi.fn(async () => {}),
  startAdvertisingRoom: vi.fn(async () => {}),
  stopAdvertisingRoom: vi.fn(async () => {}),
  startNearbyDiscovery: vi.fn(async () => {}),
  stopNearbyDiscovery: vi.fn(async () => {}),
  onNearbyPeerFound: vi.fn(() => () => {}),
  onNearbyPeerLost: vi.fn(() => () => {}),
  getDeviceLabel: vi.fn(() => 'Test device'),
  pickFolder: vi.fn(async () => []),
  isWifiDirectSupported: vi.fn(async () => false),
  wifiDirectInitialize: vi.fn(async () => {}),
  wifiDirectDiscoverPeers: vi.fn(async () => {}),
  wifiDirectStopDiscovery: vi.fn(async () => {}),
  wifiDirectConnect: vi.fn(async () => {}),
  wifiDirectRequestGroupInfo: vi.fn(async () => ({ groupFormed: false, isGroupOwner: false, groupOwnerAddress: '' })),
  wifiDirectRemoveGroup: vi.fn(async () => {}),
  onWifiDirectPeersChanged: vi.fn(() => () => {}),
  onWifiDirectConnectionChanged: vi.fn(() => () => {}),
  localSignalingStartServer: vi.fn(async () => { throw new Error('Local signaling requires native platform'); }),
  localSignalingStopServer: vi.fn(async () => {}),
  localSignalingConnect: vi.fn(async () => { throw new Error('Local signaling requires native platform'); }),
  localSignalingSend: vi.fn(async () => {}),
  localSignalingClose: vi.fn(async () => {}),
  onLocalSignalingMessage: vi.fn(() => () => {}),
  onLocalSignalingPeerConnected: vi.fn(() => () => {})
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(() => ({ remove: () => {} })),
    exitApp: vi.fn()
  }
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn()
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => null
}));

vi.mock('jsqr', () => ({
  default: vi.fn(() => null)
}));

vi.mock('./history', async () => {
  const actual = await vi.importActual('./history');
  return {
    ...actual,
    addHistoryEntry: vi.fn((entry) => ({ id: 'hist-1', timestamp: 0, ...entry })),
    getHistory: vi.fn(() => []),
    clearHistory: vi.fn()
  };
});

import App from './App';
import { addHistoryEntry } from './history';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name, content = 'hello world', type = 'text/plain') {
  return new File([content], name, { type });
}

async function selectFiles(user, files) {
  const input = document.querySelector('input[type="file"]:not([webkitdirectory])');
  await user.upload(input, files);
}

async function startSend(user) {
  const startBtn = await screen.findByRole('button', { name: /Start P2P Sharing Room/i });
  await user.click(startBtn);
}

function latestPeer() {
  return FakePeer.instances[FakePeer.instances.length - 1];
}

beforeEach(() => {
  FakePeer.instances.length = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App sender flow (cloud/PeerJS transport)', () => {
  it('shows selected files in the UI after picking them', async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = makeFile('report.pdf', 'x'.repeat(100), 'application/pdf');
    await selectFiles(user, [file]);

    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
  });

  it('generates a room code and instantiates a Peer with it as the id on send start', async () => {
    const user = userEvent.setup();
    render(<App />);
    await selectFiles(user, [makeFile('a.txt')]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    expect(peer.id).toMatch(/^[0-9A-Z]{6}$/);

    act(() => peer.emit('open'));
    await waitFor(() => expect(screen.getByText('Direct P2P Sharing')).toBeInTheDocument());
  });

  it('transitions to transferring and sends metadata first when a receiver connects', async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = makeFile('a.txt', 'hello world', 'text/plain');
    await selectFiles(user, [file]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const conn = makeFakeConn('receiver-1');
    act(() => peer.emit('connection', conn));

    // Receiver connected toast / transferring state
    expect((await screen.findAllByText(/Receiver connected/i)).length).toBeGreaterThan(0);

    // conn.on('open') schedules metadata + first chunk after a 150ms timer
    act(() => conn.emit('open'));
    await waitFor(() => expect(conn.sent.length).toBeGreaterThan(0), { timeout: 500 });

    const metaMsg = conn.sent.find((m) => m.type === 'metadata');
    expect(metaMsg).toMatchObject({ type: 'metadata', name: 'a.txt', size: file.size, fileIndex: 0, totalFiles: 1 });
  });

  it('streams file data as chunk messages and completes, recording history', async () => {
    const user = userEvent.setup();
    render(<App />);
    const content = 'x'.repeat(50); // small, single chunk (< 64KB CHUNK_SIZE)
    const file = makeFile('a.txt', content, 'text/plain');
    await selectFiles(user, [file]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const conn = makeFakeConn('receiver-1');
    act(() => peer.emit('connection', conn));
    act(() => conn.emit('open'));

    await waitFor(() => expect(conn.sent.some((m) => m.type === 'chunk')).toBe(true), { timeout: 500 });
    const chunkMsg = conn.sent.find((m) => m.type === 'chunk');
    expect(chunkMsg).toMatchObject({ type: 'chunk', offset: 0, done: true });
    expect(chunkMsg.chunk).toBeInstanceOf(ArrayBuffer);

    // After the only file's only chunk, batch-complete should be sent and
    // the app should mark the transfer complete + write history.
    await waitFor(() => expect(conn.sent.some((m) => m.type === 'batch-complete')).toBe(true), { timeout: 500 });

    await waitFor(() => expect(screen.getByText('Transfer Complete!')).toBeInTheDocument());
    expect(addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'sent', status: 'complete' })
    );
  });

  it('advances to the next queued file once the first is fully sent', async () => {
    const user = userEvent.setup();
    render(<App />);
    const file1 = makeFile('a.txt', 'a'.repeat(10), 'text/plain');
    const file2 = makeFile('b.txt', 'b'.repeat(10), 'text/plain');
    await selectFiles(user, [file1, file2]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const conn = makeFakeConn('receiver-1');
    act(() => peer.emit('connection', conn));
    act(() => conn.emit('open'));

    await waitFor(() => {
      const metaMsgs = conn.sent.filter((m) => m.type === 'metadata');
      expect(metaMsgs.length).toBe(2);
    }, { timeout: 1000 });

    const metaMsgs = conn.sent.filter((m) => m.type === 'metadata');
    expect(metaMsgs[0].name).toBe('a.txt');
    expect(metaMsgs[1].name).toBe('b.txt');
  });

  it('pauses sending when paused and resumes without restarting from 0', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Several chunks worth of content (CHUNK_SIZE = 64KB), throttled below
    // so each chunk send is spaced out enough to reliably pause mid-stream.
    const bigContent = 'y'.repeat(64 * 1024 * 4);
    const file = makeFile('big.bin', bigContent, 'application/octet-stream');
    await selectFiles(user, [file]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    // Throttle to 512 KB/s so consecutive 64KB chunks are ~125ms apart,
    // giving the test a reliable window to pause mid-stream.
    const rateBtn = await screen.findByRole('button', { name: /Speed limit/i });
    await user.click(rateBtn);
    const preset = await screen.findByRole('button', { name: '512 KB/s' });
    await user.click(preset);

    const conn = makeFakeConn('receiver-1');
    act(() => peer.emit('connection', conn));
    act(() => conn.emit('open'));

    // Wait for the first chunk, then pause immediately (before the ~125ms
    // throttle delay lets a second chunk go out).
    await waitFor(() => expect(conn.sent.some((m) => m.type === 'chunk')).toBe(true), { timeout: 500 });

    const pauseBtn = await screen.findByRole('button', { name: /Pause/i });
    await user.click(pauseBtn);

    const sentCountAfterPause = conn.sent.length;
    // Give any in-flight throttled send a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 200));
    expect(conn.sent.length).toBe(sentCountAfterPause);

    const lastOffsetBeforeResume = [...conn.sent].reverse().find((m) => m.type === 'chunk')?.offset ?? 0;

    const resumeBtn = await screen.findByRole('button', { name: /Resume/i });
    await user.click(resumeBtn);

    await waitFor(() => {
      const chunks = conn.sent.filter((m) => m.type === 'chunk');
      const offsets = chunks.map((c) => c.offset);
      expect(offsets.some((o) => o > lastOffsetBeforeResume)).toBe(true);
    }, { timeout: 2000 });

    // Never restarts from 0 a second time (offset 0 chunk only sent once).
    const zeroOffsetChunks = conn.sent.filter((m) => m.type === 'chunk' && m.offset === 0);
    expect(zeroOffsetChunks.length).toBe(1);
  });

  it('pauses new chunk sends when the receiver dataChannel bufferedAmount is high (backpressure)', async () => {
    const user = userEvent.setup();
    render(<App />);
    const bigContent = 'z'.repeat(64 * 1024 * 3); // several chunks
    const file = makeFile('big.bin', bigContent, 'application/octet-stream');
    await selectFiles(user, [file]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const conn = makeFakeConn('receiver-1');
    // Backpressure threshold in App.jsx is bufferedAmount > 1MB; set it high
    // up front so no chunk should ever be sent while it stays high.
    conn.dataChannel.bufferedAmount = 2 * 1024 * 1024;
    act(() => peer.emit('connection', conn));
    act(() => conn.emit('open'));

    // Give the 150ms open-timer + a couple of retry cycles (40ms each) time
    // to run; with bufferedAmount permanently high, no chunk should ever send.
    await new Promise((r) => setTimeout(r, 400));
    expect(conn.sent.some((m) => m.type === 'chunk')).toBe(false);

    // Metadata is sent before the backpressure check (metadata isn't gated
    // by dataChannel.bufferedAmount), so we should still see it queued.
    expect(conn.sent.some((m) => m.type === 'metadata')).toBe(true);

    // Now relieve backpressure and confirm sending resumes.
    conn.dataChannel.bufferedAmount = 0;
    await waitFor(() => expect(conn.sent.some((m) => m.type === 'chunk')).toBe(true), { timeout: 1000 });
  });

  it('reflects a selected rate preset in UI state', async () => {
    const user = userEvent.setup();
    render(<App />);
    await selectFiles(user, [makeFile('a.txt')]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const rateBtn = await screen.findByRole('button', { name: /Speed limit/i });
    await user.click(rateBtn);

    const preset = await screen.findByRole('button', { name: '1 MB/s' });
    await user.click(preset);

    await waitFor(() => expect(screen.getByText(/Speed limit: 1 MB\/s/i)).toBeInTheDocument());
  });

  it('shows an error state without crashing when the peer connection errors mid-transfer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await selectFiles(user, [makeFile('a.txt')]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const conn = makeFakeConn('receiver-1');
    act(() => peer.emit('connection', conn));
    act(() => conn.emit('open'));

    await waitFor(() => expect(conn.sent.length).toBeGreaterThan(0), { timeout: 500 });

    // Fire a connection-level error — the app should surface a toast and
    // drop the peer, not crash.
    act(() => conn.emit('error', new Error('boom')));

    expect(await screen.findByText(/Connection error with a receiver/i)).toBeInTheDocument();
  });

  it('surfaces a toast and does not crash when the receiver disconnects mid-transfer', async () => {
    const user = userEvent.setup();
    render(<App />);
    const bigContent = 'q'.repeat(64 * 1024 * 3);
    await selectFiles(user, [makeFile('big.bin', bigContent, 'application/octet-stream')]);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBe(1));
    const peer = latestPeer();
    act(() => peer.emit('open'));

    const conn = makeFakeConn('receiver-1');
    act(() => peer.emit('connection', conn));
    act(() => conn.emit('open'));

    await waitFor(() => expect(conn.sent.some((m) => m.type === 'chunk')).toBe(true), { timeout: 500 });

    act(() => conn.emit('close'));

    expect(await screen.findByText(/A receiver disconnected before finishing/i)).toBeInTheDocument();
  });
});
