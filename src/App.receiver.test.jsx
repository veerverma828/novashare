import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Cloud (PeerJS) receiver-side integration tests for the main App() component.
// Wi-Fi Direct / local transport is out of scope — only the 'cloud' PeerJS
// path (new Peer({...}) -> peer.connect(code)) is exercised here.
// ---------------------------------------------------------------------------

// Fake PeerJS Peer/DataConnection the test fully controls: each instance is
// captured in `createdPeers` / `createdConns` so a test can reach in and fire
// 'open' | 'data' | 'close' | 'error' callbacks to simulate the sender.
// Defined via vi.hoisted so the vi.mock('peerjs', ...) factory below (which
// is hoisted above these imports/consts by vitest) can reference them.
const { FakePeer, getCreatedPeers, getCreatedConns, resetFakePeerState } = vi.hoisted(() => {
  let createdPeers = [];
  let createdConns = [];

  class FakeDataConnection {
    constructor(peerId) {
      this.peer = peerId;
      this.listeners = {};
      this.sent = [];
      this.closed = false;
    }
    on(event, cb) {
      (this.listeners[event] ||= []).push(cb);
      return this;
    }
    emit(event, ...args) {
      (this.listeners[event] || []).forEach((cb) => cb(...args));
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
  }

  class FakePeer {
    constructor(opts) {
      this.opts = opts;
      this.id = 'fake-receiver-id';
      this.listeners = {};
      this.destroyed = false;
      createdPeers.push(this);
    }
    on(event, cb) {
      (this.listeners[event] ||= []).push(cb);
      return this;
    }
    emit(event, ...args) {
      (this.listeners[event] || []).forEach((cb) => cb(...args));
    }
    connect(code) {
      const conn = new FakeDataConnection(code);
      conn.__requestedCode = code;
      createdConns.push(conn);
      return conn;
    }
    destroy() {
      this.destroyed = true;
    }
  }

  return {
    FakePeer,
    getCreatedPeers: () => createdPeers,
    getCreatedConns: () => createdConns,
    resetFakePeerState: () => {
      createdPeers = [];
      createdConns = [];
    },
  };
});

vi.mock('peerjs', () => ({
  default: FakePeer,
}));

vi.mock('./native', () => ({
  triggerHaptic: vi.fn(),
  listInstalledApps: vi.fn(() => Promise.resolve([])),
  getAppIcon: vi.fn(() => Promise.resolve(null)),
  getAppApkFile: vi.fn(),
  clearApkCache: vi.fn(() => Promise.resolve()),
  getPendingSharedFiles: vi.fn(() => Promise.resolve([])),
  onSharedFilesReceived: vi.fn(() => () => {}),
  sharedEntryToFile: vi.fn(),
  pushTransferNotification: vi.fn(() => Promise.resolve()),
  stopTransferNotification: vi.fn(() => Promise.resolve()),
  startAdvertisingRoom: vi.fn(() => Promise.resolve()),
  stopAdvertisingRoom: vi.fn(() => Promise.resolve()),
  startNearbyDiscovery: vi.fn(() => Promise.resolve()),
  stopNearbyDiscovery: vi.fn(() => Promise.resolve()),
  onNearbyPeerFound: vi.fn(() => () => {}),
  onNearbyPeerLost: vi.fn(() => () => {}),
  getDeviceLabel: vi.fn(() => 'Test Device'),
  pickFolder: vi.fn(() => Promise.resolve([])),
  isWifiDirectSupported: vi.fn(() => Promise.resolve(false)),
  wifiDirectInitialize: vi.fn(() => Promise.resolve()),
  wifiDirectDiscoverPeers: vi.fn(() => Promise.resolve()),
  wifiDirectStopDiscovery: vi.fn(() => Promise.resolve()),
  wifiDirectConnect: vi.fn(() => Promise.resolve()),
  wifiDirectRequestGroupInfo: vi.fn(() => Promise.resolve({ groupFormed: false, isGroupOwner: false, groupOwnerAddress: '' })),
  wifiDirectRemoveGroup: vi.fn(() => Promise.resolve()),
  onWifiDirectPeersChanged: vi.fn(() => () => {}),
  onWifiDirectConnectionChanged: vi.fn(() => () => {}),
  localSignalingStartServer: vi.fn(() => Promise.reject(new Error('not supported'))),
  localSignalingStopServer: vi.fn(() => Promise.resolve()),
  localSignalingConnect: vi.fn(() => Promise.reject(new Error('not supported'))),
  localSignalingSend: vi.fn(() => Promise.resolve()),
  localSignalingClose: vi.fn(() => Promise.resolve()),
  onLocalSignalingMessage: vi.fn(() => () => {}),
  onLocalSignalingPeerConnected: vi.fn(() => () => {}),
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

// Real @capacitor/app's addListener resolves to a handle whose shape isn't
// fully honored by jsdom/web mode; stub it so the app's back-button listener
// effect doesn't throw an unhandled rejection on unmount.
vi.mock('@capacitor/app', () => ({
  // Real Capacitor's addListener() returns a handle object that is both a
  // PromiseLike and synchronously carries .remove() — App.jsx uses it
  // synchronously (`const handle = CapacitorApp.addListener(...)`), so the
  // mock must expose .remove() directly on the returned object, not only
  // once a promise resolves.
  App: {
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

vi.mock('./history', async () => {
  const actual = await vi.importActual('./history');
  return {
    ...actual,
    addHistoryEntry: vi.fn(),
  };
});

import App from './App.jsx';
import { addHistoryEntry } from './history';

// jsdom doesn't implement these — stub so saveReceivedFile()'s <a download>
// click path doesn't throw.
let createdPeers;
let createdConns;

beforeEach(() => {
  resetFakePeerState();
  createdPeers = getCreatedPeers();
  createdConns = getCreatedConns();
  URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function enterRoomCodeAndConnect(user, code = 'ABC123') {
  const input = screen.getByPlaceholderText(/Enter Room Code/i);
  await user.type(input, code);
  const btn = screen.getByRole('button', { name: /Connect & Download/i });
  await user.click(btn);
}

function textEncode(str) {
  return new TextEncoder().encode(str).buffer;
}

describe('App receiver flow (cloud/PeerJS)', () => {
  it('typing a room code and submitting calls peer.connect with the uppercased/trimmed code', async () => {
    const user = userEvent.setup();
    render(<App />);

    await enterRoomCodeAndConnect(user, 'abc123');

    expect(createdPeers).toHaveLength(1);
    const peer = createdPeers[0];
    await act(async () => {
      peer.emit('open');
    });

    expect(createdConns).toHaveLength(1);
    expect(createdConns[0].__requestedCode).toBe('ABC123');
  });

  it('moves to the transferring/waiting UI once the connection opens', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    await waitFor(() => {
      expect(screen.getAllByText(/Receiving File/i).length).toBeGreaterThan(0);
    });
  });

  it('shows incoming file name/size after a metadata message', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    await act(async () => {
      conn.emit('data', { type: 'batch-start' });
      conn.emit('data', {
        type: 'metadata',
        fileIndex: 0,
        totalFiles: 1,
        name: 'hello.txt',
        size: 12,
        mime: 'text/plain',
      });
    });

    expect(await screen.findByText('hello.txt')).toBeInTheDocument();
  });

  it('reassembles chunks, updates progress, and saves the file on completion', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    const part1 = textEncode('hello ');
    const part2 = textEncode('world!');
    const totalSize = part1.byteLength + part2.byteLength;

    await act(async () => {
      conn.emit('data', { type: 'batch-start' });
      conn.emit('data', {
        type: 'metadata',
        fileIndex: 0,
        totalFiles: 1,
        name: 'greeting.txt',
        size: totalSize,
        mime: 'text/plain',
      });
    });

    await act(async () => {
      conn.emit('data', { type: 'chunk', chunk: part1, done: false });
    });

    // Progress should reflect the first chunk (not yet 100%).
    await waitFor(() => {
      expect(screen.getAllByText(/Receiving File/i).length).toBeGreaterThan(0);
    });

    await act(async () => {
      conn.emit('data', { type: 'chunk', chunk: part2, done: true });
    });

    await act(async () => {
      conn.emit('data', { type: 'batch-complete' });
    });

    await waitFor(() => {
      expect(screen.getByText(/File Received!/i)).toBeInTheDocument();
    });

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    // The Blob passed to createObjectURL should be built from both chunks.
    const blobArg = URL.createObjectURL.mock.calls[0][0];
    expect(blobArg.size).toBe(totalSize);

    expect(addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'received',
        status: 'complete',
        files: expect.arrayContaining([expect.objectContaining({ name: 'greeting.txt', size: totalSize })]),
      })
    );
  });

  it('tracks a second file in sequence without leftover state from the first', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    const fileAData = textEncode('AAAA');
    const fileBData = textEncode('BBBBBB');

    await act(async () => {
      conn.emit('data', { type: 'batch-start' });
      conn.emit('data', { type: 'metadata', fileIndex: 0, totalFiles: 2, name: 'a.txt', size: fileAData.byteLength, mime: 'text/plain' });
      conn.emit('data', { type: 'chunk', chunk: fileAData, done: true });
    });

    expect(await screen.findByText('a.txt')).toBeInTheDocument();

    await act(async () => {
      conn.emit('data', { type: 'metadata', fileIndex: 1, totalFiles: 2, name: 'b.txt', size: fileBData.byteLength, mime: 'text/plain' });
    });

    // New file's metadata should now be shown, with progress/size reset.
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText(/File 2 of 2/i)).toBeInTheDocument();

    await act(async () => {
      conn.emit('data', { type: 'chunk', chunk: fileBData, done: true });
      conn.emit('data', { type: 'batch-complete' });
    });

    await waitFor(() => {
      expect(screen.getByText(/Files Received!/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 Files Received!/i)).toBeInTheDocument();
  });

  it('attempts a reconnect after a mid-transfer drop, preserving received bytes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    const chunk = textEncode('partial-data');

    await act(async () => {
      conn.emit('data', { type: 'batch-start' });
      conn.emit('data', { type: 'metadata', fileIndex: 0, totalFiles: 1, name: 'big.bin', size: 999999, mime: 'application/octet-stream' });
      conn.emit('data', { type: 'chunk', chunk, done: false });
    });

    // Simulate the connection dropping mid-transfer.
    await act(async () => {
      conn.emit('close');
    });

    await waitFor(() => {
      expect(screen.getAllByText(/reconnecting/i).length).toBeGreaterThan(0);
    });

    // scheduleReconnectRetry uses setTimeout(reconnectAttempt * 1000).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(createdPeers.length).toBeGreaterThanOrEqual(2);

    // Resuming connection should tell the sender the byte offset already
    // received, not reset it to zero.
    const newPeer = createdPeers[createdPeers.length - 1];
    await act(async () => {
      newPeer.emit('open');
    });
    const newConn = createdConns[createdConns.length - 1];
    await act(async () => {
      newConn.emit('open');
    });

    const resumeMsg = newConn.sent.find((m) => m.type === 'resume');
    expect(resumeMsg).toBeTruthy();
    expect(resumeMsg.offset).toBe(chunk.byteLength);
  });

  it('ignores unrecognized message types without crashing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    expect(() => {
      act(() => {
        conn.emit('data', { type: 'some-unknown-type', foo: 'bar' });
      });
    }).not.toThrow();

    // App should still be alive and in the transferring/connected state.
    await waitFor(() => {
      expect(screen.getAllByText(/Receiving File/i).length).toBeGreaterThan(0);
    });
  });

  it('surfaces a "Transfer Failed" error state when the peer connection errors out before opening', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);

    const peer = createdPeers[0];
    await act(async () => {
      peer.emit('error', new Error('Could not connect to signaling server'));
    });

    expect(await screen.findByText(/Transfer Failed/i)).toBeInTheDocument();
  });
});
