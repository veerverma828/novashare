# Graph Report - novashare  (2026-07-30)

## Corpus Check
- 37 files · ~66,957 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 254 nodes · 345 edges · 33 communities (28 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- devDependencies
- package.json
- gen-icons.mjs
- ExampleInstrumentedTest.java
- Privacy Policy for NovaShare
- App.jsx
- ExampleUnitTest.java
- gradlew
- MainActivity
- NotifyDownloadPlugin
- IncomingSharePlugin
- TransferForegroundService
- dependencies
- TransferNotificationPlugin
- gen-feature-graphics-batch.mjs
- build-gallery.mjs
- NearbyDiscoveryPlugin
- history.js
- computeSecurityCode
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `App()` - 22 edges
2. `NearbyDiscoveryPlugin` - 12 edges
3. `Privacy Policy for NovaShare` - 8 edges
4. `IncomingSharePlugin` - 7 edges
5. `InstalledAppsPlugin` - 7 edges
6. `TransferNotificationPlugin` - 7 edges
7. `NearbyDiscovery` - 7 edges
8. `MainActivity` - 6 edges
9. `TransferForegroundService` - 6 edges
10. `scripts` - 6 edges

## Surprising Connections (you probably didn't know these)
- `App()` --references--> `@capacitor/app`  [EXTRACTED]
  src/App.jsx → package.json
- `HistoryPanel()` --calls--> `getHistory()`  [EXTRACTED]
  src/App.jsx → src/history.js
- `App()` --calls--> `addHistoryEntry()`  [EXTRACTED]
  src/App.jsx → src/history.js
- `App()` --calls--> `clearHistory()`  [EXTRACTED]
  src/App.jsx → src/history.js
- `App()` --indirect_call--> `sharedEntryToFile()`  [INFERRED]
  src/App.jsx → src/native.js

## Import Cycles
- None detected.

## Communities (33 total, 5 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.07
Nodes (27): cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, cross-env (+19 more)

### Community 1 - "package.json"
Cohesion: 0.18
Nodes (10): name, private, scripts, build, build:app, dev, lint, preview (+2 more)

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
Cohesion: 0.12
Nodes (35): App(), AppIcon(), appIconCache, AppsPanel(), arrayBufferToBase64(), HistoryPanel(), ICE_SERVERS, mapWithConcurrency() (+27 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.29
Nodes (5): Intent, MainActivity, BridgeActivity, Bundle, Uri

### Community 9 - "NotifyDownloadPlugin"
Cohesion: 0.38
Nodes (4): Plugin, PluginCall, NotifyDownloadPlugin, sanitizeRelPath()

### Community 10 - "IncomingSharePlugin"
Cohesion: 0.14
Nodes (10): IncomingSharePlugin, Plugin, PluginCall, InstalledAppsPlugin, Plugin, PluginCall, Bitmap, Drawable (+2 more)

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

### Community 19 - "history.js"
Cohesion: 0.57
Nodes (6): addHistoryEntry(), clearHistory(), getHistory(), readAll(), removeHistoryEntry(), writeAll()

### Community 20 - "computeSecurityCode"
Cohesion: 0.83
Nodes (3): computeSecurityCode(), formatDigest(), simpleHashBytes()

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

## Knowledge Gaps
- **60 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.157) - this node is a cross-community bridge._
- **Why does `App()` connect `App.jsx` to `history.js`, `dependencies`, `computeSecurityCode`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `@capacitor/app` connect `dependencies` to `App.jsx`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `App.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12073170731707317 - nodes in this community are weakly interconnected._
- **Should `IncomingSharePlugin` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._