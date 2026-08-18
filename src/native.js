import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';
import { arrayBufferToBase64, base64ToArrayBuffer } from './transferUtils';

const InstalledApps = registerPlugin('InstalledApps');
const IncomingShare = registerPlugin('IncomingShare');
const TransferNotification = registerPlugin('TransferNotification');
const NearbyDiscovery = registerPlugin('NearbyDiscovery');
const FolderPicker = registerPlugin('FolderPicker');
const WifiDirect = registerPlugin('WifiDirect');
const Hotspot = registerPlugin('Hotspot');
const LocalSignaling = registerPlugin('LocalSignaling');
const AppUpdate = registerPlugin('AppUpdate');
const RichContent = registerPlugin('RichContent');

// Fires a light haptic tick on real devices; no-op on web or when muted in settings.
export function triggerHaptic(style = ImpactStyle.Light) {
  if (!Capacitor.isNativePlatform()) return;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('novashare_haptics') === 'false') return;
  Haptics.impact({ style }).catch(() => {});
}

// The heavier "something finished" haptic pattern — used for transfer
// completion, distinct from the light tap feedback everywhere else.
export function triggerSuccessHaptic() {
  if (!Capacitor.isNativePlatform()) return;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('novashare_haptics') === 'false') return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

// Lists user-installed (non-system) packages via the native InstalledApps
// plugin. Web builds have no package manager, so this stays an empty list there.
export async function listInstalledApps() {
  if (!Capacitor.isNativePlatform()) return [];
  const { apps } = await InstalledApps.listInstalledApps();
  return apps;
}

// Fetches one app's launcher icon as a data: URI, lazily and one at a time
// per row so hundreds of installed apps don't all decode/encode up front.
export async function getAppIcon(packageName) {
  if (!Capacitor.isNativePlatform()) return null;
  const { icon } = await InstalledApps.getAppIcon({ packageName });
  return icon;
}

// Has the native side copy the installed package's own APK into the app's
// cache dir (plain file copy, no base64), then loads it through the webview's
// own local-resource URL so fetch() hands back a real Blob with none of the
// bridge JSON / base64 encode-decode overhead a chunked read would carry.
export async function getAppApkFile(packageName, appName, versionName) {
  const { path } = await InstalledApps.getApkCachePath({ packageName });
  const response = await fetch(Capacitor.convertFileSrc(path));
  const blob = await response.blob();

  const safeName = (appName || packageName).replace(/[^a-z0-9_-]+/gi, '_');
  const fileName = `${safeName}${versionName ? '-' + versionName : ''}.apk`;
  return new File([blob], fileName, { type: 'application/vnd.android.package-archive' });
}

// Deletes any APKs the native side staged into cache for sharing. Safe to
// call any time after the Files above have been built — they already hold
// their own copy of the bytes independent of the cached file on disk.
export async function clearApkCache() {
  if (!Capacitor.isNativePlatform()) return;
  await InstalledApps.clearApkCache().catch(() => {});
}

// Drains any share-sheet files MainActivity staged into cache before the
// webview was ready (cold start into NovaShare via another app's Share menu).
export async function getPendingSharedFiles() {
  if (!Capacitor.isNativePlatform()) return [];
  const { files } = await IncomingShare.getPendingFiles();
  return files;
}

