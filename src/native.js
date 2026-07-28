import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const InstalledApps = registerPlugin('InstalledApps');

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

export function initNative() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add('native-app');

  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#080c14' }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});

  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      CapApp.exitApp();
    }
  });
}
