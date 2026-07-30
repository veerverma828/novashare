import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const InstalledApps = registerPlugin('InstalledApps');
const IncomingShare = registerPlugin('IncomingShare');
const TransferNotification = registerPlugin('TransferNotification');
const NearbyDiscovery = registerPlugin('NearbyDiscovery');
const FolderPicker = registerPlugin('FolderPicker');

// Fires a light haptic tick on real devices; no-op on web.
export function triggerHaptic(style = ImpactStyle.Light) {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style }).catch(() => {});
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
export async function startAdvertisingRoom(roomCode, deviceName) {
  if (!Capacitor.isNativePlatform()) return;
  await NearbyDiscovery.startAdvertising({ roomCode, deviceName }).catch(() => {});
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

export function initNative() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('native-app');

  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#080c14' }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
}