// Fires for share-sheet files that arrive while the app is already running
// (Android onNewIntent). Returns an unsubscribe function.
export function onSharedFilesReceived(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  IncomingShare.addListener('sharedFilesReceived', (data) => callback(data.files || [])).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Turns a native cache-copied share entry ({path, name, size, mimeType}) into
// a browser File via the same convertFileSrc()+fetch() trick used for shared
// APKs, so it drops straight into the existing selectedFiles send queue.
export async function sharedEntryToFile(entry) {
  const response = await fetch(Capacitor.convertFileSrc(entry.path));
  const blob = await response.blob();
  return new File([blob], entry.name, { type: entry.mimeType || blob.type || 'application/octet-stream' });
}

// Android WebView ignores <input webkitdirectory> (opens a plain content
// picker with no folder browsing), so real folder selection goes through a
// native Storage Access Framework picker instead. Returns real Files with
// webkitRelativePath set (a plain writable prop on File — nothing browser-
// enforced about it) so the existing folder-structure send code just works.
export async function pickFolder() {
  if (!Capacitor.isNativePlatform()) return [];
  const { files } = await FolderPicker.pickFolder();
  return Promise.all(files.map(async (entry) => {
    const response = await fetch(Capacitor.convertFileSrc(entry.path));
    const blob = await response.blob();
    const file = new File([blob], entry.name, { type: entry.mimeType || blob.type || 'application/octet-stream' });
    Object.defineProperty(file, 'webkitRelativePath', { value: entry.relativePath, configurable: true });
    return file;
  }));
}

// Pushes/updates the persistent "transfer in progress" notification via a
// foreground Service, so Android doesn't throttle or kill the background
// WebView (and the WebRTC data channels riding on it) once the app is
// minimized mid-transfer. First call also starts the service; later calls
// just update its notification content in place.
export async function pushTransferNotification(title, text, progress, indeterminate = false) {
  if (!Capacitor.isNativePlatform()) return;
  await TransferNotification.update({ title, text, progress: Math.round(progress), indeterminate }).catch(() => {});
}

export async function stopTransferNotification() {
  if (!Capacitor.isNativePlatform()) return;
  await TransferNotification.stop().catch(() => {});
}

// --- Nearby-device discovery (Android NSD over the local Wi-Fi network) ---
// Advertise: a sender with an open room broadcasts its room code so nearby
// receivers can find and join it with no code entry / QR scan. Discover: a
// receiver browses for those broadcasts. Both are no-ops on web/desktop —
// callers should treat an empty peer list there as expected, not an error.
export async function startAdvertisingRoom(roomCode, deviceName, deviceId) {
  if (!Capacitor.isNativePlatform()) return;
  await NearbyDiscovery.startAdvertising({ roomCode, deviceName, deviceId }).catch(() => {});
}

export async function stopAdvertisingRoom() {
  if (!Capacitor.isNativePlatform()) return;
  await NearbyDiscovery.stopAdvertising().catch(() => {});
}

export async function startNearbyDiscovery() {
  if (!Capacitor.isNativePlatform()) return;
  await NearbyDiscovery.startDiscovery().catch(() => {});
}

export async function stopNearbyDiscovery() {
  if (!Capacitor.isNativePlatform()) return;
  await NearbyDiscovery.stopDiscovery().catch(() => {});
}

// Fires with { roomCode, deviceName, host } as peers appear/disappear on the
// local network. Returns an unsubscribe function; no-op pair on web.
export function onNearbyPeerFound(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  NearbyDiscovery.addListener('peerFound', (data) => callback(data)).then((h) => { handle = h; });
  return () => handle?.remove();
}

export function onNearbyPeerLost(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  NearbyDiscovery.addListener('peerLost', (data) => callback(data)).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Best-effort human-readable device label for advertising (real "device
// model name" isn't exposed to a webview) — falls back to a stable-ish
// per-install label so a user can still tell devices apart in the list.
export function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  const match = ua.match(/;\s*([^;)]+?)\s*Build\//);
  return match ? match[1] : 'NovaShare device';
}

// Opens the native share sheet with plain text (used for sending an error
// report to us). Falls back to the Web Share API, then the clipboard, so it
// still works in a browser tab during development.
export async function shareText(text, title) {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title, text });
  } else if (navigator.share) {
    await navigator.share({ title, text });
  } else {
    await navigator.clipboard.writeText(text);
  }
}

// --- Wi-Fi Direct (fully offline device-to-device: no router, no internet,
// no pre-existing shared network needed — one phone becomes the group owner
// at a fixed local IP, the other joins directly). Pairs with LocalSignaling
// below to negotiate a manual WebRTC connection over that link. ---
export async function isWifiDirectSupported() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { supported } = await WifiDirect.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

export async function wifiDirectInitialize() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.initialize();
}

export async function wifiDirectDiscoverPeers() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.discoverPeers();
}

export async function wifiDirectStopDiscovery() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.stopDiscovery().catch(() => {});
}

// Wi-Fi P2P peer discovery silently returns nothing (not an error) while
// system Location is off, regardless of the app's own permission grant —
// callers use this to show a clear "turn on Location" prompt and poll for
// it turning back on, instead of a discoverPeers() call quietly rejecting.
export async function wifiDirectIsLocationEnabled() {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const { enabled } = await WifiDirect.isLocationEnabled();
    return !!enabled;
  } catch {
    return true;
  }
}

export async function wifiDirectOpenLocationSettings() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.openLocationSettings().catch(() => {});
}

// Wi-Fi Direct rides the same radio as regular Wi-Fi — it needs zero
// internet/router, but the Wi-Fi toggle itself must be on. People often
// switch Wi-Fi off thinking that's unrelated ("I'm not using the internet"),
// which silently kills discovery. Same poll-and-banner pattern as Location.
export async function wifiDirectIsWifiEnabled() {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const { enabled } = await WifiDirect.isWifiEnabled();
    return !!enabled;
  } catch {
    return true;
  }
}

export async function wifiDirectOpenWifiSettings() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.openWifiSettings().catch(() => {});
}

export async function wifiDirectConnect(deviceAddress) {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.connect({ deviceAddress });
}

