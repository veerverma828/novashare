# Graph Report - .  (2026-07-27)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 99 nodes · 93 edges · 29 communities (14 shown, 15 thin omitted)
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
- dependencies
- main.jsx
- ExampleUnitTest.java
- gradlew
- MainActivity.java
- @capacitor/android
- @capacitor/app
- @capacitor/cli
- canvas-confetti
- @capacitor/splash-screen
- @capacitor/status-bar
- jsqr
- lucide-react
- peerjs
- qrcode.react
- react
- react-dom

## God Nodes (most connected - your core abstractions)
1. `scripts` - 6 edges
2. `ExampleInstrumentedTest` - 3 edges
3. `MainActivity` - 2 edges
4. `ExampleUnitTest` - 2 edges
5. `@capacitor/android` - 2 edges
6. `@capacitor/app` - 2 edges
7. `@capacitor/cli` - 2 edges
8. `@capacitor/core` - 2 edges
9. `@capacitor/filesystem` - 2 edges
10. `@capacitor/splash-screen` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (29 total, 15 thin omitted)

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

### Community 4 - "dependencies"
Cohesion: 0.40
Nodes (5): @capacitor/core, @capacitor/filesystem, dependencies, @capacitor/core, @capacitor/filesystem

### Community 7 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

## Knowledge Gaps
- **37 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+32 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`, `@capacitor/android`, `@capacitor/app`, `@capacitor/cli`, `canvas-confetti`, `@capacitor/splash-screen`, `@capacitor/status-bar`, `jsqr`, `lucide-react`, `peerjs`, `qrcode.react`, `react`, `react-dom`?**
  _High betweenness centrality (0.277) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.231) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _37 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._