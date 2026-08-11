import { describe, it, expect, vi, beforeEach } from 'vitest';

// Native path: Capacitor.isNativePlatform() returns true. Each registerPlugin()
// call returns a distinct mock plugin object we can assert against.
// vi.hoisted ensures this exists before the hoisted vi.mock factory below runs.
const mockPlugins = vi.hoisted(() => {
  const plugins = {};
  const makePlugin = () => ({
    addListener: () => Promise.resolve({ remove: () => {} }),
  });
  ['InstalledApps', 'IncomingShare', 'TransferNotification', 'NearbyDiscovery', 'FolderPicker', 'WifiDirect', 'LocalSignaling']
    .forEach((name) => { plugins[name] = makePlugin(); });
  return plugins;
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
    convertFileSrc: vi.fn((p) => `capacitor://localhost/${p}`),
  },
  registerPlugin: vi.fn((name) => mockPlugins[name]),
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

const InstalledApps = mockPlugins.InstalledApps;
const IncomingShare = mockPlugins.IncomingShare;
const TransferNotification = mockPlugins.TransferNotification;
const NearbyDiscovery = mockPlugins.NearbyDiscovery;
const FolderPicker = mockPlugins.FolderPicker;
const WifiDirect = mockPlugins.WifiDirect;
const LocalSignaling = mockPlugins.LocalSignaling;

// Minimal fetch/File shim so functions that route through
// Capacitor.convertFileSrc() + fetch() can be exercised without a real network.
beforeEach(() => {
  document.documentElement.classList.remove('native-app');
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'])) })
  );
});

