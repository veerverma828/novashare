# Graph Report - android  (2026-08-06)

## Corpus Check
- 20 files · ~16,286 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 159 nodes · 242 edges · 20 communities (19 shown, 1 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d44c8799`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- WifiDirectPlugin
- LocalSignalingServerPlugin
- NearbyDiscoveryPlugin
- JSObject
- AppUpdatePlugin
- InstalledAppsPlugin
- .folderPickerResult
- IncomingSharePlugin
- MainActivity
- TransferForegroundService
- TransferNotificationPlugin
- ExampleInstrumentedTest.java
- ExampleUnitTest.java
- gradlew

## God Nodes (most connected - your core abstractions)
1. `WifiDirectPlugin` - 23 edges
2. `LocalSignalingServerPlugin` - 12 edges
3. `NearbyDiscoveryPlugin` - 12 edges
4. `AppUpdatePlugin` - 9 edges
5. `NotifyDownloadPlugin` - 9 edges
6. `IncomingSharePlugin` - 7 edges
7. `InstalledAppsPlugin` - 7 edges
8. `TransferNotificationPlugin` - 7 edges
9. `MainActivity` - 6 edges
10. `TransferForegroundService` - 6 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (20 total, 1 thin omitted)

### Community 0 - "WifiDirectPlugin"
Cohesion: 0.15
Nodes (6): Plugin, PluginCall, WifiDirectPlugin, BroadcastReceiver, IntentFilter, WifiP2pManager

### Community 1 - "LocalSignalingServerPlugin"
Cohesion: 0.28
Nodes (5): Plugin, PluginCall, LocalSignalingServerPlugin, ServerSocket, Socket

### Community 2 - "NearbyDiscoveryPlugin"
Cohesion: 0.23
Nodes (5): Plugin, PluginCall, NearbyDiscoveryPlugin, NsdManager, NsdServiceInfo

### Community 3 - "JSObject"
Cohesion: 0.28
Nodes (5): Plugin, PluginCall, NotifyDownloadPlugin, sanitizeRelPath(), JSObject

### Community 4 - "AppUpdatePlugin"
Cohesion: 0.20
Nodes (5): AppUpdatePlugin, Intent, Plugin, PluginCall, AppUpdateManager

### Community 5 - "InstalledAppsPlugin"
Cohesion: 0.25
Nodes (5): InstalledAppsPlugin, Plugin, PluginCall, Bitmap, Drawable

### Community 6 - ".folderPickerResult"
Cohesion: 0.27
Nodes (6): androidx, FolderPickerPlugin, JSArray, Plugin, PluginCall, DocumentFile

### Community 7 - "IncomingSharePlugin"
Cohesion: 0.27
Nodes (4): IncomingSharePlugin, JSArray, Plugin, PluginCall

### Community 8 - "MainActivity"
Cohesion: 0.29
Nodes (5): Intent, MainActivity, BridgeActivity, Bundle, Uri

### Community 9 - "TransferForegroundService"
Cohesion: 0.27
Nodes (5): Intent, TransferForegroundService, IBinder, Notification, Service

### Community 10 - "TransferNotificationPlugin"
Cohesion: 0.39
Nodes (3): Plugin, PluginCall, TransferNotificationPlugin

### Community 11 - "ExampleInstrumentedTest.java"
Cohesion: 0.60
Nodes (3): ExampleInstrumentedTest, Test, RunWith

### Community 13 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 19 inferred relationships involving `JSObject` (e.g. with `.checkForUpdate()` and `.handleOnActivityResult()`) actually correct?**
  _`JSObject` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Should `WifiDirectPlugin` be split into smaller, more focused modules?**
  _Cohesion score 0.14666666666666667 - nodes in this community are weakly interconnected._