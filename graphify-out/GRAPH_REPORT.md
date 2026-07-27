# Graph Report - novashare  (2026-07-27)

## Corpus Check
- 24 files · ~18,919 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 116 nodes · 111 edges · 34 communities (16 shown, 18 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e1b0d78c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- package.json
- gen-icons.mjs
- ExampleInstrumentedTest.java
- @capacitor/core
- App.jsx
- ExampleUnitTest.java
- gradlew
- MainActivity.java
- @capacitor/android
- @capacitor/app
- @capacitor/cli
- dependencies
- @capacitor/splash-screen
- @capacitor/status-bar
- jsqr
- lucide-react
- peerjs
- qrcode.react
- react
- react-dom
- React + Vite
- rules/graphify.md
- workflows/graphify.md
- @capacitor/filesystem
- CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `scripts` - 6 edges
2. `rippleTap()` - 4 edges
3. `ExampleInstrumentedTest` - 3 edges
4. `App()` - 3 edges
5. `triggerHaptic()` - 3 edges
6. `React + Vite` - 3 edges
7. `MainActivity` - 2 edges
8. `ExampleUnitTest` - 2 edges
9. `@capacitor/android` - 2 edges
10. `@capacitor/app` - 2 edges

## Surprising Connections (you probably didn't know these)
- `rippleTap()` --calls--> `triggerHaptic()`  [EXTRACTED]
  src/App.jsx → src/native.js

## Import Cycles
- None detected.

## Communities (34 total, 18 thin omitted)

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

### Community 5 - "App.jsx"
Cohesion: 0.36
Nodes (5): App(), rippleTap(), SwipeableFileRow(), initNative(), triggerHaptic()

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 12 - "dependencies"
Cohesion: 0.40
Nodes (5): canvas-confetti, @capacitor/haptics, dependencies, canvas-confetti, @capacitor/haptics

### Community 29 - "React + Vite"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

## Knowledge Gaps
- **43 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+38 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@capacitor/filesystem`, `package.json`, `@capacitor/core`, `@capacitor/android`, `@capacitor/app`, `@capacitor/cli`, `@capacitor/splash-screen`, `@capacitor/status-bar`, `jsqr`, `lucide-react`, `peerjs`, `qrcode.react`, `react`, `react-dom`?**
  _High betweenness centrality (0.220) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _43 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._