# Privacy Policy for NovaShare

**Last updated:** August 3, 2026

NovaShare ("we", "our", "the app") is a peer-to-peer (P2P) file sharing app. This policy explains what data the app accesses and how it is used.

## What We Do NOT Do
- We do not collect, store, or sell your personal data.
- We do not have our own servers that store your files.
- Files you share go **directly between devices** (peer-to-peer) — they never pass through or get stored on any server we control.

## What the App Accesses (and Why)

**Camera**
Used only to scan QR codes for pairing two devices to start a transfer. The camera feed is not recorded or stored.

**Storage (Files)**
Used to let you pick files to send and to save files you receive, directly on your device. Files are not uploaded anywhere.

**Internet / Network**
Used to establish a direct peer-to-peer connection between two devices when transferring over the internet or a shared Wi-Fi network. To help two devices find each other, the app uses a third-party connection-assist service called **PeerJS** (`0.peerjs.com`). This service helps set up the initial handshake between devices — it does not see or store the actual files you transfer. When you use the fully offline Wi-Fi Direct option described below, this service is not contacted at all.

**Nearby Devices (Same Wi-Fi Network)**
When you're on the home screen with no file selected, the app looks for other nearby NovaShare devices on your current Wi-Fi network so you can tap to connect instead of typing or scanning a code. This only shares a device name and a temporary room code over your local network — the actual file transfer still uses the Internet/Network handshake described above.

**Nearby Devices (Wi-Fi Direct — fully offline)**
NovaShare can also connect two devices directly via Wi-Fi Direct, with no router, hotspot, or internet connection needed at all. To find and connect to nearby devices this way, Android requires the app to request:
- **Nearby Wi-Fi Devices** (Android 13+) or **Location** (Android 12 and earlier — this is an OS requirement for any app that scans for Wi-Fi Direct peers, not something NovaShare itself needs).
NovaShare never reads, stores, or transmits your physical location — the permission is requested solely to list nearby device names for you to tap, and is declared `neverForLocation` where Android allows it. This feature is off by default and only starts scanning when you tap "Find devices." When used, the entire connection (device discovery, handshake, and the file transfer itself) happens directly between the two phones — no server, no internet, and no third-party service (including PeerJS) is contacted.

**Clipboard**
Used only when you tap "copy" to copy a share link or code. Nothing is read from your clipboard automatically.

**List of Installed Apps**
The "Apps" tab reads the list of other apps installed on your device (name, package ID, version, size) so you can pick one to send as an APK. This list is read on-device only, never uploaded, and is only requested when you open the Apps tab. System apps are excluded from the list. If you share an app, only that app's own installer package is read and sent — no other app data.

**Notifications**
Used to show an ongoing "transfer in progress" notification (with a progress bar) while a send or receive is running, including while the app is in the background. This keeps the transfer alive and lets you monitor it without keeping the app open. The notification is removed automatically when the transfer finishes, fails, or is cancelled.

**Files Shared From Other Apps**
If you use another app's "Share" button and choose NovaShare, that file is copied into NovaShare's private storage so it can be sent — this happens only when you explicitly initiate a share from another app, never in the background.

## Third-Party Services
- **PeerJS** (peerjs.com) — used solely to establish direct device-to-device connections. See their policy: https://peerjs.com

## Data Retention
Since we do not operate servers that store your files or personal information, we have nothing to retain or delete on our end.

## Children's Privacy
NovaShare does not knowingly collect data from children under 13.

## Changes to This Policy
If this policy changes, the update date above will be revised.

## Contact
Questions about this policy: veerverma828@gmail.com