describe('native.js — native path', () => {
  it('triggerHaptic() calls Haptics.impact with the given style', () => {
    native.triggerHaptic('HEAVY');
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'HEAVY' });
  });

  it('triggerHaptic() and triggerSuccessHaptic() respect novashare_haptics = false setting', () => {
    localStorage.setItem('novashare_haptics', 'false');
    native.triggerHaptic();
    native.triggerSuccessHaptic();
    expect(Haptics.impact).not.toHaveBeenCalled();
    localStorage.removeItem('novashare_haptics');
  });

  it('triggerHaptic() swallows Haptics.impact rejections', async () => {
    Haptics.impact.mockReturnValueOnce(Promise.reject(new Error('fail')));
    expect(() => native.triggerHaptic()).not.toThrow();
  });

  it('listInstalledApps() calls through and returns .apps', async () => {
    InstalledApps.listInstalledApps = vi.fn(() => Promise.resolve({ apps: [{ packageName: 'a' }] }));
    await expect(native.listInstalledApps()).resolves.toEqual([{ packageName: 'a' }]);
    expect(InstalledApps.listInstalledApps).toHaveBeenCalled();
  });

  it('getAppIcon() passes {packageName} and returns .icon', async () => {
    InstalledApps.getAppIcon = vi.fn(() => Promise.resolve({ icon: 'data:image/png;base64,xyz' }));
    await expect(native.getAppIcon('com.example.app')).resolves.toBe('data:image/png;base64,xyz');
    expect(InstalledApps.getAppIcon).toHaveBeenCalledWith({ packageName: 'com.example.app' });
  });

  it('getAppApkFile() fetches the cache path and returns a named File', async () => {
    InstalledApps.getApkCachePath = vi.fn(() => Promise.resolve({ path: '/cache/app.apk' }));
    const file = await native.getAppApkFile('com.example.app', 'My App', '1.2.3');
    expect(InstalledApps.getApkCachePath).toHaveBeenCalledWith({ packageName: 'com.example.app' });
    expect(file.name).toBe('My_App-1.2.3.apk');
    expect(file.type).toBe('application/vnd.android.package-archive');
  });

  it('clearApkCache() calls through and swallows rejections', async () => {
    InstalledApps.clearApkCache = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.clearApkCache()).resolves.toBeUndefined();
    expect(InstalledApps.clearApkCache).toHaveBeenCalled();
  });

  it('getPendingSharedFiles() calls through and returns .files', async () => {
    IncomingShare.getPendingFiles = vi.fn(() => Promise.resolve({ files: [{ name: 'a.txt' }] }));
    await expect(native.getPendingSharedFiles()).resolves.toEqual([{ name: 'a.txt' }]);
  });

  it('onSharedFilesReceived() registers a listener and unsubscribes via .remove()', async () => {
    const remove = vi.fn();
    IncomingShare.addListener = vi.fn((event, cb) => {
      expect(event).toBe('sharedFilesReceived');
      cb({ files: [{ name: 'b.txt' }] });
      return Promise.resolve({ remove });
    });
    const callback = vi.fn();
    const unsub = native.onSharedFilesReceived(callback);
    await Promise.resolve();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith([{ name: 'b.txt' }]);
    unsub();
    expect(remove).toHaveBeenCalled();
  });

  it('sharedEntryToFile() converts an entry into a File', async () => {
    const file = await native.sharedEntryToFile({ path: '/cache/x', name: 'x.txt', mimeType: 'text/plain' });
    expect(file.name).toBe('x.txt');
    expect(file.type).toBe('text/plain');
  });

  it('pickFolder() calls through and maps entries into Files with webkitRelativePath', async () => {
    FolderPicker.pickFolder = vi.fn(() =>
      Promise.resolve({
        files: [{ path: '/cache/f1', name: 'f1.txt', relativePath: 'folder/f1.txt', mimeType: 'text/plain' }],
      })
    );
    const files = await native.pickFolder();
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('f1.txt');
    expect(files[0].webkitRelativePath).toBe('folder/f1.txt');
  });

  it('pushTransferNotification() calls TransferNotification.update with rounded progress', async () => {
    TransferNotification.update = vi.fn(() => Promise.resolve());
    await native.pushTransferNotification('title', 'text', 42.7);
    expect(TransferNotification.update).toHaveBeenCalledWith({
      title: 'title',
      text: 'text',
      progress: 43,
      indeterminate: false,
    });
  });

  it('pushTransferNotification() swallows rejections', async () => {
    TransferNotification.update = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.pushTransferNotification('t', 'x', 1)).resolves.toBeUndefined();
  });

  it('stopTransferNotification() calls through and swallows rejections', async () => {
    TransferNotification.stop = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.stopTransferNotification()).resolves.toBeUndefined();
    expect(TransferNotification.stop).toHaveBeenCalled();
  });

  it('startAdvertisingRoom() calls through with the room code/device name and swallows rejections', async () => {
    NearbyDiscovery.startAdvertising = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.startAdvertisingRoom('ABC123', 'device')).resolves.toBeUndefined();
    expect(NearbyDiscovery.startAdvertising).toHaveBeenCalledWith({ roomCode: 'ABC123', deviceName: 'device' });
  });

  it('stopAdvertisingRoom() calls through', async () => {
    NearbyDiscovery.stopAdvertising = vi.fn(() => Promise.resolve());
    await native.stopAdvertisingRoom();
    expect(NearbyDiscovery.stopAdvertising).toHaveBeenCalled();
  });

  it('startNearbyDiscovery() calls through', async () => {
    NearbyDiscovery.startDiscovery = vi.fn(() => Promise.resolve());
    await native.startNearbyDiscovery();
    expect(NearbyDiscovery.startDiscovery).toHaveBeenCalled();
  });

  it('stopNearbyDiscovery() calls through', async () => {
    NearbyDiscovery.stopDiscovery = vi.fn(() => Promise.resolve());
    await native.stopNearbyDiscovery();
    expect(NearbyDiscovery.stopDiscovery).toHaveBeenCalled();
  });

  it('onNearbyPeerFound() registers "peerFound" and unsubscribes via .remove()', async () => {
    const remove = vi.fn();
    let captured;
    NearbyDiscovery.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove });
    });
    const callback = vi.fn();
    const unsub = native.onNearbyPeerFound(callback);
    await Promise.resolve();
    expect(captured.event).toBe('peerFound');
    captured.cb({ roomCode: 'A', deviceName: 'd', host: '1.1.1.1' });
    expect(callback).toHaveBeenCalledWith({ roomCode: 'A', deviceName: 'd', host: '1.1.1.1' });
    unsub();
    expect(remove).toHaveBeenCalled();
  });

  it('onNearbyPeerLost() registers "peerLost" and unsubscribes via .remove()', async () => {
    const remove = vi.fn();
    let captured;
    NearbyDiscovery.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove });
    });
    const callback = vi.fn();
    const unsub = native.onNearbyPeerLost(callback);
    await Promise.resolve();
    expect(captured.event).toBe('peerLost');
    captured.cb({ roomCode: 'A' });
    expect(callback).toHaveBeenCalledWith({ roomCode: 'A' });
    unsub();
    expect(remove).toHaveBeenCalled();
  });

  it('isWifiDirectSupported() calls through and returns coerced boolean', async () => {
    WifiDirect.isSupported = vi.fn(() => Promise.resolve({ supported: 1 }));
    await expect(native.isWifiDirectSupported()).resolves.toBe(true);
  });

  it('isWifiDirectSupported() returns false if the plugin throws', async () => {
    WifiDirect.isSupported = vi.fn(() => Promise.reject(new Error('unsupported')));
    await expect(native.isWifiDirectSupported()).resolves.toBe(false);
  });

  it('wifiDirectInitialize() calls through', async () => {
    WifiDirect.initialize = vi.fn(() => Promise.resolve());
    await native.wifiDirectInitialize();
    expect(WifiDirect.initialize).toHaveBeenCalled();
  });

  it('wifiDirectDiscoverPeers() calls through', async () => {
    WifiDirect.discoverPeers = vi.fn(() => Promise.resolve());
    await native.wifiDirectDiscoverPeers();
    expect(WifiDirect.discoverPeers).toHaveBeenCalled();
  });

  it('wifiDirectStopDiscovery() calls through and swallows rejections', async () => {
    WifiDirect.stopDiscovery = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.wifiDirectStopDiscovery()).resolves.toBeUndefined();
  });

  it('wifiDirectConnect() passes {deviceAddress}', async () => {
    WifiDirect.connect = vi.fn(() => Promise.resolve());
    await native.wifiDirectConnect('aa:bb:cc');
    expect(WifiDirect.connect).toHaveBeenCalledWith({ deviceAddress: 'aa:bb:cc' });
  });

  it('wifiDirectCancelConnect() calls through and swallows rejections', async () => {
    WifiDirect.cancelConnect = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.wifiDirectCancelConnect()).resolves.toBeUndefined();
  });

  it('wifiDirectRequestGroupInfo() returns the plugin result directly', async () => {
    const info = { groupFormed: true, isGroupOwner: true, groupOwnerAddress: '192.168.49.1' };
    WifiDirect.requestGroupInfo = vi.fn(() => Promise.resolve(info));
    await expect(native.wifiDirectRequestGroupInfo()).resolves.toBe(info);
  });

  it('wifiDirectRemoveGroup() calls through and swallows rejections', async () => {
    WifiDirect.removeGroup = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.wifiDirectRemoveGroup()).resolves.toBeUndefined();
  });

  it('onWifiDirectPeersChanged() registers "peersChanged" and maps .peers', async () => {
    const remove = vi.fn();
    let captured;
    WifiDirect.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove });
    });
    const callback = vi.fn();
    const unsub = native.onWifiDirectPeersChanged(callback);
    await Promise.resolve();
    expect(captured.event).toBe('peersChanged');
    captured.cb({ peers: [{ deviceName: 'd1' }] });
    expect(callback).toHaveBeenCalledWith([{ deviceName: 'd1' }]);
    captured.cb({});
    expect(callback).toHaveBeenCalledWith([]);
    unsub();
    expect(remove).toHaveBeenCalled();
  });

  it('onWifiDirectConnectionChanged() registers "connectionChanged"', async () => {
    const remove = vi.fn();
    let captured;
    WifiDirect.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove });
    });
    const callback = vi.fn();
    const unsub = native.onWifiDirectConnectionChanged(callback);
    await Promise.resolve();
    expect(captured.event).toBe('connectionChanged');
    const data = { groupFormed: true, isGroupOwner: false, groupOwnerAddress: '1.2.3.4' };
    captured.cb(data);
    expect(callback).toHaveBeenCalledWith(data);
    unsub();
    expect(remove).toHaveBeenCalled();
  });

  it('localSignalingStartServer() calls through', async () => {
    LocalSignaling.startServer = vi.fn(() => Promise.resolve());
    await native.localSignalingStartServer();
    expect(LocalSignaling.startServer).toHaveBeenCalled();
  });

  it('localSignalingStopServer() calls through and swallows rejections', async () => {
    LocalSignaling.stopServer = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.localSignalingStopServer()).resolves.toBeUndefined();
  });

  it('localSignalingConnect() passes {ip, port} and returns connectionId', async () => {
    LocalSignaling.connectToServer = vi.fn(() => Promise.resolve({ connectionId: 'conn-1' }));
    await expect(native.localSignalingConnect('192.168.49.1', 8888)).resolves.toBe('conn-1');
    expect(LocalSignaling.connectToServer).toHaveBeenCalledWith({ ip: '192.168.49.1', port: 8888 });
  });

  it('localSignalingSend() JSON-stringifies the message', async () => {
    LocalSignaling.send = vi.fn(() => Promise.resolve());
    await native.localSignalingSend('conn-1', { type: 'offer', sdp: 'v=0' });
    expect(LocalSignaling.send).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      json: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
    });
  });

  it('localSignalingClose() calls through and swallows rejections', async () => {
    LocalSignaling.close = vi.fn(() => Promise.reject(new Error('fail')));
    await expect(native.localSignalingClose('conn-1')).resolves.toBeUndefined();
  });

  it('onLocalSignalingMessage() parses data.json and calls back with (connectionId, parsedMessage)', async () => {
    let captured;
    LocalSignaling.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove: vi.fn() });
    });
    const callback = vi.fn();
    native.onLocalSignalingMessage(callback);
    await Promise.resolve();
    expect(captured.event).toBe('message');
    captured.cb({ connectionId: 'conn-1', json: JSON.stringify({ type: 'answer' }) });
    expect(callback).toHaveBeenCalledWith('conn-1', { type: 'answer' });
  });

  it('onLocalSignalingMessage() silently swallows malformed JSON', async () => {
    let captured;
    LocalSignaling.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove: vi.fn() });
    });
    const callback = vi.fn();
    native.onLocalSignalingMessage(callback);
    await Promise.resolve();
    expect(() => captured.cb({ connectionId: 'conn-1', json: '{not valid json' })).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it('onLocalSignalingPeerConnected() calls back with connectionId', async () => {
    let captured;
    LocalSignaling.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove: vi.fn() });
    });
    const callback = vi.fn();
    native.onLocalSignalingPeerConnected(callback);
    await Promise.resolve();
    expect(captured.event).toBe('peerConnected');
    captured.cb({ connectionId: 'conn-2' });
    expect(callback).toHaveBeenCalledWith('conn-2');
  });

  it('onLocalSignalingPeerDisconnected() calls back with connectionId', async () => {
    let captured;
    LocalSignaling.addListener = vi.fn((event, cb) => {
      captured = { event, cb };
      return Promise.resolve({ remove: vi.fn() });
    });
    const callback = vi.fn();
    native.onLocalSignalingPeerDisconnected(callback);
    await Promise.resolve();
    expect(captured.event).toBe('peerDisconnected');
    captured.cb({ connectionId: 'conn-3' });
    expect(callback).toHaveBeenCalledWith('conn-3');
  });

  it('initNative() adds the native-app class and configures the StatusBar', () => {
    native.initNative();
    expect(document.documentElement.classList.contains('native-app')).toBe(true);
    expect(StatusBar.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    expect(StatusBar.setBackgroundColor).toHaveBeenCalledWith({ color: '#080c14' });
    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledWith({ overlay: false });
  });

  it('initNative() swallows StatusBar rejections', async () => {
    StatusBar.setStyle.mockReturnValueOnce(Promise.reject(new Error('fail')));
    expect(() => native.initNative()).not.toThrow();
  });
});
