import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Native-platform receiver tests: integrity verification, disk-space
// pre-check, and resume-checkpoint persistence. All three are gated behind
// Capacitor.isNativePlatform(), so App.receiver.test.jsx (which runs under
// the default web/jsdom platform, where isNativePlatform() is false) never
// exercises these code paths — this file mocks '@capacitor/core' as native
// instead, same approach as native.native.test.js.
// ---------------------------------------------------------------------------

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

// App.jsx registers NotifyDownload directly via registerPlugin('NotifyDownload')
// (not routed through native.js), so it needs its own mock here.
const { mockNotifyDownload } = vi.hoisted(() => ({
  mockNotifyDownload: {
    appendChunk: vi.fn(() => Promise.resolve()),
    finishReceive: vi.fn(() => Promise.resolve({ uri: 'content://fake/uri' })),
    hashFile: vi.fn(() => Promise.resolve({ sha256: 'expected-hash' })),
    checkFreeSpace: vi.fn(() => Promise.resolve({ freeBytes: 10 * 1024 * 1024 * 1024 })),
    getPartialInfo: vi.fn(() => Promise.resolve({ exists: false, size: 0 })),
    discardPartial: vi.fn(() => Promise.resolve()),
    openFile: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
  registerPlugin: vi.fn((name) => (name === 'NotifyDownload' ? mockNotifyDownload : {})),
}));

vi.mock('peerjs', () => ({
  default: FakePeer,
}));

vi.mock('./native', () => ({
  triggerHaptic: vi.fn(),
  triggerSuccessHaptic: vi.fn(),
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
  wifiDirectIsLocationEnabled: vi.fn(() => Promise.resolve(true)),
  wifiDirectOpenLocationSettings: vi.fn(() => Promise.resolve()),
  wifiDirectIsWifiEnabled: vi.fn(() => Promise.resolve(true)),
  wifiDirectOpenWifiSettings: vi.fn(() => Promise.resolve()),
  wifiDirectConnect: vi.fn(() => Promise.resolve()),
  wifiDirectRequestGroupInfo: vi.fn(() => Promise.resolve({ groupFormed: false, isGroupOwner: false, groupOwnerAddress: '' })),
  wifiDirectRemoveGroup: vi.fn(() => Promise.resolve()),
  isHotspotSupported: vi.fn(() => Promise.resolve(false)),
  hotspotStart: vi.fn(() => Promise.reject(new Error('not supported'))),
  hotspotStop: vi.fn(() => Promise.resolve()),
  hotspotJoin: vi.fn(() => Promise.reject(new Error('not supported'))),
  hotspotLeave: vi.fn(() => Promise.resolve()),
  onHotspotLost: vi.fn(() => () => {}),
  onWifiDirectPeersChanged: vi.fn(() => () => {}),
  onWifiDirectConnectionChanged: vi.fn(() => () => {}),
  localSignalingStartServer: vi.fn(() => Promise.reject(new Error('not supported'))),
  localSignalingStopServer: vi.fn(() => Promise.resolve()),
  localSignalingConnect: vi.fn(() => Promise.reject(new Error('not supported'))),
  localSignalingSend: vi.fn(() => Promise.resolve()),
  localSignalingClose: vi.fn(() => Promise.resolve()),
  onLocalSignalingMessage: vi.fn(() => () => {}),
  onLocalSignalingPeerConnected: vi.fn(() => () => {}),
  checkForAppUpdate: vi.fn(() => Promise.resolve({ updateAvailable: false })),
  startFlexibleAppUpdate: vi.fn(() => Promise.resolve({ accepted: false })),
  completeFlexibleAppUpdate: vi.fn(() => Promise.resolve()),
  onAppUpdateStateChanged: vi.fn(() => () => {}),
  getBatteryInfo: vi.fn(() => Promise.resolve({ batteryLevel: null, isCharging: false })),
}));

vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
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
import { getCheckpoint } from './transferState';

let createdPeers;
let createdConns;

beforeEach(() => {
  resetFakePeerState();
  createdPeers = getCreatedPeers();
  createdConns = getCreatedConns();
  localStorage.clear();
  mockNotifyDownload.hashFile.mockImplementation(() => Promise.resolve({ sha256: 'expected-hash' }));
  mockNotifyDownload.checkFreeSpace.mockImplementation(() => Promise.resolve({ freeBytes: 10 * 1024 * 1024 * 1024 }));
  mockNotifyDownload.getPartialInfo.mockImplementation(() => Promise.resolve({ exists: false, size: 0 }));
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

describe('App receiver flow (native platform)', () => {
  it('verifies the file hash before finishing a receive, and records it as verified', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);
    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    const chunk = textEncode('hello world');

    await act(async () => {
      conn.emit('data', { type: 'batch-start', totalFiles: 1, totalBytes: chunk.byteLength });
      conn.emit('data', { type: 'metadata', fileIndex: 0, totalFiles: 1, name: 'greeting.txt', size: chunk.byteLength, mime: 'text/plain', sha256: 'expected-hash' });
      conn.emit('data', { type: 'chunk', chunk, done: true });
    });

    await waitFor(() => expect(mockNotifyDownload.finishReceive).toHaveBeenCalled());
    expect(mockNotifyDownload.hashFile).toHaveBeenCalled();
    expect(mockNotifyDownload.discardPartial).not.toHaveBeenCalled();

    await act(async () => { conn.emit('data', { type: 'batch-complete' }); });

    expect(addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        files: expect.arrayContaining([expect.objectContaining({ name: 'greeting.txt', verified: true })]),
      })
    );
  });

  it('discards the file and surfaces an error when the hash does not match', async () => {
    mockNotifyDownload.hashFile.mockImplementation(() => Promise.resolve({ sha256: 'wrong-hash' }));
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);
    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    const chunk = textEncode('hello world');

    await act(async () => {
      conn.emit('data', { type: 'batch-start', totalFiles: 1, totalBytes: chunk.byteLength });
      conn.emit('data', { type: 'metadata', fileIndex: 0, totalFiles: 1, name: 'greeting.txt', size: chunk.byteLength, mime: 'text/plain', sha256: 'expected-hash' });
      conn.emit('data', { type: 'chunk', chunk, done: true });
    });

    await waitFor(() => expect(mockNotifyDownload.discardPartial).toHaveBeenCalled());
    expect(mockNotifyDownload.finishReceive).not.toHaveBeenCalled();
    expect(await screen.findByText(/failed to verify/i)).toBeInTheDocument();
  });

  it('rejects the batch upfront when there is not enough free storage', async () => {
    mockNotifyDownload.checkFreeSpace.mockImplementation(() => Promise.resolve({ freeBytes: 1024 }));
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);
    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    await act(async () => {
      conn.emit('data', { type: 'batch-start', totalFiles: 1, totalBytes: 5 * 1024 * 1024 });
    });

    await waitFor(() => expect(conn.closed).toBe(true));
    const abortMsg = conn.sent.find((m) => m.type === 'abort');
    expect(abortMsg).toMatchObject({ type: 'abort', reason: 'insufficient-space' });
    expect(await screen.findByText(/not enough storage/i)).toBeInTheDocument();
  });

  it('persists a resume checkpoint during an active receive and clears it on completion', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user, 'ABC123');
    const peer = createdPeers[0];
    await act(async () => { peer.emit('open'); });
    const conn = createdConns[0];
    await act(async () => { conn.emit('open'); });

    const chunk = textEncode('hello world');

    await act(async () => {
      conn.emit('data', { type: 'batch-start', totalFiles: 1, totalBytes: chunk.byteLength });
      conn.emit('data', { type: 'metadata', fileIndex: 0, totalFiles: 1, name: 'greeting.txt', size: chunk.byteLength, mime: 'text/plain', sha256: 'expected-hash' });
    });

    const checkpoint = getCheckpoint();
    expect(checkpoint).toMatchObject({ direction: 'receive', fileIndex: 0, roomCode: 'ABC123' });
    expect(checkpoint.currentFile).toMatchObject({ name: 'greeting.txt', size: chunk.byteLength });

    await act(async () => {
      conn.emit('data', { type: 'chunk', chunk, done: true });
    });
    await waitFor(() => expect(mockNotifyDownload.finishReceive).toHaveBeenCalled());
    await act(async () => {
      conn.emit('data', { type: 'batch-complete' });
    });

    expect(getCheckpoint()).toBeNull();
  });
});
