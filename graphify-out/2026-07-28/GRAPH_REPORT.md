# Graph Report - novashare  (2026-07-28)

## Corpus Check
- 27 files · ~21,265 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 150 nodes · 155 edges · 24 communities (20 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0e29fd55`
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
- InstalledAppsPlugin
- dependencies
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `Privacy Policy for NovaShare` - 8 edges
2. `InstalledAppsPlugin` - 6 edges
3. `scripts` - 6 edges
4. `rippleTap()` - 5 edges
5. `AppsPanel()` - 4 edges
6. `App()` - 4 edges
7. `InstalledApps` - 4 edges
8. `listInstalledApps()` - 4 edges
9. `getAppIcon()` - 4 edges
10. `getAppApkFile()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `rippleTap()` --calls--> `triggerHaptic()`  [EXTRACTED]
  src/App.jsx → src/native.js
- `AppIcon()` --calls--> `getAppIcon()`  [EXTRACTED]
  src/App.jsx → src/native.js
- `AppsPanel()` --calls--> `getAppApkFile()`  [EXTRACTED]
  src/App.jsx → src/native.js
- `AppsPanel()` --calls--> `listInstalledApps()`  [EXTRACTED]
  src/App.jsx → src/native.js

## Import Cycles
- None detected.

## Communities (24 total, 4 thin omitted)

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
Cohesion: 0.23
Nodes (13): App(), AppIcon(), appIconCache, AppsPanel(), NotifyDownload, rippleTap(), SwipeableFileRow(), getAppApkFile() (+5 more)

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 8 - "MainActivity"
Cohesion: 0.40
Nodes (3): MainActivity, BridgeActivity, Bundle

### Community 9 - "NotifyDownloadPlugin"
Cohesion: 0.40
Nodes (3): Plugin, PluginCall, NotifyDownloadPlugin

### Community 10 - "InstalledAppsPlugin"
Cohesion: 0.27
Nodes (5): InstalledAppsPlugin, Plugin, PluginCall, Bitmap, Drawable

### Community 12 - "dependencies"
Cohesion: 0.06
Nodes (31): canvas-confetti, @capacitor/android, @capacitor/app, @capacitor/cli, @capacitor/core, @capacitor/filesystem, @capacitor/haptics, @capacitor/splash-screen (+23 more)

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
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _51 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._