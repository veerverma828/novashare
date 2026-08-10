import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Integration tests for automatic online/offline transport selection: the
// user never picks a transport, so these assert on what the app *chooses*
// given a network condition, not on any control they operated.

const { FakePeer } = vi.hoisted(() => {
  class FakePeer {
    constructor(id, opts) {
      this.id = id || 'fake-peer-id';
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
    connect() {
      return { peer: 'sender', on: () => {}, send: () => {}, close: () => {}, dataChannel: { bufferedAmount: 0 } };
    }
    destroy() {
      this.destroyed = true;
    }
  }
  FakePeer.instances = [];
  return { FakePeer };
});

vi.mock('peerjs', () => ({ default: FakePeer }));

// isOnline is the verdict the whole feature turns on, so it's mocked
// directly — the probe itself is covered by connectivity.test.js.
const { isOnlineMock, connectivityListeners } = vi.hoisted(() => ({
  isOnlineMock: vi.fn(async () => true),
  connectivityListeners: []
}));

vi.mock('./connectivity', () => ({
  isOnline: isOnlineMock,
  subscribeConnectivity: (cb) => {
    connectivityListeners.push(cb);
    return () => {
      const i = connectivityListeners.indexOf(cb);
      if (i >= 0) connectivityListeners.splice(i, 1);
    };
  },
  resetConnectivityCache: () => {}
}));

const { nativeMocks } = vi.hoisted(() => ({
  nativeMocks: {
    isHotspotSupported: vi.fn(async () => true),
    hotspotStart: vi.fn(async () => ({ ssid: 'NovaShare_1234', passphrase: 'abcd1234' }))
  }
}));

vi.mock('./native', () => ({
  triggerHaptic: vi.fn(),
  triggerSuccessHaptic: vi.fn(),
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
  wifiDirectIsLocationEnabled: vi.fn(async () => true),
  wifiDirectOpenLocationSettings: vi.fn(async () => {}),
  wifiDirectIsWifiEnabled: vi.fn(async () => true),
  wifiDirectOpenWifiSettings: vi.fn(async () => {}),
  wifiDirectConnect: vi.fn(async () => {}),
  wifiDirectRequestGroupInfo: vi.fn(async () => ({ groupFormed: false, isGroupOwner: false, groupOwnerAddress: '' })),
  wifiDirectRemoveGroup: vi.fn(async () => {}),
  isHotspotSupported: nativeMocks.isHotspotSupported,
  hotspotStart: nativeMocks.hotspotStart,
  hotspotStop: vi.fn(async () => {}),
  hotspotJoin: vi.fn(async () => { throw new Error('not supported'); }),
  hotspotLeave: vi.fn(async () => {}),
  onHotspotLost: vi.fn(() => () => {}),
  onWifiDirectPeersChanged: vi.fn(() => () => {}),
  onWifiDirectConnectionChanged: vi.fn(() => () => {}),
  localSignalingStartServer: vi.fn(async () => {}),
  localSignalingStopServer: vi.fn(async () => {}),
  localSignalingConnect: vi.fn(async () => { throw new Error('no native'); }),
  localSignalingSend: vi.fn(async () => {}),
  localSignalingSendRaw: vi.fn(async () => {}),
  localSignalingSendBinary: vi.fn(async () => {}),
  localSignalingClose: vi.fn(async () => {}),
  onLocalSignalingMessage: vi.fn(() => () => {}),
  onLocalSignalingBinaryMessage: vi.fn(() => () => {}),
  onLocalSignalingPeerConnected: vi.fn(() => () => {}),
  onLocalSignalingPeerDisconnected: vi.fn(() => () => {}),
  checkForAppUpdate: vi.fn(async () => ({ updateAvailable: false })),
  startFlexibleAppUpdate: vi.fn(async () => ({ accepted: false })),
  completeFlexibleAppUpdate: vi.fn(async () => {}),
  onAppUpdateStateChanged: vi.fn(() => () => {}),
  getBatteryInfo: vi.fn(() => Promise.resolve({ batteryLevel: null, isCharging: false }))
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(() => ({ remove: () => {} })), exitApp: vi.fn() }
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => null }));
vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

import App from './App';
import { hotspotStart } from './native';

const CLOUD_OPEN_TIMEOUT_MS = 8000;

const setNavigatorOnLine = (value) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};

function makeFile(name = 'a.txt') {
  return new File(['hello'], name, { type: 'text/plain' });
}

async function selectFiles(user) {
  const input = document.querySelector('input[type="file"]:not([webkitdirectory])');
  await user.upload(input, [makeFile()]);
}

async function startSend(user) {
  await user.click(await screen.findByRole('button', { name: /Start P2P Sharing Room/i }));
}

async function enterRoomCodeAndConnect(user, code = 'ABC123') {
  await user.type(screen.getByPlaceholderText(/Enter Room Code/i), code);
  await user.click(screen.getByRole('button', { name: /Connect & Download/i }));
}

beforeEach(() => {
  // Call history leaks between tests otherwise — several assertions here are
  // "this native call never happened", which a prior test would falsify.
  vi.clearAllMocks();
  FakePeer.instances.length = 0;
  connectivityListeners.length = 0;
  localStorage.clear();
  setNavigatorOnLine(true);
  isOnlineMock.mockResolvedValue(true);
  nativeMocks.isHotspotSupported.mockResolvedValue(true);
  nativeMocks.hotspotStart.mockResolvedValue({ ssid: 'NovaShare_1234', passphrase: 'abcd1234' });
});

