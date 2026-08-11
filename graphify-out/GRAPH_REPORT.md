# Graph Report - novashare  (2026-08-10)

## Corpus Check
- 85 files · ~107,354 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 560 nodes · 1081 edges · 45 communities (40 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3fd4a1fa`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- localSocketTransport.test.js
- gen-icons.mjs
- ExampleInstrumentedTest.java
- Privacy Policy for NovaShare
- App.jsx
- ExampleUnitTest.java
- gradlew
- MainActivity
- WifiDirectPlugin
- JSObject
- TransferForegroundService
- dependencies
- TransferNotificationPlugin
- gen-feature-graphics-batch.mjs
- build-gallery.mjs
- NearbyDiscoveryPlugin
- App.receiver.test.jsx
- computeSecurityCode
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- .folderPickerResult
- CLAUDE.md
- rippleTap
- localSocketTransport.js
- AppUpdatePlugin
- crashLog.js
- HotspotPlugin
- clipboardSync.js
- App.native-receive.test.jsx
- connectivity.js
- App.auto-transport.test.jsx

## God Nodes (most connected - your core abstractions)
1. `App()` - 74 edges
2. `WifiDirectPlugin` - 32 edges
3. `rippleTap()` - 18 edges
4. `WifiDirect` - 15 edges
5. `HotspotPlugin` - 14 edges
6. `LocalSignalingServerPlugin` - 14 edges
7. `NearbyDiscoveryPlugin` - 12 edges
8. `LocalSignaling` - 12 edges
9. `triggerHaptic()` - 11 edges
10. `AppUpdatePlugin` - 9 edges

## Surprising Connections (you probably didn't know these)
- `App()` --references--> `@capacitor/app`  [EXTRACTED]
  src/App.jsx → package.json
- `App()` --calls--> `addClip()`  [EXTRACTED]
  src/App.jsx → src/clipboardSync.js
- `App()` --calls--> `isOnline()`  [EXTRACTED]
  src/App.jsx → src/connectivity.js
- `App()` --calls--> `subscribeConnectivity()`  [EXTRACTED]
  src/App.jsx → src/connectivity.js
- `App()` --calls--> `recordError()`  [EXTRACTED]
  src/App.jsx → src/crashLog.js

## Import Cycles
- None detected.

## Communities (45 total, 5 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.05
Nodes (39): cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, jsdom, devDependencies (+31 more)

### Community 1 - "localSocketTransport.test.js"
Cohesion: 0.40
Nodes (3): connectAsOwner(), emitMessage(), state

### Community 2 - "gen-icons.mjs"
Cohesion: 0.40
Nodes (5): adaptiveSizes, legacySizes, markSvg(), RES, run()

### Community 3 - "ExampleInstrumentedTest.java"
Cohesion: 0.60
Nodes (3): ExampleInstrumentedTest, Test, RunWith

### Community 4 - "Privacy Policy for NovaShare"
Cohesion: 0.22
Nodes (8): Changes to This Policy, Children's Privacy, Contact, Data Retention, Privacy Policy for NovaShare, Third-Party Services, What the App Accesses (and Why), What We Do NOT Do

### Community 5 - "App.jsx"
Cohesion: 0.08
Nodes (67): App(), HOME_TAB_ORDER, ICE_SERVERS, NotifyDownload, sentFilesMemory, getAudioContext(), playCompletionChime(), FileThumbnail() (+59 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.29
Nodes (5): Intent, MainActivity, BridgeActivity, Bundle, Uri

### Community 9 - "WifiDirectPlugin"
Cohesion: 0.12
Nodes (7): Plugin, PluginCall, WifiManager, WifiDirectPlugin, BroadcastReceiver, IntentFilter, WifiP2pManager

### Community 10 - "JSObject"
Cohesion: 0.07
Nodes (20): IncomingSharePlugin, JSArray, Plugin, PluginCall, InstalledAppsPlugin, Plugin, PluginCall, Plugin (+12 more)

### Community 11 - "TransferForegroundService"
Cohesion: 0.27
Nodes (5): Intent, TransferForegroundService, IBinder, Notification, Service

### Community 12 - "dependencies"
Cohesion: 0.04
Nodes (48): canvas-confetti, @capacitor/android, @capacitor/app, @capacitor/cli, @capacitor/core, @capacitor/device, @capacitor/filesystem, @capacitor/haptics (+40 more)

### Community 13 - "TransferNotificationPlugin"
Cohesion: 0.39
Nodes (3): Plugin, PluginCall, TransferNotificationPlugin

### Community 15 - "build-gallery.mjs"
Cohesion: 0.40
Nodes (3): A, cards, items

### Community 18 - "NearbyDiscoveryPlugin"
Cohesion: 0.23
Nodes (5): Plugin, PluginCall, NearbyDiscoveryPlugin, NsdManager, NsdServiceInfo

### Community 19 - "App.receiver.test.jsx"
Cohesion: 0.33
Nodes (6): { FakePeer, getCreatedPeers, getCreatedConns, resetFakePeerState }, clearReceivedIndex(), hasReceived(), readAll(), recordReceived(), writeAll()

### Community 20 - "computeSecurityCode"
Cohesion: 0.70
Nodes (3): computeSecurityCode(), formatDigest(), simpleHashBytes()

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

### Community 32 - ".folderPickerResult"
Cohesion: 0.27
Nodes (6): FolderPickerPlugin, JSArray, Plugin, PluginCall, androidx, DocumentFile

### Community 34 - "rippleTap"
Cohesion: 0.08
Nodes (33): { FakePeer }, AppIcon(), appIconCache, AppsPanel(), ConnectPanel(), FolderQueueRow(), HighlightMatch(), HistoryPanel() (+25 more)

### Community 35 - "localSocketTransport.js"
Cohesion: 0.13
Nodes (17): establishLocalSocketConnection(), LOCAL_SIGNALING_PORT, LocalSocketChannel, startLocalSocketRoomHost(), LocalSignaling, localSignalingClose(), localSignalingConnect(), localSignalingSend() (+9 more)

### Community 38 - "AppUpdatePlugin"
Cohesion: 0.20
Nodes (5): AppUpdatePlugin, Intent, Plugin, PluginCall, AppUpdateManager

### Community 39 - "crashLog.js"
Cohesion: 0.20
Nodes (10): clearCrashLog(), formatCrashLogForShare(), getCrashLog(), installGlobalErrorHandlers(), readEntries(), recordError(), writeEntries(), ErrorBoundary (+2 more)

### Community 40 - "HotspotPlugin"
Cohesion: 0.21
Nodes (6): HotspotPlugin, Plugin, PluginCall, WifiManager, ConnectivityManager, Network

### Community 42 - "clipboardSync.js"
Cohesion: 0.62
Nodes (5): addClip(), clearClips(), getClips(), readAll(), writeAll()

### Community 43 - "App.native-receive.test.jsx"
Cohesion: 0.27
Nodes (7): { FakePeer, getCreatedPeers, getCreatedConns, resetFakePeerState }, { mockNotifyDownload }, clearCheckpoint(), getCheckpoint(), read(), saveCheckpoint(), write()

### Community 44 - "connectivity.js"
Cohesion: 0.36
Nodes (7): CACHE_TTL_MS, DEFAULT_PROBE_URL, isOnline(), probe(), PROBE_TIMEOUT_MS, resetConnectivityCache(), subscribeConnectivity()

### Community 45 - "App.auto-transport.test.jsx"
Cohesion: 0.25
Nodes (5): { FakePeer }, { isOnlineMock, connectivityListeners }, makeFile(), { nativeMocks }, selectFiles()

## Knowledge Gaps
- **83 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+78 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App()` connect `App.jsx` to `rippleTap`, `localSocketTransport.js`, `crashLog.js`, `clipboardSync.js`, `App.native-receive.test.jsx`, `dependencies`, `connectivity.js`, `App.auto-transport.test.jsx`, `App.receiver.test.jsx`, `computeSecurityCode`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._
- **Why does `@capacitor/app` connect `dependencies` to `App.jsx`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `App()` (e.g. with `sharedEntryToFile()` and `wifiDirectOpenLocationSettings()`) actually correct?**
  _`App()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `JSObject` (e.g. with `.checkForUpdate()` and `.handleOnActivityResult()`) actually correct?**
  _`JSObject` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _83 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Should `App.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08144144144144144 - nodes in this community are weakly interconnected._