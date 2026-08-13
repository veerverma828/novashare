# Graph Report - novashare  (2026-08-13)

## Corpus Check
- 71 files · ~85,051 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 568 nodes · 1102 edges · 47 communities (42 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5de2e8bb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- AppsPanel.jsx
- gen-icons.mjs
- ExampleInstrumentedTest.java
- Privacy Policy for NovaShare
- native.js
- transferUtils.js
- gradlew
- MainActivity
- WifiDirectPlugin
- TransferForegroundService
- dependencies
- TransferNotificationPlugin
- gen-feature-graphics-batch.mjs
- build-gallery.mjs
- NearbyDiscoveryPlugin
- receivedIndex.js
- computeSecurityCode
- transferState.js
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- playCompletionChime
- CLAUDE.md
- rippleTap
- localSocketTransport.js
- App.jsx
- AppUpdatePlugin
- JSObject
- crashLog.js
- InstalledAppsPlugin
- clipboardSync.js
- connectivity.js
- FolderPickerPlugin.kt
- HotspotPlugin
- onLocalSignalingBinaryMessage

## God Nodes (most connected - your core abstractions)
1. `App()` - 67 edges
2. `WifiDirectPlugin` - 32 edges
3. `rippleTap()` - 19 edges
4. `LocalSignalingServerPlugin` - 16 edges
5. `triggerHaptic()` - 15 edges
6. `HotspotPlugin` - 14 edges
7. `NearbyDiscoveryPlugin` - 12 edges
8. `AppUpdatePlugin` - 10 edges
9. `WifiManager` - 10 edges
10. `NotifyDownloadPlugin` - 10 edges

## Surprising Connections (you probably didn't know these)
- `App()` --indirect_call--> `sharedEntryToFile()`  [INFERRED]
  src/App.jsx → src/native.js
- `WifiDirectPlugin` --references--> `WifiManager`  [EXTRACTED]
  android/app/src/main/java/com/veer/novashare/WifiDirectPlugin.kt → android/app/src/main/java/com/veer/novashare/HotspotPlugin.kt
- `App()` --calls--> `addClip()`  [EXTRACTED]
  src/App.jsx → src/clipboardSync.js
- `App()` --calls--> `playCompletionChime()`  [EXTRACTED]
  src/App.jsx → src/completionChime.js
- `App()` --calls--> `isOnline()`  [EXTRACTED]
  src/App.jsx → src/connectivity.js

## Import Cycles
- None detected.

## Communities (47 total, 5 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.05
Nodes (37): cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, cross-env (+29 more)

### Community 1 - "AppsPanel.jsx"
Cohesion: 0.24
Nodes (10): AppIcon(), appIconCache, AppsPanel(), HighlightMatch(), clearApkCache(), getAppApkFile(), getAppIcon(), listInstalledApps() (+2 more)

### Community 2 - "gen-icons.mjs"
Cohesion: 0.40
Nodes (5): adaptiveSizes, legacySizes, markSvg(), RES, run()

### Community 3 - "ExampleInstrumentedTest.java"
Cohesion: 0.31
Nodes (5): ExampleInstrumentedTest, ExampleUnitTest, android.content.Context, org.junit.runner.RunWith, org.junit.Test

### Community 4 - "Privacy Policy for NovaShare"
Cohesion: 0.22
Nodes (8): Changes to This Policy, Children's Privacy, Contact, Data Retention, Privacy Policy for NovaShare, Third-Party Services, What the App Accesses (and Why), What We Do NOT Do

### Community 5 - "native.js"
Cohesion: 0.08
Nodes (39): App(), AppUpdate, checkForAppUpdate(), completeFlexibleAppUpdate(), FolderPicker, getBatteryInfo(), getDeviceLabel(), getPendingSharedFiles() (+31 more)

### Community 6 - "transferUtils.js"
Cohesion: 0.16
Nodes (14): ChatMessageItem(), FileThumbnail(), ICON_BY_TYPE, localSignalingSendBinary(), arrayBufferToBase64(), computeFileHash(), extractHotspotCredentials(), extractRoomCode() (+6 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.23
Nodes (8): Intent, MainActivity, AnimatorListenerAdapter, Animator, BridgeActivity, Bundle, SplashScreenView, Uri

### Community 9 - "WifiDirectPlugin"
Cohesion: 0.08
Nodes (12): Intent, Plugin, PluginCall, WifiDirectPlugin, WifiP2pManager, WifiP2pManager, WifiP2pManager, BroadcastReceiver (+4 more)

### Community 11 - "TransferForegroundService"
Cohesion: 0.36
Nodes (5): Intent, TransferForegroundService, IBinder, Notification, Service

### Community 12 - "dependencies"
Cohesion: 0.05
Nodes (37): @capacitor/android, @capacitor/app, @capacitor/cli, @capacitor/core, @capacitor/device, @capacitor/filesystem, @capacitor/haptics, @capacitor/keyboard (+29 more)

### Community 13 - "TransferNotificationPlugin"
Cohesion: 0.44
Nodes (3): Plugin, PluginCall, TransferNotificationPlugin

### Community 15 - "build-gallery.mjs"
Cohesion: 0.50
Nodes (4): A, cards, items, read()

### Community 18 - "NearbyDiscoveryPlugin"
Cohesion: 0.13
Nodes (8): Plugin, PluginCall, NearbyDiscoveryPlugin, NsdManager, NsdManager, NsdManager, NsdManager, NsdServiceInfo

### Community 19 - "receivedIndex.js"
Cohesion: 0.60
Nodes (5): clearReceivedIndex(), hasReceived(), readAll(), recordReceived(), writeAll()

### Community 20 - "computeSecurityCode"
Cohesion: 0.83
Nodes (3): computeSecurityCode(), formatDigest(), simpleHashBytes()

### Community 26 - "transferState.js"
Cohesion: 0.60
Nodes (5): clearCheckpoint(), getCheckpoint(), read(), saveCheckpoint(), write()

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

### Community 34 - "rippleTap"
Cohesion: 0.17
Nodes (21): ChatReactionPicker(), QUICK_EMOJIS, ConnectPanel(), FolderQueueRow(), HistoryPanel(), SettingsPanel(), SwipeableFileRow(), SwipeableHistoryRow() (+13 more)

### Community 35 - "localSocketTransport.js"
Cohesion: 0.13
Nodes (13): establishLocalSocketConnection(), LOCAL_SIGNALING_PORT, LocalSocketChannel, startLocalSocketRoomHost(), localSignalingClose(), localSignalingConnect(), localSignalingSend(), localSignalingSendRaw() (+5 more)

### Community 36 - "App.jsx"
Cohesion: 0.12
Nodes (15): HOME_TAB_ORDER, ICE_SERVERS, NotifyDownload, sentFilesMemory, RoomCodeFlap(), TransferRing(), isWifiDirectSupported(), onNearbyPeerLost() (+7 more)

### Community 37 - "AppUpdatePlugin"
Cohesion: 0.26
Nodes (5): AppUpdatePlugin, Intent, Plugin, PluginCall, AppUpdateManager

### Community 38 - "JSObject"
Cohesion: 0.09
Nodes (18): IncomingSharePlugin, JSArray, Plugin, PluginCall, Conn, Plugin, PluginCall, LocalSignalingServerPlugin (+10 more)

### Community 39 - "crashLog.js"
Cohesion: 0.21
Nodes (10): clearCrashLog(), formatCrashLogForShare(), getCrashLog(), installGlobalErrorHandlers(), readEntries(), recordError(), writeEntries(), ErrorBoundary (+2 more)

### Community 40 - "InstalledAppsPlugin"
Cohesion: 0.33
Nodes (5): InstalledAppsPlugin, Plugin, PluginCall, Bitmap, Drawable

### Community 42 - "clipboardSync.js"
Cohesion: 0.60
Nodes (5): addClip(), clearClips(), getClips(), readAll(), writeAll()

### Community 44 - "connectivity.js"
Cohesion: 0.32
Nodes (7): CACHE_TTL_MS, DEFAULT_PROBE_URL, isOnline(), probe(), PROBE_TIMEOUT_MS, resetConnectivityCache(), subscribeConnectivity()

### Community 45 - "FolderPickerPlugin.kt"
Cohesion: 0.36
Nodes (6): FolderPickerPlugin, JSArray, Plugin, PluginCall, androidx, DocumentFile

### Community 46 - "HotspotPlugin"
Cohesion: 0.13
Nodes (11): HotspotPlugin, ConnectivityManager, WifiManager, Plugin, PluginCall, RichContentWebView, CapacitorWebView, Context (+3 more)

### Community 47 - "onLocalSignalingBinaryMessage"
Cohesion: 0.67
Nodes (3): onLocalSignalingBinaryMessage(), onRichContentImage(), base64ToArrayBuffer()

## Knowledge Gaps
- **80 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+75 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WifiDirectPlugin` connect `WifiDirectPlugin` to `HotspotPlugin`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `devDependencies`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `App()` connect `native.js` to `playCompletionChime`, `rippleTap`, `localSocketTransport.js`, `App.jsx`, `transferUtils.js`, `crashLog.js`, `clipboardSync.js`, `connectivity.js`, `onLocalSignalingBinaryMessage`, `receivedIndex.js`, `computeSecurityCode`, `transferState.js`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `App()` (e.g. with `sharedEntryToFile()` and `wifiDirectOpenLocationSettings()`) actually correct?**
  _`App()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _80 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `native.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07641196013289037 - nodes in this community are weakly interconnected._