export async function wifiDirectCancelConnect() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.cancelConnect().catch(() => {});
}

export async function wifiDirectRequestGroupInfo() {
  if (!Capacitor.isNativePlatform()) return { groupFormed: false, isGroupOwner: false, groupOwnerAddress: '' };
  return WifiDirect.requestGroupInfo();
}

export async function wifiDirectRemoveGroup() {
  if (!Capacitor.isNativePlatform()) return;
  await WifiDirect.removeGroup().catch(() => {});
}

// Fires with { peers: [{deviceName, deviceAddress, status}] } whenever the
// nearby Wi-Fi Direct peer list changes. Returns an unsubscribe function.
export function onWifiDirectPeersChanged(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  WifiDirect.addListener('peersChanged', (data) => callback(data.peers || [])).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Fires with { groupFormed, isGroupOwner, groupOwnerAddress } whenever the
// Wi-Fi Direct connection state changes (group forms/dissolves).
export function onWifiDirectConnectionChanged(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  WifiDirect.addListener('connectionChanged', (data) => callback(data)).then((h) => { handle = h; });
  return () => handle?.remove();
}

// --- Hotspot fallback (for when Wi-Fi Direct's WifiP2pManager connect fails
// outright — known-flaky on several OEMs). One device opens a LocalOnlyHotspot
// and the other joins it programmatically; both ends then talk over
// LocalSignaling exactly as the Wi-Fi Direct path does, just addressed at the
// resolved hotspot gateway IP instead of Wi-Fi Direct's fixed group-owner
// address. See HotspotPlugin.kt for the native implementation notes and the
// "not verified on real hardware" caveat. ---
export async function isHotspotSupported() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { supported } = await Hotspot.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

export async function hotspotStart() {
  if (!Capacitor.isNativePlatform()) throw new Error('Hotspot fallback requires native platform');
  return Hotspot.startHotspot();
}

export async function hotspotStop() {
  if (!Capacitor.isNativePlatform()) return;
  await Hotspot.stopHotspot().catch(() => {});
}

export async function hotspotJoin(ssid, passphrase) {
  if (!Capacitor.isNativePlatform()) throw new Error('Hotspot fallback requires native platform');
  return Hotspot.joinHotspot({ ssid, passphrase });
}

export async function hotspotLeave() {
  if (!Capacitor.isNativePlatform()) return;
  await Hotspot.leaveHotspot().catch(() => {});
}

// Fires if the OS tears down a hotspot this device is hosting or has joined
// outside of our own stopHotspot()/leaveHotspot() calls (e.g. the user
// manually disables Wi-Fi). Returns an unsubscribe function.
export function onHotspotLost(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  Hotspot.addListener('hotspotStopped', () => callback()).then((h) => { handle = h; });
  return () => handle?.remove();
}

// --- Local signaling (raw socket byte-pipe over the Wi-Fi Direct link) ---
// Carries exactly one WebRTC SDP offer/answer plus trickle ICE candidates
// between the two devices with no internet-reachable broker involved. The
// group owner starts the server and waits; the other side connects to it.
export async function localSignalingStartServer() {
  if (!Capacitor.isNativePlatform()) throw new Error('Local signaling requires native platform');
  await LocalSignaling.startServer();
}

export async function localSignalingStopServer() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalSignaling.stopServer().catch(() => {});
}

export async function localSignalingConnect(ip, port) {
  if (!Capacitor.isNativePlatform()) throw new Error('Local signaling requires native platform');
  const { connectionId } = await LocalSignaling.connectToServer({ ip, port });
  return connectionId;
}

export async function localSignalingSend(connectionId, message) {
  if (!Capacitor.isNativePlatform()) return;
  await LocalSignaling.send({ connectionId, json: JSON.stringify(message) });
}

// Same as localSignalingSend, but for a caller that already has the JSON
// string in hand (LocalSocketChannel.send, mirroring RTCDataChannel.send()'s
// string-or-ArrayBuffer contract) — skips a pointless parse/re-stringify.
export async function localSignalingSendRaw(connectionId, jsonString) {
  if (!Capacitor.isNativePlatform()) return;
  await LocalSignaling.send({ connectionId, json: jsonString });
}

// Raw file-chunk bytes over the same socket connection, tagged as a binary
// frame on the native side (see LocalSignalingServerPlugin's frame format) —
// this is the actual transfer path for Wi-Fi Direct/hotspot sends now, not
// just SDP/ICE signaling (see localSocketTransport.js).
export async function localSignalingSendBinary(connectionId, arrayBuffer) {
  if (!Capacitor.isNativePlatform()) return;
  await LocalSignaling.sendBinary({ connectionId, data: arrayBufferToBase64(arrayBuffer) });
}

