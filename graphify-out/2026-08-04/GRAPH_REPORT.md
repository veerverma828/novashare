# Graph Report - novashare  (2026-08-04)

## Corpus Check
- 52 files · ~78,322 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 380 nodes · 632 edges · 39 communities (33 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7ca86164`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- scripts
- gen-icons.mjs
- ExampleInstrumentedTest.java
- Privacy Policy for NovaShare
- App.jsx
- ExampleUnitTest.java
- gradlew
- MainActivity
- NotifyDownloadPlugin
- JSObject
- TransferForegroundService
- dependencies
- TransferNotificationPlugin
- gen-feature-graphics-batch.mjs
- build-gallery.mjs
- NearbyDiscoveryPlugin
- App.panels.test.jsx
- computeSecurityCode
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- .folderPickerResult
- CLAUDE.md
- WifiDirectPlugin
- PeerJsCompatDataConnection
- transferUtils.js

## God Nodes (most connected - your core abstractions)
1. `App()` - 39 edges
2. `WifiDirectPlugin` - 23 edges
3. `establishLocalConnection()` - 16 edges
4. `LocalSignalingServerPlugin` - 12 edges
5. `NearbyDiscoveryPlugin` - 12 edges
6. `WifiDirect` - 11 edges
7. `scripts` - 9 edges
8. `LocalSignaling` - 9 edges
9. `PeerJsCompatDataConnection` - 9 edges
10. `AppsPanel()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `App()` --references--> `@capacitor/app`  [EXTRACTED]
  src/App.jsx → package.json
- `FolderQueueRow()` --calls--> `formatBytes()`  [EXTRACTED]
  src/App.jsx → src/transferUtils.js
- `AppsPanel()` --calls--> `mapWithConcurrency()`  [EXTRACTED]
  src/App.jsx → src/transferUtils.js
- `App()` --calls--> `addHistoryEntry()`  [EXTRACTED]
  src/App.jsx → src/history.js
- `App()` --calls--> `clearHistory()`  [EXTRACTED]
  src/App.jsx → src/history.js

## Import Cycles
- None detected.

## Communities (39 total, 6 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.05
Nodes (39): cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, jsdom, devDependencies (+31 more)

### Community 1 - "scripts"
Cohesion: 0.14
Nodes (13): name, private, scripts, build, build:app, dev, lint, preview (+5 more)

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
Nodes (62): App(), AppIcon(), appIconCache, establishLocalConnection(), FolderQueueRow(), HighlightMatch(), ICE_SERVERS, NotifyDownload (+54 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.29
Nodes (5): Intent, MainActivity, BridgeActivity, Bundle, Uri

### Community 9 - "NotifyDownloadPlugin"
Cohesion: 0.38
Nodes (4): Plugin, PluginCall, NotifyDownloadPlugin, sanitizeRelPath()

### Community 10 - "JSObject"
Cohesion: 0.09
Nodes (15): IncomingSharePlugin, JSArray, Plugin, PluginCall, InstalledAppsPlugin, Plugin, PluginCall, Plugin (+7 more)

### Community 11 - "TransferForegroundService"
Cohesion: 0.27
Nodes (5): Intent, TransferForegroundService, IBinder, Notification, Service

### Community 12 - "dependencies"
Cohesion: 0.06
Nodes (31): canvas-confetti, @capacitor/android, @capacitor/app, @capacitor/cli, @capacitor/core, @capacitor/filesystem, @capacitor/haptics, @capacitor/splash-screen (+23 more)

### Community 13 - "TransferNotificationPlugin"
Cohesion: 0.39
Nodes (3): Plugin, PluginCall, TransferNotificationPlugin

### Community 15 - "build-gallery.mjs"
Cohesion: 0.40
Nodes (3): A, cards, items

### Community 18 - "NearbyDiscoveryPlugin"
Cohesion: 0.23
Nodes (5): Plugin, PluginCall, NearbyDiscoveryPlugin, NsdManager, NsdServiceInfo

### Community 19 - "App.panels.test.jsx"
Cohesion: 0.24
Nodes (13): AppsPanel(), HistoryPanel(), addHistoryEntry(), clearHistory(), getHistory(), readAll(), removeHistoryEntry(), writeAll() (+5 more)

### Community 20 - "computeSecurityCode"
Cohesion: 0.70
Nodes (3): computeSecurityCode(), formatDigest(), simpleHashBytes()

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

### Community 32 - ".folderPickerResult"
Cohesion: 0.27
Nodes (6): FolderPickerPlugin, JSArray, Plugin, PluginCall, androidx, DocumentFile

### Community 34 - "WifiDirectPlugin"
Cohesion: 0.17
Nodes (6): Plugin, PluginCall, WifiDirectPlugin, BroadcastReceiver, IntentFilter, WifiP2pManager

### Community 38 - "transferUtils.js"
Cohesion: 0.38
Nodes (8): arrayBufferToBase64(), extractRoomCode(), formatSpeed(), formatTime(), generateRoomCode(), getFileType(), mapWithConcurrency(), RATE_PRESETS

## Knowledge Gaps
- **71 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+66 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `scripts`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Why does `App()` connect `App.jsx` to `App.panels.test.jsx`, `dependencies`, `computeSecurityCode`, `transferUtils.js`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `@capacitor/app` connect `dependencies` to `App.jsx`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `JSObject` (e.g. with `.collect()` and `.folderPickerResult()`) actually correct?**
  _`JSObject` has 14 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _71 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._