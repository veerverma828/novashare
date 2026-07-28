# Graph Report - novashare  (2026-07-28)

## Corpus Check
- 30 files · ~23,874 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 195 nodes · 239 edges · 26 communities (22 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `be19e972`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `App()` - 9 edges
2. `Privacy Policy for NovaShare` - 8 edges
3. `IncomingSharePlugin` - 7 edges
4. `InstalledAppsPlugin` - 7 edges
5. `TransferNotificationPlugin` - 7 edges
6. `MainActivity` - 6 edges
7. `TransferForegroundService` - 6 edges
8. `scripts` - 6 edges
9. `AppsPanel()` - 6 edges
10. `rippleTap()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `App()` --indirect_call--> `sharedEntryToFile()`  [INFERRED]
  src/App.jsx → src/native.js
- `rippleTap()` --calls--> `triggerHaptic()`  [EXTRACTED]
  src/App.jsx → src/native.js
- `AppIcon()` --calls--> `getAppIcon()`  [EXTRACTED]
  src/App.jsx → src/native.js
- `AppsPanel()` --calls--> `clearApkCache()`  [EXTRACTED]
  src/App.jsx → src/native.js
- `AppsPanel()` --calls--> `getAppApkFile()`  [EXTRACTED]
  src/App.jsx → src/native.js

## Import Cycles
- None detected.

## Communities (26 total, 4 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.09
Nodes (23): cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, cross-env (+15 more)

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
Cohesion: 0.18
Nodes (22): App(), AppIcon(), appIconCache, AppsPanel(), mapWithConcurrency(), NotifyDownload, rippleTap(), SwipeableFileRow() (+14 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.29
Nodes (5): Intent, MainActivity, BridgeActivity, Bundle, Uri

### Community 9 - "NotifyDownloadPlugin"
Cohesion: 0.40
Nodes (3): Plugin, PluginCall, NotifyDownloadPlugin

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

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

## Knowledge Gaps
- **51 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+46 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _51 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `IncomingSharePlugin` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._