# Graph Report - novashare  (2026-08-11)

## Corpus Check
- 67 files · ~80,688 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 500 nodes · 949 edges · 41 communities (36 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e0742202`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- AppsPanel.jsx
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
- receivedIndex.js
- computeSecurityCode
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- InstalledAppsPlugin
- CLAUDE.md
- rippleTap
- localSocketTransport.js
- AppUpdatePlugin
- crashLog.js
- HotspotPlugin
- clipboardSync.js
- connectivity.js

## God Nodes (most connected - your core abstractions)
1. `App()` - 70 edges
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

## Communities (41 total, 5 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.05
Nodes (37): cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, cross-env (+29 more)

### Community 1 - "AppsPanel.jsx"
Cohesion: 0.25
Nodes (11): AppIcon(), appIconCache, AppsPanel(), HighlightMatch(), clearApkCache(), getAppApkFile(), getAppIcon(), InstalledApps (+3 more)

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
Cohesion: 0.07
Nodes (73): App(), HOME_TAB_ORDER, ICE_SERVERS, NotifyDownload, sentFilesMemory, getAudioContext(), playCompletionChime(), FileThumbnail() (+65 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.23
Nodes (6): Intent, MainActivity, BridgeActivity, Bundle, SplashScreenView, Uri

### Community 9 - "WifiDirectPlugin"
Cohesion: 0.12
Nodes (7): Plugin, PluginCall, WifiManager, WifiDirectPlugin, BroadcastReceiver, IntentFilter, WifiP2pManager

### Community 10 - "JSObject"
Cohesion: 0.07
Nodes (21): FolderPickerPlugin, JSArray, Plugin, PluginCall, IncomingSharePlugin, JSArray, Plugin, PluginCall (+13 more)

### Community 11 - "TransferForegroundService"
Cohesion: 0.27
Nodes (5): Intent, TransferForegroundService, IBinder, Notification, Service

### Community 12 - "dependencies"
Cohesion: 0.05
Nodes (37): canvas-confetti, @capacitor/android, @capacitor/app, @capacitor/cli, @capacitor/core, @capacitor/device, @capacitor/filesystem, @capacitor/haptics (+29 more)

### Community 13 - "TransferNotificationPlugin"
Cohesion: 0.39
Nodes (3): Plugin, PluginCall, TransferNotificationPlugin

### Community 15 - "build-gallery.mjs"
Cohesion: 0.40
Nodes (3): A, cards, items

### Community 18 - "NearbyDiscoveryPlugin"
Cohesion: 0.23
Nodes (5): Plugin, PluginCall, NearbyDiscoveryPlugin, NsdManager, NsdServiceInfo

### Community 19 - "receivedIndex.js"
Cohesion: 0.60
Nodes (5): clearReceivedIndex(), hasReceived(), readAll(), recordReceived(), writeAll()

### Community 20 - "computeSecurityCode"
Cohesion: 0.83
Nodes (3): computeSecurityCode(), formatDigest(), simpleHashBytes()

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

### Community 32 - "InstalledAppsPlugin"
Cohesion: 0.25
Nodes (5): InstalledAppsPlugin, Plugin, PluginCall, Bitmap, Drawable

### Community 34 - "rippleTap"
Cohesion: 0.19
Nodes (19): ConnectPanel(), FolderQueueRow(), HistoryPanel(), SettingsPanel(), SwipeableFileRow(), SwipeableHistoryRow(), addHistoryEntry(), clearHistory() (+11 more)

### Community 35 - "localSocketTransport.js"
Cohesion: 0.14
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
Cohesion: 0.60
Nodes (5): addClip(), clearClips(), getClips(), readAll(), writeAll()

### Community 44 - "connectivity.js"
Cohesion: 0.32
Nodes (7): CACHE_TTL_MS, DEFAULT_PROBE_URL, isOnline(), probe(), PROBE_TIMEOUT_MS, resetConnectivityCache(), subscribeConnectivity()

## Knowledge Gaps
- **68 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+63 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App()` connect `App.jsx` to `rippleTap`, `localSocketTransport.js`, `crashLog.js`, `clipboardSync.js`, `dependencies`, `connectivity.js`, `receivedIndex.js`, `computeSecurityCode`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `devDependencies`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `@capacitor/app` connect `dependencies` to `App.jsx`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `App()` (e.g. with `sharedEntryToFile()` and `wifiDirectOpenLocationSettings()`) actually correct?**
  _`App()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `JSObject` (e.g. with `.checkForUpdate()` and `.handleOnActivityResult()`) actually correct?**
  _`JSObject` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _68 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._