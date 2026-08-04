import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Web/no-op path: Capacitor.isNativePlatform() returns false throughout.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    convertFileSrc: vi.fn((p) => `capacitor://localhost/${p}`),
  },
  registerPlugin: vi.fn(() => ({
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  })),
}));

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setStyle: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setOverlaysWebView: vi.fn(() => Promise.resolve()),
  },
  Style: { Dark: 'DARK' },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn(() => Promise.resolve()) },
  ImpactStyle: { Light: 'LIGHT' },
}));

import { StatusBar } from '@capacitor/status-bar';
import { Haptics } from '@capacitor/haptics';
import * as native from './native.js';

describe('native.js — web/no-op path', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('native-app');
    vi.clearAllMocks();
  });

  it('triggerHaptic() is a no-op and does not call Haptics', () => {
    expect(() => native.triggerHaptic()).not.toThrow();
    expect(Haptics.impact).not.toHaveBeenCalled();
  });

  it('listInstalledApps() resolves to an empty array', async () => {
    await expect(native.listInstalledApps()).resolves.toEqual([]);
  });

  it('getAppIcon() resolves to null', async () => {
    await expect(native.getAppIcon('com.example.app')).resolves.toBeNull();
  });

  it('clearApkCache() resolves without throwing', async () => {
    await expect(native.clearApkCache()).resolves.toBeUndefined();
  });

  it('getPendingSharedFiles() resolves to an empty array', async () => {
    await expect(native.getPendingSharedFiles()).resolves.toEqual([]);
  });

  it('onSharedFilesReceived() returns a no-op unsubscribe function', () => {
    const unsub = native.onSharedFilesReceived(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('pickFolder() resolves to an empty array', async () => {
    await expect(native.pickFolder()).resolves.toEqual([]);
  });

  it('pushTransferNotification() resolves without throwing', async () => {
    await expect(native.pushTransferNotification('t', 'x', 50)).resolves.toBeUndefined();
  });

  it('stopTransferNotification() resolves without throwing', async () => {
    await expect(native.stopTransferNotification()).resolves.toBeUndefined();
  });

  it('startAdvertisingRoom() resolves without throwing', async () => {
    await expect(native.startAdvertisingRoom('ABC123', 'device')).resolves.toBeUndefined();
  });

  it('stopAdvertisingRoom() resolves without throwing', async () => {
    await expect(native.stopAdvertisingRoom()).resolves.toBeUndefined();
  });

  it('startNearbyDiscovery() resolves without throwing', async () => {
    await expect(native.startNearbyDiscovery()).resolves.toBeUndefined();
  });

  it('stopNearbyDiscovery() resolves without throwing', async () => {
    await expect(native.stopNearbyDiscovery()).resolves.toBeUndefined();
  });

  it('onNearbyPeerFound() returns a no-op unsubscribe function', () => {
    const unsub = native.onNearbyPeerFound(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('onNearbyPeerLost() returns a no-op unsubscribe function', () => {
    const unsub = native.onNearbyPeerLost(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('isWifiDirectSupported() resolves to false', async () => {
    await expect(native.isWifiDirectSupported()).resolves.toBe(false);
  });

  it('wifiDirectInitialize() resolves without throwing', async () => {
    await expect(native.wifiDirectInitialize()).resolves.toBeUndefined();
  });

  it('wifiDirectDiscoverPeers() resolves without throwing', async () => {
    await expect(native.wifiDirectDiscoverPeers()).resolves.toBeUndefined();
  });

  it('wifiDirectStopDiscovery() resolves without throwing', async () => {
    await expect(native.wifiDirectStopDiscovery()).resolves.toBeUndefined();
  });

  it('wifiDirectConnect() resolves without throwing', async () => {
    await expect(native.wifiDirectConnect('aa:bb:cc')).resolves.toBeUndefined();
  });

  it('wifiDirectCancelConnect() resolves without throwing', async () => {
    await expect(native.wifiDirectCancelConnect()).resolves.toBeUndefined();
  });

  it('wifiDirectRequestGroupInfo() resolves to the documented no-op shape', async () => {
    await expect(native.wifiDirectRequestGroupInfo()).resolves.toEqual({
      groupFormed: false,
      isGroupOwner: false,
      groupOwnerAddress: '',
    });
  });

  it('wifiDirectRemoveGroup() resolves without throwing', async () => {
    await expect(native.wifiDirectRemoveGroup()).resolves.toBeUndefined();
  });

  it('onWifiDirectPeersChanged() returns a no-op unsubscribe function', () => {
    const unsub = native.onWifiDirectPeersChanged(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('onWifiDirectConnectionChanged() returns a no-op unsubscribe function', () => {
    const unsub = native.onWifiDirectConnectionChanged(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('localSignalingStartServer() rejects with a clear error', async () => {
    await expect(native.localSignalingStartServer()).rejects.toThrow(
      'Local signaling requires native platform'
    );
  });

  it('localSignalingStopServer() resolves without throwing', async () => {
    await expect(native.localSignalingStopServer()).resolves.toBeUndefined();
  });

  it('localSignalingConnect() rejects with a clear error', async () => {
    await expect(native.localSignalingConnect('192.168.49.1', 1234)).rejects.toThrow(
      'Local signaling requires native platform'
    );
  });

  it('localSignalingSend() resolves without throwing', async () => {
    await expect(native.localSignalingSend('conn-1', { type: 'offer' })).resolves.toBeUndefined();
  });

  it('localSignalingClose() resolves without throwing', async () => {
    await expect(native.localSignalingClose('conn-1')).resolves.toBeUndefined();
  });

  it('onLocalSignalingMessage() returns a no-op unsubscribe function', () => {
    const unsub = native.onLocalSignalingMessage(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('onLocalSignalingPeerConnected() returns a no-op unsubscribe function', () => {
    const unsub = native.onLocalSignalingPeerConnected(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('onLocalSignalingPeerDisconnected() returns a no-op unsubscribe function', () => {
    const unsub = native.onLocalSignalingPeerDisconnected(vi.fn());
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('initNative() is a no-op: does not touch the DOM class or StatusBar', () => {
    native.initNative();
    expect(document.documentElement.classList.contains('native-app')).toBe(false);
    expect(StatusBar.setStyle).not.toHaveBeenCalled();
    expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled();
    expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
  });
});

describe('native.js — getDeviceLabel (pure UA parsing, no Capacitor)', () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
  });

  it('extracts the device model from a matching Android UA', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36',
      configurable: true,
    });
    expect(native.getDeviceLabel()).toBe('Pixel 7');
  });

  it('falls back to "NovaShare device" when the UA has no matching pattern', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      configurable: true,
    });
    expect(native.getDeviceLabel()).toBe('NovaShare device');
  });
});