afterEach(() => {
  vi.useRealTimers();
  setNavigatorOnLine(true);
});

describe('sender: automatic transport selection', () => {
  it('goes straight to an offline hotspot link when no interface is up at all', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Let the isHotspotSupported() probe settle before deciding.
    await waitFor(() => expect(nativeMocks.isHotspotSupported).toHaveBeenCalled());
    setNavigatorOnLine(false);

    await selectFiles(user);
    await startSend(user);

    await waitFor(() => expect(hotspotStart).toHaveBeenCalled());
    // The whole point: no time wasted on a broker that cannot be reached.
    expect(FakePeer.instances).toHaveLength(0);
  });

  it('still tries the cloud when offline if the device cannot host a hotspot', async () => {
    nativeMocks.isHotspotSupported.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(nativeMocks.isHotspotSupported).toHaveBeenCalled());
    setNavigatorOnLine(false);

    await selectFiles(user);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));
    expect(hotspotStart).not.toHaveBeenCalled();
  });

  it('opens a cloud room immediately when online, without waiting on a probe', async () => {
    const user = userEvent.setup();
    render(<App />);
    await selectFiles(user);
    await startSend(user);

    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));
    expect(hotspotStart).not.toHaveBeenCalled();
  });

  // The case navigator.onLine gets wrong: an interface is up (so startAutoSend
  // optimistically chose cloud) but there is no route out.
  it('degrades to a hotspot when the broker is unreachable and a re-probe confirms offline', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(nativeMocks.isHotspotSupported).toHaveBeenCalled());
    await selectFiles(user);
    await startSend(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));

    isOnlineMock.mockResolvedValue(false);
    await act(async () => {
      FakePeer.instances[0].emit('error', { type: 'network', message: 'unreachable' });
    });

    await waitFor(() => expect(hotspotStart).toHaveBeenCalled());
  });

  // A broker that is simply unreachable never errors — the socket just never
  // opens — so the timer is the only thing that can rescue this case.
  it('degrades to a hotspot when the broker never opens at all', async () => {
    // shouldAdvanceTime keeps waitFor/userEvent working while the watchdog's
    // own setTimeout is still under our control. Installed before render so
    // the watchdog is armed on the fake clock, not the real one.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await waitFor(() => expect(nativeMocks.isHotspotSupported).toHaveBeenCalled());
    await selectFiles(user);
    await startSend(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));

    isOnlineMock.mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_OPEN_TIMEOUT_MS + 1);
    });

    await waitFor(() => expect(hotspotStart).toHaveBeenCalled());
  });

  it('surfaces a real error instead of hijacking the radio when the broker fails but the internet works', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(nativeMocks.isHotspotSupported).toHaveBeenCalled());
    await selectFiles(user);
    await startSend(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));

    isOnlineMock.mockResolvedValue(true);
    await act(async () => {
      FakePeer.instances[0].emit('error', { type: 'network', message: 'broker down' });
    });

    // Appears twice — once as the toast, once in the error panel.
    await waitFor(() => expect(screen.getAllByText(/Could not reach the signaling server/i).length).toBeGreaterThan(0));
    expect(hotspotStart).not.toHaveBeenCalled();
  });

  it('does not fire the watchdog once the broker opens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await waitFor(() => expect(nativeMocks.isHotspotSupported).toHaveBeenCalled());
    await selectFiles(user);
    await startSend(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));

    await act(async () => {
      FakePeer.instances[0].emit('open');
    });

    isOnlineMock.mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLOUD_OPEN_TIMEOUT_MS * 2);
    });

    expect(hotspotStart).not.toHaveBeenCalled();
  });
});

describe('receiver: automatic recovery', () => {
  it('blames the network, not the code, when the join fails while offline', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));

    isOnlineMock.mockResolvedValue(false);
    await act(async () => {
      FakePeer.instances[0].emit('error', { type: 'network', message: 'offline' });
    });

    await waitFor(() => expect(screen.getByText(/You're offline/i)).toBeInTheDocument());
  });

  it('retries the join by itself once connectivity returns', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));
    const peersAfterFirstAttempt = FakePeer.instances.length;

    isOnlineMock.mockResolvedValue(false);
    await act(async () => {
      FakePeer.instances[0].emit('error', { type: 'network', message: 'offline' });
    });
    await waitFor(() => expect(screen.getByText(/You're offline/i)).toBeInTheDocument());
    expect(connectivityListeners).toHaveLength(1);

    // Internet comes back — no user action anywhere in this block.
    isOnlineMock.mockResolvedValue(true);
    await act(async () => {
      await Promise.all(connectivityListeners.map((cb) => cb()));
    });

    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(peersAfterFirstAttempt));
  });

  it('ignores a connectivity change that arrives after the user navigated away', async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterRoomCodeAndConnect(user);
    await waitFor(() => expect(FakePeer.instances.length).toBeGreaterThan(0));

    isOnlineMock.mockResolvedValue(false);
    await act(async () => {
      FakePeer.instances[0].emit('error', { type: 'network', message: 'offline' });
    });
    await waitFor(() => expect(screen.getByText(/You're offline/i)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Return Home/i }));
    const peersBefore = FakePeer.instances.length;

    isOnlineMock.mockResolvedValue(true);
    await act(async () => {
      await Promise.all(connectivityListeners.map((cb) => cb()));
    });

    expect(FakePeer.instances).toHaveLength(peersBefore);
  });
});