export async function localSignalingClose(connectionId) {
  if (!Capacitor.isNativePlatform()) return;
  await LocalSignaling.close({ connectionId }).catch(() => {});
}

// --- Keyboard rich content (Gboard GIF/sticker/image insertion) ---
// Fires with a File whenever the IME commits an image into a focused input.
// It arrives base64-encoded because Capacitor bridge payloads are JSON, then
// gets rebuilt into a real File so callers can hand it to the same send paths
// a file-picker selection uses.
export function onRichContentImage(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  RichContent.addListener('imageCommitted', (data) => {
    try {
      const buf = base64ToArrayBuffer(data.data);
      callback(new File([buf], data.name || 'image', { type: data.mime || 'image/*' }));
    } catch {
      // Undecodable payload — drop it rather than surfacing a broken attachment.
    }
  }).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Fires with (connectionId, parsedMessage) as signaling frames arrive.
export function onLocalSignalingMessage(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  LocalSignaling.addListener('message', (data) => {
    try {
      callback(data.connectionId, JSON.parse(data.json));
    } catch {
      // Malformed frame — ignore, the sender will just time out on its side.
    }
  }).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Fires with { connectionId } when the other device's socket connects.
export function onLocalSignalingPeerConnected(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  LocalSignaling.addListener('peerConnected', (data) => callback(data.connectionId)).then((h) => { handle = h; });
  return () => handle?.remove();
}

export function onLocalSignalingPeerDisconnected(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  LocalSignaling.addListener('peerDisconnected', (data) => callback(data.connectionId)).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Fires with (connectionId, ArrayBuffer) as binary chunk frames arrive.
export function onLocalSignalingBinaryMessage(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  LocalSignaling.addListener('binaryMessage', (data) => {
    callback(data.connectionId, base64ToArrayBuffer(data.data));
  }).then((h) => { handle = h; });
  return () => handle?.remove();
}

// --- In-app update (Play Core flexible flow) ---
// Reads Play Store's cached update info; cheap enough to call on every
// foreground. downloadedPending covers the case where a flexible download
// finished in a previous session and is still waiting to be installed.
export async function checkForAppUpdate() {
  if (!Capacitor.isNativePlatform()) return { updateAvailable: false };
  return AppUpdate.checkForUpdate();
}

// Opens Play Store's own consent sheet and, if accepted, starts the
// background download. Resolves once the user responds to the sheet —
// download/install progress arrives separately via onAppUpdateStateChanged.
export async function startFlexibleAppUpdate() {
  if (!Capacitor.isNativePlatform()) throw new Error('In-app update requires native platform');
  return AppUpdate.startFlexibleUpdate();
}

// Installs a fully-downloaded update and restarts the app. Only call this
// from an explicit user action (e.g. tapping "Restart now").
export async function completeFlexibleAppUpdate() {
  if (!Capacitor.isNativePlatform()) return;
  await AppUpdate.completeFlexibleUpdate();
}

// Fires with { status, bytesDownloaded, totalBytesToDownload } as the
// download progresses; status is one of PENDING/DOWNLOADING/DOWNLOADED/
// INSTALLING/INSTALLED/FAILED/CANCELED.
export function onAppUpdateStateChanged(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  AppUpdate.addListener('downloadStateChanged', (data) => callback(data)).then((h) => { handle = h; });
  return () => handle?.remove();
}

// Battery-aware throttle (feature): batteryLevel is 0-1 (null if the
// platform can't report it, e.g. desktop web) — callers treat null as
// "unknown, don't auto-throttle" rather than assuming 0%.
export async function getBatteryInfo() {
  if (!Capacitor.isNativePlatform()) return { batteryLevel: null, isCharging: false };
  try {
    const { batteryLevel, isCharging } = await Device.getBatteryInfo();
    return { batteryLevel: typeof batteryLevel === 'number' ? batteryLevel : null, isCharging: !!isCharging };
  } catch {
    return { batteryLevel: null, isCharging: false };
  }
}

// Real installed version/build, for the Settings "About" row — falls back to
// nulls (caller keeps its hardcoded display string) rather than guessing.
export async function getAppVersion() {
  if (!Capacitor.isNativePlatform()) return { version: null, build: null };
  try {
    const { version, build } = await App.getInfo();
    return { version: version || null, build: build || null };
  } catch {
    return { version: null, build: null };
  }
}

// Stable per-install device ID, generated once and reused — lets a peer be
// recognized as "the same device" across sessions (e.g. filtering yourself
// out of your own nearby-device broadcast) instead of looking new every launch.
export function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem('novashare-device-id');
    if (existing) return existing;
    const id = `nd_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem('novashare-device-id', id);
    return id;
  } catch {
    return `nd_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function initNative() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('native-app');

  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#080c14' }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
}
