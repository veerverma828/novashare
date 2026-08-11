import { useState, useEffect, useRef, useMemo } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { createPortal } from 'react-dom';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
import {
  Download,
  UploadCloud,
  ShieldCheck,
  Copy,
  RefreshCw,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  File as FileIcon,
  X,
  ArrowLeft,
  AlertCircle,
  Zap,
  Laptop,
  Info,
  QrCode,
  Camera,
  Pause,
  Play,
  Smartphone,
  Check,
  Users,
  History as HistoryIcon,
  Type,
  FolderUp,
  ChevronDown,
  Gauge,
  Radar,
  ShieldQuestion,
  ClipboardCopy,
  MessageCircle,
  Paperclip,
  Send,
  Home,
  Radio,
  Settings
} from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const NotifyDownload = registerPlugin('NotifyDownload');
import {
  triggerHaptic,
  triggerSuccessHaptic,
  getPendingSharedFiles,
  onSharedFilesReceived,
  sharedEntryToFile,
  pushTransferNotification,
  stopTransferNotification,
  startAdvertisingRoom,
  stopAdvertisingRoom,
  startNearbyDiscovery,
  stopNearbyDiscovery,
  onNearbyPeerFound,
  onNearbyPeerLost,
  getDeviceLabel,
  pickFolder,
  isWifiDirectSupported,
  wifiDirectInitialize,
  wifiDirectDiscoverPeers,
  wifiDirectStopDiscovery,
  wifiDirectIsLocationEnabled,
  wifiDirectOpenLocationSettings,
  wifiDirectIsWifiEnabled,
  wifiDirectOpenWifiSettings,
  wifiDirectConnect,
  wifiDirectRequestGroupInfo,
  wifiDirectRemoveGroup,
  onWifiDirectPeersChanged,
  onWifiDirectConnectionChanged,
  isHotspotSupported,
  hotspotStart,
  hotspotStop,
  hotspotJoin,
  hotspotLeave,
  checkForAppUpdate,
  startFlexibleAppUpdate,
  completeFlexibleAppUpdate,
  onAppUpdateStateChanged,
  getBatteryInfo
} from './native';
import { addHistoryEntry, clearHistory } from './history';
import { computeSecurityCode } from './security';
import { isOnline, subscribeConnectivity } from './connectivity';
import { saveCheckpoint, getCheckpoint, clearCheckpoint } from './transferState';
import { hasReceived, recordReceived } from './receivedIndex';
import { addClip } from './clipboardSync';
import { recordError } from './crashLog';
import {
  RATE_PRESETS,
  arrayBufferToBase64,
  computeFileHash,
  formatBytes,
  formatSpeed,
  formatTime,
  getFileType,
  generateRoomCode,
  extractRoomCode,
  extractHotspotCredentials
} from './transferUtils';
import { establishLocalSocketConnection, startLocalSocketRoomHost } from './localSocketTransport';
import { rippleTap, BTN_PRIMARY, BTN_SECONDARY } from './uiHelpers';
import { playCompletionChime } from './completionChime';
import { FileThumbnail } from './components/FileThumbnail';
import { RoomCodeFlap } from './components/RoomCodeFlap';
import { SwipeableFileRow } from './components/SwipeableFileRow';
import { FolderQueueRow } from './components/FolderQueueRow';
import { AppsPanel } from './components/AppsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { TransferRing } from './components/TransferRing';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectPanel } from './components/ConnectPanel';
import { recordConnection } from './recentConnections';

// Marks a queued File as a text snippet (feature: send text/clipboard
// content through the same P2P pipeline as real files) rather than a user
// picked .txt — checked by MIME type on both ends.
const TEXT_SNIPPET_MIME = 'text/x-novashare-snippet';

// Runtime-only (never persisted) map from a history entry id to the actual
// File objects it referred to, so "Re-send" works within the same app
// session without ever writing file bytes to localStorage. Lost on restart —
// callers must handle a miss by prompting the user to reselect.
const sentFilesMemory = new Map();

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for P2P WebRTC

// Left-right order the Home/Apps/History tabs cycle through on a swipe.
const HOME_TAB_ORDER = ['home', 'apps', 'history'];

// STUN-only fails behind carrier-grade / symmetric NAT (common on mobile
// data) — TURN relay is the fallback for those cases. Open Relay Project
// free public TURN; swap for a paid provider if reliability becomes an issue.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// How long the cloud broker gets to complete its initial handshake before the
// automatic picker concludes the internet isn't usable and tries an offline
// link instead. Generous enough for a slow mobile network's TLS + WebSocket
// setup, short enough that a dead broker doesn't read as a hung app.
const CLOUD_OPEN_TIMEOUT_MS = 8000;

function App() {
  // Navigation & Mode States
  const [mode, setMode] = useState('home'); // 'home' | 'p2p-send' | 'p2p-receive'
  const [mainNavTab, setMainNavTab] = useState('home'); // 'home' | 'connect' | 'settings'
  const [homeTab, setHomeTab] = useState('home'); // 'home' | 'apps'
  const homeTabSwipeRef = useRef({ x: 0, y: 0, active: false });

  // File States
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [incomingFile, setIncomingFile] = useState(null); // { name, size, type }

  // Groups selectedFiles for display: consecutive files sharing the same
  // webkitRelativePath top segment collapse into one folder row instead of
  // listing every file inside flat. Order follows each item's first
  // occurrence, so folders and loose files interleave the way they were added.
  const groupedQueue = useMemo(() => {
    const items = [];
    const folders = new Map();
    selectedFiles.forEach((file, index) => {
      const rel = file.webkitRelativePath;
      const folderName = rel ? rel.split('/')[0] : null;
      if (folderName) {
        let group = folders.get(folderName);
        if (!group) {
          group = { type: 'folder', name: folderName, entries: [] };
          folders.set(folderName, group);
          items.push(group);
        }
        group.entries.push({ file, index });
      } else {
        items.push({ type: 'file', file, index });
      }
    });
    return items;
  }, [selectedFiles]);

  // Connection States
  const [roomCode, setRoomCode] = useState('');
  const [targetPeerId, setTargetPeerId] = useState('');
  const [transferState, setTransferState] = useState('idle'); // 'idle' | 'preparing' | 'waiting' | 'transferring' | 'complete' | 'error'
  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState('');
  const [timeRemaining, setTimeRemaining] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Multi-file queue state
  const [sendFileIndex, setSendFileIndex] = useState(0);
  const [sendFileCount, setSendFileCount] = useState(1);
  const [receiveFileIndex, setReceiveFileIndex] = useState(0);
  const [receiveFileCount, setReceiveFileCount] = useState(1);
  const [completedFiles, setCompletedFiles] = useState([]); // receiver-side: [{ name, url, size }]

  // Sender-side: how many receivers are currently connected to this room (broadcast)
  const [connectedCount, setConnectedCount] = useState(0);

  // Pause/Resume state
  const [isPaused, setIsPaused] = useState(false);
  const [isPeerPaused, setIsPeerPaused] = useState(false);
  
  // Toast Notification
  const [toast, setToast] = useState(null);

  // QR Scanner State
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [showQrZoom, setShowQrZoom] = useState(false);

  // "Add more" picker state (queue view: append files or apps to the queue)
  const [showAddApps, setShowAddApps] = useState(false);
  const [showAddMoreMenu, setShowAddMoreMenu] = useState(false);

  // Nearby (LAN) device discovery — list of { roomCode, deviceName, host }
  // found via NsdManager on native builds; always empty on web.
  const [nearbyPeers, setNearbyPeers] = useState([]);

  // Wi-Fi Direct (fully offline, no router/internet needed) discovery —
  // list of { deviceName, deviceAddress, status }. Off by default (explicit
  // toggle) since it needs a location/nearby-Wi-Fi permission prompt.
  const [wifiDirectAvailable, setWifiDirectAvailable] = useState(false);
  const [wifiDirectBrowsing, setWifiDirectBrowsing] = useState(false);
  const [wifiDirectPeers, setWifiDirectPeers] = useState([]);
  // True while system Location is off — Wi-Fi P2P discovery silently finds
  // nothing in that state (not an error), so this drives a persistent
  // "turn on Location" prompt instead of a one-shot toast, and the
  // discovery effect below polls until it's resolved and auto-resumes.
  const [wifiDirectLocationOff, setWifiDirectLocationOff] = useState(false);
  const [wifiDirectWifiOff, setWifiDirectWifiOff] = useState(false);
  const [wifiDirectConnecting, setWifiDirectConnecting] = useState(null); // deviceAddress mid-connect, or null

  // Hotspot fallback (feature: Wi-Fi Direct → hotspot when WFD connect
  // fails) — host side only; the joining side never shows UI for this, it's
  // transparently detected from the QR payload (see the scanner's data
  // handler). null once not hosting a fallback hotspot.
  const [hotspotSupported, setHotspotSupported] = useState(false);
  const [hotspotCredentials, setHotspotCredentials] = useState(null); // { ssid, passphrase } | null
  const [hotspotStarting, setHotspotStarting] = useState(false);

  // Transfer history tab — bumped to force a re-read from localStorage.
  // historyOpenedAt is captured once (in the tab-click handler) rather than
  // read fresh during HistoryPanel's render, keeping render pure.
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyOpenedAt, setHistoryOpenedAt] = useState(0);

  // A receive checkpoint found on cold start (feature: resume after app
  // restart) — null once dismissed/resumed/absent. Distinct from the live
  // 'reconnecting' transferState, which only handles a WebRTC drop while the
  // process stays alive.
  const [interruptedTransfer, setInterruptedTransfer] = useState(null);

  // Verified-handshake security codes (feature #4): sender keeps one per
  // connected receiver id, receiver keeps its own single code.
  const [peerSecurityCodes, setPeerSecurityCodes] = useState({}); // { [connId]: code }
  const [mySecurityCode, setMySecurityCode] = useState('');

  // Send-as-text modal (feature #5)
  const [showTextModal, setShowTextModal] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  // Text snippets received this session, shown with a Copy button alongside
  // the normal completed-file list: { name, text, size }
  const [receivedTexts, setReceivedTexts] = useState([]);

  // Persistent clipboard channel (feature): once a transfer finishes, the
  // underlying DataConnection is still open (cleanup() only runs on a fresh
  // send/receive or resetToHome) — this reuses it for ad hoc text snippets
  // instead of a one-shot send. Session-scoped: { text, direction, peerLabel }.
  const [sessionClips, setSessionClips] = useState([]);
  const [clipDraft, setClipDraft] = useState('');

  // Chat section (feature): a persistent thread over the same live
  // connection the clipboard channel above already rides — but for files and
  // installed apps too, not just text, sent/received any time after
  // connecting, not only from the pre-send queue. Deliberately a separate,
  // lightweight wire protocol ('chat-meta'/'chunk'+chatId/'chat-done') from
  // the main batch transfer above — reusing batch-start would reset
  // receivedFilesRef/completedFiles and wipe whatever the main screen is
  // already showing, which a "send one more thing" chat message shouldn't do.
  const [chatMessages, setChatMessages] = useState([]); // { id, direction, kind: 'file'|'app', name, size, status, progress, ts, url? }
  const [showChat, setShowChat] = useState(false);
  const [showChatApps, setShowChatApps] = useState(false);
  const [showChatAttach, setShowChatAttach] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatPreviewItem, setChatPreviewItem] = useState(null); // { name, size, url, mime, kind, type }
  const chatBuffersRef = useRef(new Map()); // chatId -> { chunks: ArrayBuffer[], received: number, meta }
  const chatFileInputRef = useRef(null);

  // Bandwidth throttle (feature #8) — 0 = unlimited, else target KB/s per peer.
  const [maxRateKBps, setMaxRateKBps] = useState(0);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const maxRateRef = useRef(0);
  useEffect(() => { maxRateRef.current = maxRateKBps; }, [maxRateKBps]);

  // Battery-aware throttle (feature): auto-caps outgoing bandwidth if this
  // device's battery is low and not charging, so a big send doesn't drain it
  // dry. Only kicks in from "Unlimited" — an explicit rate the user already
  // picked is left alone — and only once per transfer, so overriding it back
  // up doesn't get immediately re-clamped. Re-checked periodically since a
  // long transfer can cross the threshold partway through.
  const batteryThrottleAppliedRef = useRef(false);
  useEffect(() => {
    if (mode !== 'p2p-send' || transferState !== 'transferring') {
      batteryThrottleAppliedRef.current = false;
      return;
    }
    const checkBattery = async () => {
      if (batteryThrottleAppliedRef.current) return;
      const { batteryLevel, isCharging } = await getBatteryInfo();
      if (batteryLevel == null || isCharging) return;
      if (batteryLevel <= 0.15 && maxRateRef.current === 0) {
        batteryThrottleAppliedRef.current = true;
        setMaxRateKBps(512);
        showToast('Low battery — capped transfer speed to save power. Tap the speed limit button to change it.', 'info');
      }
    };
    checkBattery();
    const interval = setInterval(checkBattery, 60000);
    return () => clearInterval(interval);
  }, [mode, transferState]);

  // Receiver-side buffer for reconstructing a text snippet's chunks into a
  // string once fully received (parallel to the native/web file-save path).
  const receivedTextChunksRef = useRef([]);

  // Refs for background processes
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const transferStartTime = useRef(null);
  const receivedChunks = useRef([]);
  const receivedBytes = useRef(0);
  const incomingFileRef = useRef(null);
  // Native path streams chunks straight to disk instead of buffering the
  // whole file in JS memory (that buffering OOM-crashed the WebView on large
  // files) — fileId names the temp file, writeChain serializes the native
  // append calls so out-of-order bridge resolution can't corrupt the file.
  const incomingFileIdRef = useRef('');
  const writeChainRef = useRef(Promise.resolve());
  // Set for the current file when the receiver already has identical content
  // (feature: duplicate-file skip / delta folder sync) — the chunk handler
  // discards anything that arrives for this file instead of writing it,
  // since the sender may not react to 'skip-duplicate' instantly.
  const skippingCurrentFileRef = useRef(false);
  const fileInputRef = useRef(null);
  const scanVideoRef = useRef(null);
  const scanCanvasRef = useRef(null);
  const scanStreamRef = useRef(null);
  const scanRafRef = useRef(null);
  const [qrDetected, setQrDetected] = useState(false);

  // Multi-file send queue refs
  const sendQueueRef = useRef([]);
  const sendQueueIndexRef = useRef(0);
  const totalQueueBytesRef = useRef(0);
  // Sender-side: one entry per connected receiver, so a room can broadcast
  // to several peers at once, each progressing through the queue at its own
  // pace ({ conn, id, queueIndex, fileOffset, totalBytesSent, pendingSendNext }).
  const connsRef = useRef([]);
  // Receiver-side collected downloads for this batch
  const receivedFilesRef = useRef([]);
  // Receiver-side resume tracking: which queued file we're on, and how many
  // reconnect attempts we've burned after an unexpected mid-transfer drop
  const currentFileIndexRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  // Active receiver transport, so a mid-transfer reconnect (scheduleReconnectRetry)
  // retries over the same transport it was using rather than defaulting to cloud.
  const receiverTransportRef = useRef({ mode: 'cloud', groupInfo: null });
  // Tracks the active send's transport so the room-advertising effect below
  // knows whether it's safe to also host a direct local-LAN listener (only
  // for 'cloud' sends — a 'local' Wi-Fi Direct send already owns the same
  // native LocalSignaling server for its own handshake).
  const senderTransportRef = useRef('cloud');
  // Watchdog for the cloud broker's initial handshake (feature: automatic
  // online/offline transport selection). PeerJS surfaces an unreachable
  // broker as a socket that just never opens rather than a prompt error, so
  // without a timer a device with no route to 0.peerjs.com sits on
  // "preparing" indefinitely instead of degrading to an offline link.
  const cloudOpenWatchdogRef = useRef(null);
  // Unsubscribe handle for a pending "retry once the internet is back" hook,
  // so cleanup() can cancel it and a second arm can replace the first rather
  // than both firing.
  const connectivityRetryRef = useRef(null);
  // Throttles the background transfer notification to a few updates/sec
  // instead of firing on every 64KB chunk
  const notifyThrottleRef = useRef(0);
  // Same idea for the resume checkpoint (feature: resume after app restart) —
  // written every ~2s during an active receive instead of on every chunk, to
  // keep localStorage write pressure low.
  const checkpointThrottleRef = useRef(0);
  // Sender-side: caches each queued file's SHA-256 (as a Promise, so a
  // broadcast to several receivers hashes each file once instead of once per
  // peer) for the integrity check in the 'metadata' message.
  const fileHashCacheRef = useRef(new Map());
  // Pause/resume refs (avoid stale closures inside the send loop)
  const isPausedRef = useRef(false);

  // Format Helper: Bytes -> Human Readable
  // Show Toast Helper
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  // Pushes the background transfer notification, throttled so a chunk
  // arriving every few ms doesn't hammer the native bridge — only actually
  // sends once every ~700ms (always lets the final 100% through).
  const notifyTransfer = (title, text, progress) => {
    const now = Date.now();
    if (progress < 100 && now - notifyThrottleRef.current < 700) return;
    notifyThrottleRef.current = now;
    pushTransferNotification(title, text, progress);
  };

  // Stop the background notification once a transfer is no longer actively running
  useEffect(() => {
    if (transferState === 'complete' || transferState === 'error' || transferState === 'idle') {
      stopTransferNotification();
    }
  }, [transferState]);

  // Clear Toast after delay
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // In-app update (Play Core flexible flow). status mirrors the user-facing
  // stage: 'available' (not yet downloading) -> 'downloading' -> 'downloaded'
  // (ready to restart) -> 'failed'. null/dismissed hides the banner entirely.
  const [appUpdate, setAppUpdate] = useState(null);
  const appUpdateDismissedRef = useRef(false);

  const runUpdateCheck = () => {
    checkForAppUpdate().then(({ updateAvailable, flexibleAllowed, downloadedPending }) => {
      if (downloadedPending) {
        appUpdateDismissedRef.current = false;
        setAppUpdate({ status: 'downloaded', progress: 100 });
      } else if (updateAvailable && flexibleAllowed && !appUpdateDismissedRef.current) {
        setAppUpdate((prev) => prev ?? { status: 'available', progress: 0 });
      }
    }).catch((err) => console.warn('runUpdateCheck: update check failed', err));
  };

  const handleManualCheckUpdate = () => {
    if (!Capacitor.isNativePlatform()) {
      showToast('You are running NovaShare v1.2 (Latest)', 'info');
      return;
    }
    showToast('Checking for app updates...', 'info');
    checkForAppUpdate().then(({ updateAvailable, flexibleAllowed, downloadedPending }) => {
      if (downloadedPending) {
        setAppUpdate({ status: 'downloaded', progress: 100 });
        showToast('An update is ready to install!', 'success');
      } else if (updateAvailable && flexibleAllowed) {
        setAppUpdate({ status: 'available', progress: 0 });
        showToast('New update available!', 'success');
      } else {
        showToast('NovaShare is up to date (v1.2)', 'success');
      }
    }).catch(() => {
      showToast('NovaShare is up to date (v1.2)', 'info');
    });
  };

  // Check once on mount, then again whenever the app returns to the
  // foreground — catches an update that finished downloading while backgrounded.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    runUpdateCheck();
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) runUpdateCheck();
    });
    return () => { handle.remove(); };
  }, []);

  // Resume-after-restart (feature: cross-process-kill transfer resume) — on
  // cold start, check for a receive checkpoint from an interrupted transfer.
  // Only offer to resume if its native temp file is still actually on disk;
  // Android can (and does) clear app cache independently of localStorage.
  useEffect(() => {
    const checkpoint = getCheckpoint();
    if (!checkpoint) return;
    if (!Capacitor.isNativePlatform() || !checkpoint.incomingFileId) {
      clearCheckpoint();
      return;
    }
    NotifyDownload.getPartialInfo({ fileId: checkpoint.incomingFileId })
      .then(({ exists }) => {
        if (exists) setInterruptedTransfer(checkpoint);
        else clearCheckpoint();
      })
      .catch(() => clearCheckpoint());
  }, []);

  const resumeInterruptedTransfer = () => {
    const checkpoint = interruptedTransfer;
    if (!checkpoint) return;
    setInterruptedTransfer(null);
    reconnectAttemptRef.current = 0;
    currentFileIndexRef.current = checkpoint.fileIndex;
    receivedBytes.current = checkpoint.offset;
    incomingFileIdRef.current = checkpoint.incomingFileId;
    writeChainRef.current = Promise.resolve();
    incomingFileRef.current = checkpoint.currentFile;
    setIncomingFile(checkpoint.currentFile);
    setReceiveFileIndex(checkpoint.fileIndex);
    setReceiveFileCount(checkpoint.totalFiles || 1);
    setTargetPeerId(checkpoint.roomCode);
    setMode('p2p-receive');
    setTransferState('reconnecting');
    transferStartTime.current = Date.now();
    // isResume=true: same path a live mid-transfer drop already uses — sends
    // { type: 'resume', fileIndex, offset } once connected, and the sender's
    // room only needs to still be open (this doesn't help if the sender's
    // app also restarted, same as any other reconnect).
    connectToSender(checkpoint.roomCode, true, checkpoint.transportMode, checkpoint.groupInfo);
  };

  const discardInterruptedTransfer = () => {
    const checkpoint = interruptedTransfer;
    setInterruptedTransfer(null);
    clearCheckpoint();
    if (checkpoint?.incomingFileId && Capacitor.isNativePlatform()) {
      NotifyDownload.discardPartial({ fileId: checkpoint.incomingFileId }).catch(() => {});
    }
  };

  useEffect(() => {
    const unsubscribe = onAppUpdateStateChanged(({ status, bytesDownloaded, totalBytesToDownload }) => {
      if (status === 'DOWNLOADING') {
        const progress = totalBytesToDownload > 0
          ? Math.min(99, Math.round((bytesDownloaded / totalBytesToDownload) * 100))
          : 0;
        appUpdateDismissedRef.current = false;
        setAppUpdate({ status: 'downloading', progress });
      } else if (status === 'DOWNLOADED') {
        appUpdateDismissedRef.current = false;
        setAppUpdate({ status: 'downloaded', progress: 100 });
      } else if (status === 'FAILED' || status === 'CANCELED') {
        setAppUpdate((prev) => (prev ? { status: 'available', progress: 0 } : prev));
      }
    });
    return unsubscribe;
  }, []);

  const handleStartUpdate = () => {
    setAppUpdate((prev) => (prev ? { ...prev, status: 'downloading', progress: 0 } : prev));
    startFlexibleAppUpdate()
      .then(({ accepted }) => {
        if (!accepted) setAppUpdate({ status: 'available', progress: 0 });
      })
      .catch(() => setAppUpdate({ status: 'available', progress: 0 }));
  };

  const handleRestartUpdate = () => {
    completeFlexibleAppUpdate().catch(() =>
      showToast('Could not restart to install the update.', 'error')
    );
  };

  const handleDismissUpdate = () => {
    appUpdateDismissedRef.current = true;
    setAppUpdate(null);
  };

  // Hardware back button: step back through modal > view > tab instead of
  // closing the app. Refs mirror the live state so the listener (registered
  // once) never sees stale values.
  const modeRef = useRef(mode);
  const mainNavTabRef = useRef(mainNavTab);
  const homeTabRef = useRef(homeTab);
  const showQrZoomRef = useRef(showQrZoom);
  const showScannerRef = useRef(showScanner);
  const chatPreviewItemRef = useRef(chatPreviewItem);
  const showChatRef = useRef(showChat);
  const showChatAppsRef = useRef(showChatApps);
  // Also read by the connectivity-triggered rejoin (feature: automatic
  // transport selection), which fires long after its closure was created and
  // must not resume a join the user has since moved on from.
  const transferStateRef = useRef(transferState);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { transferStateRef.current = transferState; }, [transferState]);

  // The automatic-transport watchdog and the "retry when the internet is
  // back" listener are both armed from event handlers rather than owned by an
  // effect, so nothing else would release them if the app unmounts mid-attempt.
  useEffect(() => () => {
    clearCloudOpenWatchdog();
    if (connectivityRetryRef.current) {
      connectivityRetryRef.current();
      connectivityRetryRef.current = null;
    }
  }, []);
  useEffect(() => { homeTabRef.current = homeTab; }, [homeTab]);
  useEffect(() => {
    mainNavTabRef.current = mainNavTab;
    if (mainNavTab === 'connect') {
      if (!roomCode && mode === 'home') {
        handleHostRoomCode();
      }
    } else {
      if (connsRef.current.length === 0 && mode === 'home' && roomCode) {
        cleanup();
        setRoomCode('');
        setTransferState('idle');
      }
    }
  }, [mainNavTab]);
  useEffect(() => { showQrZoomRef.current = showQrZoom; }, [showQrZoom]);
  useEffect(() => { showScannerRef.current = showScanner; }, [showScanner]);
  useEffect(() => { chatPreviewItemRef.current = chatPreviewItem; }, [chatPreviewItem]);
  useEffect(() => { showChatRef.current = showChat; }, [showChat]);
  useEffect(() => { showChatAppsRef.current = showChatApps; }, [showChatApps]);

  useEffect(() => {
    const handle = CapacitorApp.addListener('backButton', () => {
      if (chatPreviewItemRef.current) {
        setChatPreviewItem(null);
        return;
      }
      if (showChatAppsRef.current) {
        setShowChatApps(false);
        return;
      }
      if (showChatRef.current) {
        setShowChat(false);
        return;
      }
      if (showQrZoomRef.current) {
        setShowQrZoom(false);
        return;
      }
      if (showScannerRef.current) {
        setShowScanner(false);
        return;
      }
      if (mainNavTabRef.current !== 'home') {
        setMainNavTab('home');
        return;
      }
      if (modeRef.current !== 'home') {
        resetToHome();
        return;
      }
      if (homeTabRef.current !== 'home') {
        setHomeTab('home');
        return;
      }
      CapacitorApp.exitApp();
    });
    return () => { handle.remove(); };
    // resetToHome only touches refs/setters, so the version captured on
    // mount behaves identically to any later render's — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-close the zoomed QR modal once a peer successfully connects
  useEffect(() => {
    if (showQrZoom && (transferState === 'transferring' || transferState === 'complete')) {
      setShowQrZoom(false);
    }
  }, [transferState, showQrZoom]);

  // Read URL Search Parameters on Load (Routing Fallback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');

    if (roomParam) {
      setMode('p2p-receive');
      setTargetPeerId(roomParam);
      // Wait for a small layout mount before connecting
      setTimeout(() => {
        startP2PReceive(roomParam);
      }, 500);
    }

    return () => cleanup();
    // startP2PReceive is called with the explicit roomParam (not the
    // targetPeerId state it'd otherwise fall back on), and cleanup only
    // touches refs/setters — both are safe to call via their mount-time
    // closure, so it's fine to run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up files shared into NovaShare from another app's "Share" menu:
  // once for whatever was queued before the webview existed (cold start),
  // then live for any that arrive while already running.
  useEffect(() => {
    let cancelled = false;

    const handleSharedEntries = async (entries) => {
      if (!entries || entries.length === 0) return;
      try {
        const files = await Promise.all(entries.map(sharedEntryToFile));
        if (cancelled) return;
        setSelectedFiles((prev) => [...prev, ...files]);
        setMode('home');
        setHomeTab('home');
        showToast(
          files.length > 1 ? `${files.length} shared files ready to send` : `${files[0].name} ready to send`,
          'success'
        );
      } catch {
        if (!cancelled) showToast('Could not load a shared file.', 'error');
      }
    };

    getPendingSharedFiles().then(handleSharedEntries);
    const unsubscribe = onSharedFilesReceived(handleSharedEntries);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Nearby-device discovery (feature #2): browse for other NovaShare devices
  // on the local Wi-Fi whenever the receive UI is actually visible (idle home
  // screen with no file queued), so a tap-to-connect list can replace typing
  // a code for same-network transfers. No-op on web/desktop.
  useEffect(() => {
    const browsing = mode === 'home' && homeTab === 'home' && selectedFiles.length === 0;
    if (!browsing) {
      setNearbyPeers([]);
      stopNearbyDiscovery();
      return;
    }
    startNearbyDiscovery();
    const offFound = onNearbyPeerFound((peer) => {
      setNearbyPeers((prev) => {
        const next = prev.filter((p) => p.roomCode !== peer.roomCode);
        return [...next, peer];
      });
    });
    const offLost = onNearbyPeerLost((peer) => {
      setNearbyPeers((prev) => prev.filter((p) => p.roomCode !== peer.roomCode));
    });
    return () => {
      offFound();
      offLost();
      stopNearbyDiscovery();
    };
  }, [mode, homeTab, selectedFiles.length]);

  // Check once whether this device can do Wi-Fi Direct at all (older devices
  // / some OEM builds disable it) — hides the offline-discovery section
  // entirely rather than showing a toggle that will always fail.
  useEffect(() => {
    isWifiDirectSupported().then(setWifiDirectAvailable);
    isHotspotSupported().then(setHotspotSupported);
  }, []);

  // Wi-Fi Direct discovery: fully offline, no router/shared-Wi-Fi/internet
  // needed at all — a separate, explicit toggle (not automatic like NSD
  // above) since starting it requests a location/nearby-Wi-Fi permission.
  // Leaving the home/idle screen or turning the toggle off tears it down.
  useEffect(() => {
    // Matches the JSX visibility condition for the panel below: the home
    // view except when parked on the Apps/History tab with nothing queued.
    const onHomeScreen = mode === 'home' && !(selectedFiles.length === 0 && (homeTab === 'apps' || homeTab === 'history'));
    const browsing = wifiDirectBrowsing && onHomeScreen;
    if (!browsing) {
      setWifiDirectPeers([]);
      setWifiDirectLocationOff(false);
      setWifiDirectWifiOff(false);
      wifiDirectStopDiscovery();
      return;
    }

    let cancelled = false;
    let initialized = false;

    // Single recurring tick does four things: (1) checks the Wi-Fi radio
    // itself, since Wi-Fi Direct needs zero internet/router but still rides
    // the Wi-Fi radio — toggling Wi-Fi off (which people do thinking it's
    // unrelated to an "offline" transfer) silently kills discovery; (2)
    // checks system Location, since Wi-Fi P2P discovery silently finds
    // nothing while it's off, independent of the app's own permission
    // grant; (3) initializes once both are confirmed on; (4) re-triggers
    // discoverPeers() every tick, since it's a single ~12s scan+listen
    // cycle, not continuous discovery — Android stops actively scanning
    // once it completes. Merging all of this into one interval means
    // turning Wi-Fi/Location back on mid-session auto-resumes discovery
    // without the user re-toggling "Find devices".
    const tick = async () => {
      if (cancelled) return;
      const wifiEnabled = await wifiDirectIsWifiEnabled();
      if (cancelled) return;

      if (!wifiEnabled) {
        setWifiDirectWifiOff(true);
        setWifiDirectLocationOff(false);
        setWifiDirectPeers([]);
        return;
      }
      setWifiDirectWifiOff(false);

      const locationEnabled = await wifiDirectIsLocationEnabled();
      if (cancelled) return;

      if (!locationEnabled) {
        setWifiDirectLocationOff(true);
        setWifiDirectPeers([]);
        return;
      }
      setWifiDirectLocationOff(false);

      if (!initialized) {
        try {
          await wifiDirectInitialize();
          initialized = true;
        } catch (err) {
          if (!cancelled) {
            setWifiDirectBrowsing(false);
            showToast('Could not start Wi-Fi Direct discovery: ' + err.message, 'error');
          }
          return;
        }
      }
      if (!cancelled) {
        wifiDirectDiscoverPeers().catch(() => { /* transient busy — next tick retries */ });
      }
    };

    tick();
    const interval = setInterval(tick, 5000);

    const offPeers = onWifiDirectPeersChanged((peers) => setWifiDirectPeers(peers));

    return () => {
      cancelled = true;
      clearInterval(interval);
      offPeers();
      wifiDirectStopDiscovery();
    };
  }, [wifiDirectBrowsing, mode, homeTab, selectedFiles.length]);

  // Advertise the open room's code on the local network for as long as it's
  // actively waiting for or serving receivers, so AppsPanel-style "just tap
  // it" pairing works without a code/QR round trip on the same Wi-Fi.
  useEffect(() => {
    const advertising = mode === 'p2p-send' && (transferState === 'waiting' || transferState === 'transferring') && !!roomCode;
    if (!advertising) {
      stopAdvertisingRoom();
      return;
    }
    startAdvertisingRoom(roomCode, getDeviceLabel());
    // Only host a direct local-LAN listener for cloud sends — a Wi-Fi Direct
    // send (transportMode 'local') already owns the same native
    // LocalSignaling server for its own handshake, and starting it a second
    // time here would tear that connection down (LocalSignaling.startServer()
    // closes any existing server first).
    const stopLocalHost = senderTransportRef.current === 'cloud' ? startLocalRoomHost(roomCode) : null;
    return () => {
      stopAdvertisingRoom();
      if (stopLocalHost) stopLocalHost();
    };
  }, [mode, transferState, roomCode]);

  // Waits for a Wi-Fi Direct group to actually form after connect() is
  // called — Android negotiates group ownership asynchronously, and either
  // side's WIFI_P2P_CONNECTION_CHANGED_ACTION broadcast can arrive first, so
  // this races a live subscription against an immediate info poll (in case
  // the group formed before the listener was attached).
  const waitForWifiDirectGroup = (timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (info) => {
        if (settled || !info.groupFormed) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(info);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error('Timed out waiting for the Wi-Fi Direct connection'));
      }, timeoutMs);
      const off = onWifiDirectConnectionChanged(finish);
      wifiDirectRequestGroupInfo().then(finish).catch((err) => console.warn('wifiDirectRequestGroupInfo failed, waiting on connection-changed event instead', err));
    });
  };

  // Tap-to-connect for a discovered Wi-Fi Direct peer: forms the group, then
  // hands off to whichever app-level role fits what the user is doing right
  // now — sending the queued files if any are selected, else receiving.
  const connectToWifiDirectPeer = async (peer) => {
    setWifiDirectConnecting(peer.deviceAddress);
    try {
      await wifiDirectConnect(peer.deviceAddress);
      const groupInfo = await waitForWifiDirectGroup();
      setWifiDirectBrowsing(false);
      // Awaited so "Waiting for them to tap too…" stays up through the whole
      // handshake instead of clearing the moment the Wi-Fi Direct group
      // forms — the group forming just means both sides tapped connect, not
      // that the peer-to-peer link is actually ready yet.
      if (selectedFiles.length > 0) {
        showToast(`Sending ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}…`, 'info');
        await startP2PSend('local', groupInfo);
      } else {
        showToast('Connecting to receive…', 'info');
        await startP2PReceive(generateRoomCode(), 'local', groupInfo);
      }
    } catch (err) {
      showToast('Could not connect over Wi-Fi Direct: ' + err.message, 'error');
    } finally {
      setWifiDirectConnecting(null);
    }
  };

  // Passive side of a Wi-Fi Direct connection: connectToWifiDirectPeer above
  // only runs on the device that taps "Connect" — the other device (just
  // sitting in the peer list, discoverable) never subscribed to
  // connectionChanged itself, so its native side would form the group and
  // fire the broadcast into the void. The initiator would then be the only
  // one to ever start the local-socket handshake, with nobody on this end
  // listening/dialing back — which is exactly why a connect attempt sat on
  // "Sending…" and then failed with a timeout instead of connecting. Answer
  // automatically as the receiver whenever a group forms that this device
  // didn't itself initiate.
  useEffect(() => {
    if (!wifiDirectAvailable) return;
    let lastGroupFormed = false;
    const off = onWifiDirectConnectionChanged((info) => {
      if (!info.groupFormed) {
        lastGroupFormed = false;
        return;
      }
      if (lastGroupFormed || wifiDirectConnecting) return;
      lastGroupFormed = true;
      setWifiDirectBrowsing(false);
      showToast('Connecting to receive…', 'info');
      startP2PReceive(generateRoomCode(), 'local', info);
    });
    return off;
  }, [wifiDirectAvailable, wifiDirectConnecting]);

  // Hotspot fallback host side (feature: Wi-Fi Direct → hotspot when WFD
  // connect fails/isn't available). Opens a LocalOnlyHotspot, then reuses the
  // exact same 'local' transport startP2PSend already uses for Wi-Fi Direct —
  // the only difference is how the two devices got IP connectivity in the
  // first place. groupInfo.kind: 'hotspot' tells startP2PSend/connectToSender
  // to tear down via hotspotStop/hotspotLeave instead of wifiDirectRemoveGroup.
  const startHotspotFallbackSend = async () => {
    if (selectedFiles.length === 0) {
      showToast('Select a file to send first.', 'error');
      return;
    }
    setHotspotStarting(true);
    try {
      const { ssid, passphrase } = await hotspotStart();
      setHotspotCredentials({ ssid, passphrase });
      showToast('Hotspot ready — have the other device scan the QR code below', 'info');
      await startP2PSend('local', { isGroupOwner: true, groupOwnerAddress: null, kind: 'hotspot' });
    } catch (err) {
      setHotspotCredentials(null);
      showToast('Could not start hotspot fallback: ' + err.message, 'error');
    } finally {
      setHotspotStarting(false);
    }
  };

  // Single entry point for "Send" — picks the transport itself instead of
  // making the user classify their own network first (feature: automatic
  // online/offline transport selection).
  //
  // The cheap negative is taken up front: navigator.onLine === false means no
  // interface is up at all, so a cloud attempt is guaranteed to waste the
  // user's time and we go straight to hotspot. Everything else optimistically
  // starts the cloud room *immediately* — no probe latency on the happy path
  // — and leans on the watchdog inside attemptConnection to degrade if the
  // broker turns out to be unreachable. That covers the case navigator.onLine
  // gets wrong (on a hotspot or in a Wi-Fi Direct group: interface up, no
  // internet), which is precisely the case this app hits most.
  //
  // Note the cloud path is not exclusive: while a cloud room is open, the
  // advertise effect above also runs startLocalRoomHost, so a same-Wi-Fi
  // receiver still connects over the direct LAN socket and never touches the
  // broker. "Online" here only decides whether the *broker* is worth trying.
  const startAutoSend = async () => {
    if (selectedFiles.length === 0) {
      showToast('Select a file to send first.', 'error');
      return;
    }
    const definitelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (definitelyOffline && hotspotSupported) {
      showToast('No internet — starting an offline link instead…', 'info');
      return startHotspotFallbackSend();
    }
    return startP2PSend('cloud');
  };

  // Hotspot fallback join side — triggered automatically when a scanned QR
  // carries ssid/pass (see openScanner's tick() below), not from a dedicated
  // button: the existing "Scan QR Code" entry point already covers it.
  const joinHotspotFallback = async (roomFromScan, { ssid, passphrase }) => {
    cleanup();
    setTargetPeerId(roomFromScan);
    setMode('p2p-receive');
    setTransferState('preparing');
    showToast('Joining hotspot…', 'info');
    try {
      const { gatewayIp } = await hotspotJoin(ssid, passphrase);
      if (!gatewayIp) throw new Error('Could not determine the host device\'s address');
      await startP2PReceive(roomFromScan, 'local', { isGroupOwner: false, groupOwnerAddress: gatewayIp, kind: 'hotspot' });
    } catch (err) {
      setTransferState('error');
      setErrorMsg('Could not join hotspot: ' + err.message);
    }
  };

  // Shared by both QR spots (waiting-screen QR + zoom modal) — carries
  // ssid/pass alongside the room code while hosting a hotspot fallback, so
  // the scanning device can join programmatically instead of needing a plain
  // Wi-Fi Direct proximity tap. Falls back to the bare room code otherwise
  // (unchanged from before this feature).
  const buildQrPayload = () => {
    if (!hotspotCredentials) return roomCode;
    const params = new URLSearchParams({
      room: roomCode,
      ssid: hotspotCredentials.ssid,
      pass: hotspotCredentials.passphrase
    });
    return `https://novashare.app/?${params.toString()}`;
  };

  const qrPayload = useMemo(() => buildQrPayload(), [roomCode, hotspotCredentials]);

  // Cleanup active peer/connections
  function clearCloudOpenWatchdog() {
    if (cloudOpenWatchdogRef.current) {
      clearTimeout(cloudOpenWatchdogRef.current);
      cloudOpenWatchdogRef.current = null;
    }
  }

  // Automatic offline degrade (feature: automatic transport selection).
  // Deliberately re-probes rather than trusting the failure that got us here:
  // a broker that is up but rejected us is a real error the user should see,
  // not a reason to drop their Wi-Fi and bring up a hotspot. Only a confirmed
  // lack of internet justifies taking over the radio.
  async function degradeToOfflineSend(reason) {
    const online = await isOnline({ force: true });
    if (online || !hotspotSupported) {
      setTransferState((prev) => {
        if (prev === 'complete') return 'complete';
        showToast(reason, 'error');
        setErrorMsg(
          hotspotSupported
            ? reason
            : `${reason} This device can't host an offline hotspot, so an internet connection is required.`
        );
        return 'error';
      });
      return;
    }
    showToast('No internet — switching to an offline link…', 'info');
    // startHotspotFallbackSend routes through startP2PSend, whose cleanup()
    // tears down the stranded Peer so it stops retrying in the background.
    await startHotspotFallbackSend();
  }

  function cleanup() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearCloudOpenWatchdog();
    if (connectivityRetryRef.current) {
      connectivityRetryRef.current();
      connectivityRetryRef.current = null;
    }
    // Set past the retry cap first so a 'close'/'error' event fired
    // synchronously by connRef.current.close() below can't re-arm a new
    // reconnect timer right after this one was just cleared.
    reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS + 1;
    if (connRef.current) {
      try { connRef.current.close(); } catch { /* ignore */ }
      connRef.current = null;
    }
    connsRef.current.forEach((p) => { try { p.conn.close(); } catch { /* ignore */ } });
    connsRef.current = [];
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch { /* ignore */ }
      peerRef.current = null;
    }
    receivedChunks.current = [];
    receivedBytes.current = 0;
    transferStartTime.current = null;
    incomingFileRef.current = null;
    sendQueueRef.current = [];
    sendQueueIndexRef.current = 0;
    totalQueueBytesRef.current = 0;
    receivedFilesRef.current = [];
    isPausedRef.current = false;
    notifyThrottleRef.current = 0;
    receivedTextChunksRef.current = [];
    receiverTransportRef.current = { mode: 'cloud', groupInfo: null };
    setPeerSecurityCodes({});
    setMySecurityCode('');
  }

  // Reset UI back to Home State
  function resetToHome() {
    cleanup();
    setMode('home');
    setHomeTab('home');
    setTransferState('idle');
    setSelectedFiles([]);
    setIncomingFile(null);
    setRoomCode('');
    setTargetPeerId('');
    setTransferProgress(0);
    setTransferSpeed('');
    setTimeRemaining('');
    setErrorMsg('');
    setCompletedFiles([]);
    setSendFileIndex(0);
    setSendFileCount(1);
    setReceiveFileIndex(0);
    setReceiveFileCount(1);
    setIsPaused(false);
    setIsPeerPaused(false);
    setConnectedCount(0);
    setReceivedTexts([]);
    setHotspotCredentials(null);
    setSessionClips([]);
    setClipDraft('');
    setChatMessages([]);
    setChatDraft('');
    setShowChat(false);
    setShowChatAttach(false);
    chatBuffersRef.current.clear();

    // Clear URL search params without page reload
    window.history.pushState({}, document.title, window.location.pathname);
  }

  // Toggle pause/resume of an in-progress send (sender-side control) —
  // broadcasts to every connected receiver, not just one.
  const togglePauseTransfer = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    connsRef.current.forEach((p) => {
      try { p.conn.send({ type: 'control', action: next ? 'pause' : 'resume' }); } catch { /* ignore */ }
    });
    if (!next) {
      connsRef.current.forEach((p) => {
        if (p.pendingSendNext) {
          const fn = p.pendingSendNext;
          p.pendingSendNext = null;
          fn();
        }
      });
    }
  };

  // Generate a random 6-character room code
  // Drag and Drop Handlers
  const [dragActive, setDragActive] = useState(false);
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Appends rather than replaces, so this same input/handler serves both the
  // empty-state dropzone and the "Add Files" button once a queue exists
  // (appending to an empty queue is equivalent to replacing it). Files must
  // be snapshotted before clearing e.target.value — on a file input, value
  // and .files are linked, so clearing value first empties .files before
  // React's setState updater ever reads it.
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...files]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // Whole-card swipe gesture, active across every screen:
  // - In Home mode (Home/Apps/History tabs, no files queued yet): left/right
  //   swipe cycles tabs in the same order as the tab bar. Disabled once files
  //   are queued so it doesn't fight with each row's own swipe-to-remove.
  // - In the P2P send/receive screens: a right swipe (the standard mobile
  //   "back" gesture) acts like tapping the Back/Leave button.
  // A mostly-vertical drag (list scrolling) is ignored via the
  // horizontal-dominance check so it never hijacks normal scrolling.
  const SWIPE_TAB_THRESHOLD = 60;

  const onCardSwipeStart = (e) => {
    // Swiping over an *unfocused* text field (e.g. the apps search bar)
    // should still switch tabs like anywhere else. Only once it's focused —
    // meaning the drag is placing the cursor or selecting text — does the
    // gesture belong to the field instead of the tab swipe.
    const target = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    const isEditingText = target && document.activeElement === target;
    homeTabSwipeRef.current = { x: e.clientX, y: e.clientY, active: !isEditingText };
  };

  const onCardSwipeEnd = (e) => {
    const start = homeTabSwipeRef.current;
    homeTabSwipeRef.current = { ...start, active: false };
    if (!start.active) return;

    const deltaX = e.clientX - start.x;
    const deltaY = e.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_TAB_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    if (mode !== 'home') {
      if (deltaX > 0) { rippleTap(e, resetToHome); }
      return;
    }

    if (selectedFiles.length > 0) return;

    const currentIndex = HOME_TAB_ORDER.indexOf(homeTab);
    const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= HOME_TAB_ORDER.length) return;

    const nextTab = HOME_TAB_ORDER[nextIndex];
    setHomeTab(nextTab);
    if (nextTab === 'history') { setHistoryVersion((v) => v + 1); setHistoryOpenedAt(Date.now()); }
    triggerHaptic();
  };

  // Folder picker (feature #6): each File from a webkitdirectory input
  // carries a read-only webkitRelativePath like "myFolder/sub/photo.png" —
  // kept as-is on the File object and read off it again when building the
  // 'metadata' message so the receiver can recreate the folder structure.
  const folderInputRef = useRef(null);
  const triggerFolderInput = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const files = await pickFolder();
        if (files.length > 0) {
          setSelectedFiles((prev) => [...prev, ...files]);
          showToast(`${files.length} file${files.length === 1 ? '' : 's'} added from folder`, 'success');
        }
      } catch {
        // User backed out of the folder picker — nothing to add.
      }
      return;
    }
    folderInputRef.current?.click();
  };
  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...files]);
      showToast(`${files.length} file${files.length === 1 ? '' : 's'} added from folder`, 'success');
    }
  };

  // Send-as-text (feature #5): wraps the typed text in a File tagged with
  // TEXT_SNIPPET_MIME so it rides through the exact same P2P send/receive
  // pipeline as a real file — the receiver just also renders it inline.
  const sendTextSnippet = () => {
    const text = textDraft.trim();
    if (!text) return;
    const blob = new Blob([text], { type: TEXT_SNIPPET_MIME });
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const file = new File([blob], `Text snippet ${stamp}.txt`, { type: TEXT_SNIPPET_MIME });
    setSelectedFiles((prev) => [...prev, file]);
    setTextDraft('');
    setShowTextModal(false);
    showToast('Text snippet added to queue', 'success');
  };

  // ----------------------------------------------------
  // SENDER P2P WORKFLOW (broadcast: one room, several receivers)
  // ----------------------------------------------------
  const MAX_RECEIVERS = 8;

  // Shared by both transports: wires up a single receiver's connection
  // (PeerJS DataConnection on the cloud path, PeerJsCompatDataConnection on
  // the offline Wi-Fi Direct path — API-compatible, so this logic doesn't
  // need to know which one it got) into the broadcast peer list.
  const handleIncomingReceiverConnection = (conn, code) => {
    // Broadcast mode: the room stays open to more receivers up to a cap,
    // rather than rejecting everyone after the first connects. (Wi-Fi Direct
    // sessions only ever have one incoming connection in practice, but the
    // same cap applies harmlessly.)
    if (connsRef.current.length >= MAX_RECEIVERS) {
      try { conn.send({ type: 'room-full' }); } catch { /* ignore */ }
      conn.close();
      return;
    }

    const peerState = {
      conn,
      id: conn.peer,
      queueIndex: 0,
      fileOffset: 0,
      totalBytesSent: 0,
      pendingSendNext: null,
      resumed: false,
      openTimer: null,
      // Set by a 'skip-duplicate' reply (feature: duplicate-file skip) —
      // streamChunksForPeer's sendNext() checks this and abandons the
      // current file mid-stream instead of sending bytes nobody wants.
      skipCurrentFile: false
    };
    connsRef.current = [...connsRef.current, peerState];
    setConnectedCount(connsRef.current.length);
    setTransferState('transferring');
    recordConnection({ deviceName: `Receiver (${roomCode})`, roomCode: roomCode, direction: 'sent' });
    showToast(
      connsRef.current.length > 1
        ? `Receiver connected! (${connsRef.current.length} total)`
        : 'Receiver connected! Starting stream...',
      'info'
    );

    conn.on('open', () => {
      // Verified-handshake code (feature #4): derived from the room code
      // + this receiver's peer id, so both sides land on the same value
      // without exchanging anything extra over the wire.
      computeSecurityCode(code, conn.peer).then((securityCode) => {
        setPeerSecurityCodes((prev) => ({ ...prev, [conn.peer]: securityCode }));
      });

      // Give a reconnecting receiver a brief window to send a 'resume'
      // message before defaulting to a fresh batch-start — a plain new
      // connection just falls through once the timer fires.
      peerState.openTimer = setTimeout(() => {
        if (peerState.resumed) return;
        conn.send({ type: 'batch-start', totalFiles: sendQueueRef.current.length, totalBytes: totalQueueBytesRef.current });
        sendNextQueuedFileForPeer(peerState);
      }, 150);
    });

    conn.on('data', (data) => {
      if (data.type === 'chat-meta' || data.type === 'chat-done' || (data.type === 'chunk' && data.chatId)) {
        handleChatData(data, conn.peer);
        return;
      }
      if (data.type === 'abort') {
        // Receiver pre-flight-rejected the batch (e.g. not enough free
        // storage) — report why instead of the generic "disconnected"
        // message dropPeer's close-handling toast would otherwise show.
        showToast(
          `Receiver stopped the transfer: ${data.reason === 'insufficient-space' ? 'not enough storage space' : (data.reason || 'unknown reason')}`,
          'error'
        );
        return;
      }
      if (data.type === 'clip') {
        // Persistent clipboard channel (feature) — this can arrive any time
        // the connection is alive, not just mid-batch, since it rides the
        // same conn a completed transfer leaves open.
        const entry = { text: data.text, direction: 'received', peerLabel: conn.peer, sortTs: Date.now() };
        setSessionClips((prev) => [...prev, entry]);
        addClip(entry);
        showToast('New clip received', 'info');
        return;
      }
      if (data.type === 'skip-duplicate') {
        // Receiver already has this exact content (feature: duplicate-file
        // skip / delta folder sync) — only honor it for whichever file the
        // receiver was actually just told about, in case this arrives late
        // after the queue already moved on.
        if (data.fileIndex === peerState.queueIndex) {
          peerState.skipCurrentFile = true;
        }
        return;
      }
      if (data.type !== 'resume') return;
      // The 150ms openTimer above may have already lost the race and started
      // a fresh batch-start + stream before this 'resume' arrived (common on
      // a jittery Wi-Fi Direct link). Starting a second concurrent stream on
      // top of that would interleave two chunk sequences into the same
      // receiver buffers — corrupting the file and desyncing receivedBytes
      // from the real byte count (seen as >100% progress / negative ETA).
      // Once the timer's already fired there's no safe way to un-send the
      // batch-start it issued, so just let that fresh batch run instead of
      // racing a second one.
      if (!peerState.openTimer) return;
      clearTimeout(peerState.openTimer);
      peerState.openTimer = null;
      peerState.resumed = true;

      const files = sendQueueRef.current;
      const fileIndex = Math.min(data.fileIndex || 0, Math.max(0, files.length - 1));
      const bytesBeforeThisFile = files.slice(0, fileIndex).reduce((sum, f) => sum + f.size, 0);

      peerState.queueIndex = fileIndex;
      peerState.totalBytesSent = bytesBeforeThisFile + (data.offset || 0);
      streamChunksForPeer(peerState, files[fileIndex], data.offset || 0);
    });

    const dropPeer = () => {
      connsRef.current = connsRef.current.filter((p) => p !== peerState);
      setConnectedCount(connsRef.current.length);
      setPeerSecurityCodes((prev) => {
        const next = { ...prev };
        delete next[peerState.id];
        return next;
      });
      // Room stays alive for more receivers unless the batch is done —
      // no peers left mid-transfer just means back to waiting for one.
      if (connsRef.current.length === 0) {
        setTransferState((prev) => (prev === 'complete' ? 'complete' : 'waiting'));
      }
    };

    conn.on('close', () => {
      const finishedQueue = peerState.queueIndex >= sendQueueRef.current.length;
      if (!finishedQueue) {
        showToast('A receiver disconnected before finishing.', 'error');
      }
      dropPeer();
    });

    conn.on('error', (err) => {
      showToast('Connection error with a receiver: ' + err.message, 'error');
      dropPeer();
    });
  };

  // Local-LAN fallback for the "Nearby on this Wi-Fi" list (feature #2):
  // while a cloud room is advertised over NSD, also listen for direct
  // offline connections on the LocalSignaling socket (the same plugin Wi-Fi
  // Direct uses, but dialed at this device's regular Wi-Fi IP instead of a
  // Wi-Fi Direct group address) so a same-network receiver can connect
  // without ever reaching PeerJS's cloud broker. Unlike
  // establishLocalSocketConnection (one-shot: resolves once and stops the
  // server), this keeps the server running and wires up every receiver that
  // connects while the room stays open, same as the PeerJS 'connection'
  // event does for the cloud path.
  const startLocalRoomHost = (code) => startLocalSocketRoomHost(code, handleIncomingReceiverConnection);

  // transportMode: 'cloud' (default, PeerJS broker — works cross-network as
  // long as both sides can reach the internet) or 'local' (Wi-Fi Direct, zero
  // internet/router needed — see establishLocalSocketConnection above). groupInfo
  // is required for 'local' and comes from a completed WifiDirect connection.
  const startP2PSend = (transportMode = 'cloud', groupInfo = null) => {
    if (!selectedFiles || selectedFiles.length === 0) {
      showToast('Select a file to send first.', 'error');
      return;
    }
    cleanup();
    // Stale hotspot-fallback QR text shouldn't linger into an unrelated
    // cloud or plain-Wi-Fi-Direct send — only startHotspotFallbackSend's own
    // call (which sets hotspotCredentials right before this) should keep it.
    if (!(transportMode === 'local' && groupInfo?.kind === 'hotspot')) {
      setHotspotCredentials(null);
    }
    senderTransportRef.current = transportMode;
    setIsPaused(false);
    isPausedRef.current = false;
    sendQueueRef.current = selectedFiles;
    sendQueueIndexRef.current = 0;
    totalQueueBytesRef.current = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    setSendFileCount(selectedFiles.length);
    setSendFileIndex(0);
    setConnectedCount(0);
    transferStartTime.current = Date.now();

    if (transportMode === 'local') {
      const code = generateRoomCode();
      setRoomCode(code);
      // No PeerJS Peer exists on this path — a thin stand-in gives cleanup()
      // an object shaped like one so it can tear down the underlying link the
      // same way it destroys a real Peer. groupInfo.kind distinguishes a
      // hotspot-fallback link (feature: Wi-Fi Direct → hotspot) from a plain
      // Wi-Fi Direct one, since they need different native teardown calls.
      peerRef.current = {
        destroy: () => {
          if (groupInfo?.kind === 'hotspot') {
            if (groupInfo.isGroupOwner) hotspotStop(); else hotspotLeave();
          } else {
            wifiDirectRemoveGroup();
          }
        }
      };

      // Stays on the home screen (no setMode/setTransferState here) until the
      // handshake actually completes — the Wi-Fi Direct group forming just
      // means both devices tapped connect, not that the other side is ready
      // to receive; jumping to a "connecting" screen before that point is
      // what looked like it skipped waiting for the other person entirely.
      //
      // Hotspot fallback is the opposite: unlike Wi-Fi Direct, nobody has
      // found anybody yet at this point — the QR code on the waiting screen
      // is what the other device needs to scan to join at all. Staying on
      // the home screen here would mean the QR never renders and the
      // handshake this promise is waiting on can never happen.
      if (groupInfo?.kind === 'hotspot') {
        setMode('p2p-send');
        setTransferState('waiting');
      }

      return establishLocalSocketConnection({
        isGroupOwner: groupInfo.isGroupOwner,
        groupOwnerAddress: groupInfo.groupOwnerAddress,
        roomCode: code,
        deviceName: getDeviceLabel()
      })
        .then(({ conn, roomCode: agreedCode }) => {
          setRoomCode(agreedCode);
          setMode('p2p-send');
          setTransferState('waiting');
          showToast(groupInfo?.kind === 'hotspot' ? 'Hotspot link ready!' : 'Offline Wi-Fi Direct link ready!', 'success');
          handleIncomingReceiverConnection(conn, agreedCode);
        })
        .catch((err) => {
          showToast('Offline connection failed: ' + err.message, 'error');
          // Hotspot fallback already jumped to the waiting/QR screen above
          // (unlike Wi-Fi Direct, which never left home on failure) — back
          // out of it on failure instead of leaving the user stuck looking
          // at a QR code that can no longer connect.
          if (groupInfo?.kind === 'hotspot') {
            setMode('home');
            setTransferState('idle');
            setHotspotCredentials(null);
          }
        });
    }

    setTransferState('preparing');
    setMode('p2p-send');

    const attemptConnection = (retryCount = 0) => {
      if (retryCount > 5) {
        setErrorMsg('Could not allocate a unique room code. Try again later.');
        setTransferState('error');
        return;
      }

      const code = generateRoomCode();
      setRoomCode(code);

      // Initialize peer with our room code
      const peer = new Peer(code, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: import.meta.env.DEV ? 2 : 0,
        config: ICE_SERVERS
      });

      peerRef.current = peer;

      // An unreachable broker doesn't error — the socket just never opens
      // (see cloudOpenWatchdogRef). This is what catches the case
      // navigator.onLine reports as online: a live Wi-Fi interface with no
      // route out, which startAutoSend can't detect up front without making
      // every online send pay for a probe first.
      clearCloudOpenWatchdog();
      cloudOpenWatchdogRef.current = setTimeout(() => {
        cloudOpenWatchdogRef.current = null;
        degradeToOfflineSend('Could not reach the signaling server.');
      }, CLOUD_OPEN_TIMEOUT_MS);

      peer.on('open', () => {
        clearCloudOpenWatchdog();
        setTransferState('waiting');
        showToast('Direct P2P Room Ready!', 'success');
      });

      peer.on('connection', (conn) => handleIncomingReceiverConnection(conn, code));

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // Still mid-handshake with a fresh code — the watchdog is re-armed
          // by the retry, so drop the current one rather than letting it fire
          // against an attempt that has already been superseded.
          clearCloudOpenWatchdog();
          peer.destroy();
          attemptConnection(retryCount + 1);
        } else {
          clearCloudOpenWatchdog();
          // 'network' / 'server-error' / 'socket-error' all mean the broker
          // itself is unreachable, which is exactly the offline case — hand
          // those to the degrade path instead of dead-ending on an error
          // screen. Anything else is a genuine peer-level fault.
          const brokerUnreachable = ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type);
          if (brokerUnreachable) {
            degradeToOfflineSend('Could not reach the signaling server.');
            return;
          }
          setTransferState((prev) => {
            if (prev === 'complete') return 'complete';
            showToast('P2P Error: ' + err.message, 'error');
            setErrorMsg(err.message || 'Error connecting to peer network.');
            return 'error';
          });
        }
      });
    };

    attemptConnection(0);
  };

  // Recomputes the ring/speed/ETA from whichever connected receiver is
  // furthest behind, so the UI reflects "done when everyone's done" rather
  // than one arbitrary peer.
  const updateAggregateStats = () => {
    const peers = connsRef.current;
    if (peers.length === 0) return;

    const total = totalQueueBytesRef.current || 1;
    const minFraction = Math.min(...peers.map((p) => p.totalBytesSent / total));
    setTransferProgress(Math.min(100, minFraction * 100));

    const slowest = peers.reduce((a, b) => (a.totalBytesSent <= b.totalBytesSent ? a : b));
    setSendFileIndex(Math.min(slowest.queueIndex, Math.max(0, sendQueueRef.current.length - 1)));

    const elapsed = (Date.now() - transferStartTime.current) / 1000;
    const speed = elapsed > 0 ? slowest.totalBytesSent / elapsed : 0;
    setTransferSpeed(formatSpeed(speed));

    const remaining = Math.max(0, totalQueueBytesRef.current - slowest.totalBytesSent);
    setTimeRemaining(formatTime(speed > 0 ? remaining / speed : 0));

    const files = sendQueueRef.current;
    const fileLabel = files.length > 1 ? `${files.length} files` : (files[0]?.name || 'file');
    notifyTransfer(
      `Sending ${fileLabel} to ${peers.length} receiver${peers.length === 1 ? '' : 's'}`,
      `${formatSpeed(speed)} · ${formatTime(speed > 0 ? remaining / speed : 0)} left`,
      Math.min(100, minFraction * 100)
    );
  };

  const sendNextQueuedFileForPeer = async (peerState) => {
    const idx = peerState.queueIndex;
    const files = sendQueueRef.current;

    if (idx >= files.length) {
      try { peerState.conn.send({ type: 'batch-complete' }); } catch { /* ignore */ }
      updateAggregateStats();
      if (connsRef.current.length > 0 && connsRef.current.every((p) => p.queueIndex >= files.length)) {
        setTransferState('complete');
        import('canvas-confetti').then(({ default: confetti }) => confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } }));
        playCompletionChime();
        triggerSuccessHaptic();
        showToast('Transfer completed!', 'success');
        const record = addHistoryEntry({
          direction: 'sent',
          kind: files.some((f) => f.type === TEXT_SNIPPET_MIME) ? 'text' : 'file',
          files: files.map((f) => ({ name: f.name, size: f.size })),
          peerLabel: `${connsRef.current.length} receiver${connsRef.current.length === 1 ? '' : 's'}`,
          roomCode,
          status: 'complete'
        });
        sentFilesMemory.set(record.id, files);
        setHistoryVersion((v) => v + 1);
      }
      return;
    }

    const file = files[idx];

    // SHA-256 for end-to-end integrity verification, cached as a Promise per
    // File so a broadcast to several receivers only hashes each file once
    // (each peer awaits the same in-flight Promise instead of re-hashing).
    // null on failure/no-SubtleCrypto — the receiver treats a null hash as
    // "skip verification" rather than failing the transfer.
    let hashPromise = fileHashCacheRef.current.get(file);
    if (!hashPromise) {
      hashPromise = computeFileHash(file).catch(() => null);
      fileHashCacheRef.current.set(file, hashPromise);
    }
    const sha256 = await hashPromise;

    // The peer may have dropped while we were hashing.
    if (!connsRef.current.includes(peerState)) return;

    try {
      peerState.conn.send({
        type: 'metadata',
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        fileIndex: idx,
        totalFiles: files.length,
        // Folder transfers (feature #6): the subfolder portion of
        // webkitRelativePath, e.g. "myFolder/sub" — empty for a plain file.
        relPath: file.webkitRelativePath
          ? file.webkitRelativePath.split('/').slice(0, -1).join('/')
          : '',
        sha256
      });
    } catch {
      return;
    }

    streamChunksForPeer(peerState, file);
  };

  const streamChunksForPeer = (peerState, file, startOffset = 0) => {
    let offset = startOffset;
    peerState.fileOffset = offset;

    const sendNext = () => {
      // Peer disconnected mid-stream — stop, dropPeer already handled cleanup
      if (!connsRef.current.includes(peerState)) return;

      // Receiver already has this file (feature: duplicate-file skip) —
      // abandon it wherever we are in the stream and move on, rather than
      // waiting for `offset >= file.size` to notice naturally.
      if (peerState.skipCurrentFile) {
        peerState.skipCurrentFile = false;
        const skippedSize = file.size - offset;
        peerState.totalBytesSent += skippedSize;
        peerState.queueIndex += 1;
        updateAggregateStats();
        sendNextQueuedFileForPeer(peerState);
        return;
      }

      // Paused: stash this peer's continuation, togglePauseTransfer resumes it
      if (isPausedRef.current) {
        peerState.pendingSendNext = sendNext;
        return;
      }

      // This file done for this peer — advance to their next queued file
      if (offset >= file.size) {
        peerState.queueIndex += 1;
        sendNextQueuedFileForPeer(peerState);
        return;
      }

      // Backpressure (cap RTCDataChannel buffer at 1MB) — per peer, since
      // each receiver drains at its own network speed
      if (peerState.conn.dataChannel && peerState.conn.dataChannel.bufferedAmount > 1024 * 1024) {
        setTimeout(sendNext, 40);
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (e) => {
        if (!connsRef.current.includes(peerState)) return;

        try {
          peerState.conn.send({
            type: 'chunk',
            chunk: e.target.result,
            offset: offset,
            done: offset + CHUNK_SIZE >= file.size
          });

          offset += slice.size;
          peerState.fileOffset = offset;
          peerState.totalBytesSent += slice.size;
          updateAggregateStats();

          // Bandwidth throttle (feature #8): cap this peer's outgoing rate by
          // delaying the next chunk instead of firing back-to-back — applied
          // per-connected-receiver, so a broadcast to several peers caps each
          // one's stream independently rather than sharing one global budget.
          const rateKBps = maxRateRef.current;
          if (rateKBps > 0) {
            const delayMs = (slice.size / (rateKBps * 1024)) * 1000;
            setTimeout(sendNext, delayMs);
          } else {
            sendNext();
          }
        } catch (err) {
          // Only this peer's stream failed — drop them, everyone else keeps going
          showToast('Error streaming to a receiver: ' + err.message, 'error');
          connsRef.current = connsRef.current.filter((p) => p !== peerState);
          setConnectedCount(connsRef.current.length);
        }
      };

      reader.onerror = () => {
        showToast('Failed to read file from disk.', 'error');
        connsRef.current = connsRef.current.filter((p) => p !== peerState);
        setConnectedCount(connsRef.current.length);
      };

      reader.readAsArrayBuffer(slice);
    };

    sendNext();
  };

  // ----------------------------------------------------
  // RECEIVER P2P WORKFLOW
  // ----------------------------------------------------
  const MAX_RECONNECT_ATTEMPTS = 3;

  function startP2PReceive(roomCodeInput, transportMode = 'cloud', groupInfo = null) {
    const code = roomCodeInput || targetPeerId;
    if (!code) {
      showToast('Please enter a valid room code.', 'error');
      return;
    }

    cleanup();
    setTargetPeerId(code);
    recordConnection({ deviceName: `Sender (${code})`, roomCode: code, direction: 'received' });
    reconnectAttemptRef.current = 0;
    currentFileIndexRef.current = 0;

    // 'local' (Wi-Fi Direct) stays on the home screen until the handshake
    // actually completes — see connectToSender's 'local' branch. Every other
    // transport still gets the immediate "connecting" screen since there's
    // no second person's action being waited on for those.
    if (transportMode !== 'local') {
      setTransferState('preparing');
      setMode('p2p-receive');
    }

    return connectToSender(code, false, transportMode, groupInfo);
  }

  // Snapshot of enough state to reconnect and resend a 'resume' message after
  // an app restart — see saveCheckpoint calls below and resumeInterruptedTransfer.
  // Native-only: the web receive path buffers chunks in memory (receivedChunks),
  // which is gone on reload regardless of what we persist here.
  const buildCheckpoint = () => ({
    direction: 'receive',
    fileIndex: currentFileIndexRef.current,
    offset: receivedBytes.current,
    incomingFileId: incomingFileIdRef.current,
    currentFile: incomingFileRef.current,
    totalFiles: incomingFileRef.current?.totalFiles || 1,
    roomCode: receiverTransportRef.current.roomCode,
    transportMode: receiverTransportRef.current.mode,
    groupInfo: receiverTransportRef.current.groupInfo
  });

  // Handles every 'data' message from the sender — shared by the initial
  // connection and any resumed reconnection, since a resume just continues
  // feeding this same handler mid-batch instead of starting over.
  const handleReceiverData = (data) => {
    if (data.type === 'chat-meta' || data.type === 'chat-done' || (data.type === 'chunk' && data.chatId)) {
      handleChatData(data, targetPeerId);
      return;
    }
    if (data.type === 'batch-start') {
      receivedFilesRef.current = [];
      setCompletedFiles([]);
      // Disk-space pre-check: reject the whole batch upfront with a clear
      // reason instead of letting appendChunk/finishReceive fail partway
      // through on a real ENOSPC. 10MB safety margin for filesystem overhead.
      if (Capacitor.isNativePlatform() && data.totalBytes) {
        NotifyDownload.checkFreeSpace().then(({ freeBytes }) => {
          const margin = 10 * 1024 * 1024;
          if (freeBytes < data.totalBytes + margin) {
            setTransferState('error');
            setErrorMsg(`Not enough storage space — need ${formatBytes(data.totalBytes)}, only ${formatBytes(freeBytes)} free.`);
            try { connRef.current?.send({ type: 'abort', reason: 'insufficient-space' }); } catch { /* ignore */ }
            connRef.current?.close();
          }
        }).catch(() => { /* couldn't check — proceed optimistically rather than block on it */ });
      }
    } else if (data.type === 'metadata') {
      currentFileIndexRef.current = data.fileIndex || 0;
      incomingFileRef.current = {
        name: data.name,
        size: data.size,
        type: data.mime,
        relPath: data.relPath || '',
        isText: data.mime === TEXT_SNIPPET_MIME,
        sha256: data.sha256 || null,
        totalFiles: data.totalFiles || 1
      };
      setIncomingFile(incomingFileRef.current);
      setReceiveFileIndex(data.fileIndex || 0);
      setReceiveFileCount(data.totalFiles || 1);
      setTransferProgress(0);
      setTransferSpeed('0 B/s');
      setTimeRemaining('--');
      receivedChunks.current = [];
      receivedBytes.current = 0;
      receivedTextChunksRef.current = [];
      incomingFileIdRef.current = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      writeChainRef.current = Promise.resolve();
      transferStartTime.current = Date.now();

      // Duplicate-file skip / delta folder sync: an identical file (by hash
      // + size) already sitting on this device doesn't need re-transferring.
      // Checked synchronously (localStorage) so the reply goes out before
      // the sender's first chunk in most cases, though not guaranteed — the
      // chunk handler below discards anything that slips through regardless.
      const isDuplicate = !data.isText && hasReceived(data.sha256, data.size);
      skippingCurrentFileRef.current = isDuplicate;
      if (isDuplicate) {
        try { connRef.current?.send({ type: 'skip-duplicate', fileIndex: data.fileIndex || 0 }); } catch { /* ignore */ }
        receivedFilesRef.current = [...receivedFilesRef.current, {
          name: data.name, size: data.size, relPath: data.relPath || '', isText: false, skipped: true, verified: true
        }];
        setCompletedFiles(receivedFilesRef.current);
        return;
      }

      if (Capacitor.isNativePlatform()) {
        checkpointThrottleRef.current = Date.now();
        saveCheckpoint(buildCheckpoint());
      }
    } else if (data.type === 'control') {
      setIsPeerPaused(data.action === 'pause');
    } else if (data.type === 'room-full') {
      setTransferState('error');
      setErrorMsg('This room already has the maximum number of receivers.');
    } else if (data.type === 'chunk') {
      // The sender may not have reacted to our 'skip-duplicate' reply yet —
      // discard anything that still arrives for this file rather than
      // writing bytes nobody asked for.
      if (skippingCurrentFileRef.current) return;
      if (Capacitor.isNativePlatform()) {
        // Stream this chunk to a temp file on the native side instead of
        // keeping it in JS memory — writeChain keeps appends in arrival
        // order even though each native call resolves asynchronously.
        const fileId = incomingFileIdRef.current;
        const base64Chunk = arrayBufferToBase64(data.chunk);
        writeChainRef.current = writeChainRef.current
          .then(() => NotifyDownload.appendChunk({ fileId, data: base64Chunk }))
          .catch((err) => showToast('Failed to write incoming data: ' + err.message, 'error'));
      } else {
        receivedChunks.current.push(data.chunk);
      }
      if (incomingFileRef.current?.isText) {
        // Small by nature (it's typed text) — safe to also keep in memory so
        // it can be rendered inline with a Copy button once complete.
        receivedTextChunksRef.current.push(data.chunk);
      }
      receivedBytes.current += data.chunk.byteLength;

      if (Capacitor.isNativePlatform()) {
        const now = Date.now();
        if (now - checkpointThrottleRef.current > 2000) {
          checkpointThrottleRef.current = now;
          saveCheckpoint(buildCheckpoint());
        }
      }

      const totalSize = incomingFileRef.current ? incomingFileRef.current.size : 0;

      if (totalSize > 0) {
        const pct = Math.min((receivedBytes.current / totalSize) * 100, 100);
        setTransferProgress(pct);

        const elapsed = (Date.now() - transferStartTime.current) / 1000;
        const speed = elapsed > 0 ? (receivedBytes.current / elapsed) : 0;
        setTransferSpeed(formatSpeed(speed));

        // Clamped at 0: extra/duplicate chunks (e.g. from a stream race, see
        // the resume-guard above) can push receivedBytes past totalSize —
        // without this an unclamped `remaining` goes negative and produces
        // a negative ETA that counts down below zero forever.
        const remaining = Math.max(0, totalSize - receivedBytes.current);
        const eta = speed > 0 ? (remaining / speed) : 0;
        setTimeRemaining(formatTime(eta));

        notifyTransfer(
          incomingFileRef.current ? incomingFileRef.current.name : 'Receiving file',
          `${formatSpeed(speed)} · ${formatTime(eta)} left`,
          pct
        );
      }

      if (data.done) {
        const mimeType = incomingFileRef.current ? incomingFileRef.current.type : 'application/octet-stream';
        const fileName = incomingFileRef.current ? incomingFileRef.current.name : 'downloaded-file';
        const fileSize = incomingFileRef.current ? incomingFileRef.current.size : receivedBytes.current;
        const relPath = incomingFileRef.current ? incomingFileRef.current.relPath : '';
        const isText = !!incomingFileRef.current?.isText;

        // Reconstruct a text snippet's full string from its buffered chunks,
        // in addition to (not instead of) saving it as a normal .txt file below.
        let snippetText = '';
        if (isText) {
          try {
            const decoder = new TextDecoder();
            snippetText = receivedTextChunksRef.current.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
          } catch {
            snippetText = '';
          }
          if (snippetText) {
            setReceivedTexts((prev) => [...prev, { name: fileName, text: snippetText, size: fileSize }]);
          }
        }

        if (Capacitor.isNativePlatform()) {
          const fileId = incomingFileIdRef.current;
          const expectedHash = incomingFileRef.current ? incomingFileRef.current.sha256 : null;
          writeChainRef.current = writeChainRef.current.then(async () => {
            try {
              // Integrity check (feature: end-to-end verification) — the
              // WebRTC DTLS layer protects the wire, but nothing else
              // verifies the bytes that actually landed on disk match what
              // the sender hashed before sending. A null expectedHash means
              // the sender couldn't hash (no SubtleCrypto) — skip rather
              // than fail a transfer we have no way to verify.
              if (expectedHash) {
                const { sha256: actualHash } = await NotifyDownload.hashFile({ fileId });
                if (actualHash !== expectedHash) {
                  await NotifyDownload.discardPartial({ fileId }).catch(() => {});
                  clearCheckpoint();
                  recordError('integrity-check', new Error(`Hash mismatch for ${fileName}: expected ${expectedHash}, got ${actualHash}`));
                  receivedFilesRef.current = [...receivedFilesRef.current, { name: fileName, size: fileSize, relPath, isText, verified: false, failed: true }];
                  setCompletedFiles(receivedFilesRef.current);
                  showToast(`${fileName} failed to verify — please retry the transfer.`, 'error');
                  return;
                }
              }
              const { uri } = await NotifyDownload.finishReceive({ fileId, fileName, mimeType, relPath });
              receivedFilesRef.current = [...receivedFilesRef.current, { name: fileName, size: fileSize, relPath, isText, uri, mimeType, verified: !!expectedHash }];
              setCompletedFiles(receivedFilesRef.current);
              if (!isText && expectedHash) recordReceived({ hash: expectedHash, size: fileSize, name: fileName });
              showToast(isText ? 'Text snippet received' : `${fileName} saved to Downloads`, 'success');
            } catch (err) {
              showToast(`Could not save ${fileName}: ${err.message}`, 'error');
            }
          });
        } else {
          const blob = new Blob(receivedChunks.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          receivedFilesRef.current = [...receivedFilesRef.current, { name: fileName, url, size: fileSize, relPath, isText }];
          setCompletedFiles(receivedFilesRef.current);
          if (!isText) saveReceivedFile(blob, fileName, url);
          const webExpectedHash = incomingFileRef.current ? incomingFileRef.current.sha256 : null;
          if (!isText && webExpectedHash) recordReceived({ hash: webExpectedHash, size: fileSize, name: fileName });
        }
      }
    } else if (data.type === 'clip') {
      // Persistent clipboard channel (feature) — arrives any time the
      // connection to the sender is still open, including well after
      // batch-complete (see the Complete-state clipboard panel).
      const entry = { text: data.text, direction: 'received', peerLabel: targetPeerId, sortTs: Date.now() };
      setSessionClips((prev) => [...prev, entry]);
      addClip(entry);
      showToast('New clip received', 'info');
    } else if (data.type === 'batch-complete') {
      setTransferState('complete');
      import('canvas-confetti').then(({ default: confetti }) => confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      }));
      playCompletionChime();
      triggerSuccessHaptic();
      showToast('Transfer completed!', 'success');
      clearCheckpoint();

      const finalizeHistory = () => {
        const filesToRecord = receivedFilesRef.current.length > 0
          ? receivedFilesRef.current.map((f) => ({ name: f.name, size: f.size, verified: f.verified, skipped: f.skipped }))
          : (incomingFileRef.current ? [{ name: incomingFileRef.current.name, size: incomingFileRef.current.size }] : []);

        addHistoryEntry({
          direction: 'received',
          kind: (receivedFilesRef.current.length > 0 ? receivedFilesRef.current : [incomingFileRef.current]).some((f) => f?.isText) ? 'text' : 'file',
          files: filesToRecord,
          peerLabel: targetPeerId,
          roomCode: targetPeerId,
          status: receivedFilesRef.current.some((f) => f.failed) ? 'partial' : 'complete'
        });
        setHistoryVersion((v) => v + 1);
      };

      if (Capacitor.isNativePlatform() && writeChainRef.current) {
        writeChainRef.current.then(finalizeHistory).catch(finalizeHistory);
      } else {
        finalizeHistory();
      }
    }
  };

  // A connection drop only warrants an auto-reconnect if it happened
  // mid-transfer (the PeerJS "lost connection to server" case); a failure
  // before that — bad code, sender never showed up — is a real error.
  const handleReceiverDrop = (code, err) => {
    setTransferState((prev) => {
      if (prev === 'complete') return 'complete';
      if (prev === 'transferring') {
        scheduleReconnectRetry(code);
        return 'reconnecting';
      }
      showToast(err ? 'Connection error: ' + err.message : 'Sender disconnected.', 'error');
      setErrorMsg(err ? err.message : 'The sender terminated the connection.');
      return 'error';
    });
  };

  const scheduleReconnectRetry = (code) => {
    reconnectAttemptRef.current += 1;
    if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
      setTransferState('error');
      setErrorMsg('Lost connection to the sender and could not reconnect.');
      return;
    }
    showToast(`Connection lost — reconnecting (attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS})…`, 'error');
    const { mode, groupInfo } = receiverTransportRef.current;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectToSender(code, true, mode, groupInfo);
    }, reconnectAttemptRef.current * 1000);
  };

  // Shared by both transports once a live conn (PeerJS DataConnection or
  // PeerJsCompatDataConnection) exists — wires open/data/close/error exactly
  // the same way regardless of which transport produced it.
  const wireReceiverConnection = (conn, code, isResume) => {
    connRef.current = conn;

    conn.on('open', () => {
      setTransferState('transferring');
      reconnectAttemptRef.current = 0;

      if (isResume) {
        showToast('Reconnected! Resuming transfer...', 'success');
        conn.send({ type: 'resume', fileIndex: currentFileIndexRef.current, offset: receivedBytes.current });
      } else {
        showToast('Connected! Requesting file...', 'success');
        transferStartTime.current = Date.now();
        receivedChunks.current = [];
        receivedBytes.current = 0;
        receivedFilesRef.current = [];
        setCompletedFiles([]);
      }
    });

    conn.on('data', handleReceiverData);
    conn.on('close', () => handleReceiverDrop(code));
    conn.on('error', (err) => handleReceiverDrop(code, err));
  };

  // isResume: re-establishing after a mid-transfer drop — skips wiping
  // already-received bytes and tells the sender exactly where to continue
  // from, instead of restarting the whole batch. transportMode/groupInfo
  // select the offline Wi-Fi Direct path instead of the default PeerJS cloud.
  const connectToSender = (code, isResume, transportMode = 'cloud', groupInfo = null) => {
    // roomCode lives on this ref (not just the targetPeerId state) so the
    // checkpoint-saving code below always reads the current value — a plain
    // state closure captured when the connection was wired would go stale
    // the moment setTargetPeerId fires later.
    receiverTransportRef.current = { mode: transportMode, groupInfo, roomCode: code };

    if (transportMode === 'local') {
      peerRef.current = {
        destroy: () => {
          if (groupInfo?.kind === 'hotspot') {
            if (groupInfo.isGroupOwner) hotspotStop(); else hotspotLeave();
          } else {
            wifiDirectRemoveGroup();
          }
        }
      };
      if (!isResume) showToast(groupInfo?.kind === 'hotspot' ? 'Connecting over hotspot...' : 'Connecting over Wi-Fi Direct...', 'info');

      return establishLocalSocketConnection({
        isGroupOwner: groupInfo.isGroupOwner,
        groupOwnerAddress: groupInfo.groupOwnerAddress,
        roomCode: code,
        deviceName: getDeviceLabel()
      })
        .then(({ conn, roomCode: agreedCode }) => {
          setTargetPeerId(agreedCode);
          // First connection only stays on the home screen (see
          // startP2PReceive) until this resolves — a mid-transfer resume
          // is already on the transfer screen, so no mode change needed.
          if (!isResume) setMode('p2p-receive');
          computeSecurityCode(agreedCode, conn.peer).then(setMySecurityCode);
          wireReceiverConnection(conn, agreedCode, isResume);
        })
        .catch((err) => {
          if (isResume) {
            scheduleReconnectRetry(code);
            return;
          }
          // Never left home for the initial attempt — just report it there
          // instead of transitioning to a dedicated error screen.
          showToast('Offline connection failed: ' + err.message, 'error');
        });
    }

    if (transportMode === 'lan') {
      peerRef.current = { destroy: () => {} };
      if (!isResume) showToast('Trying a direct local connection...', 'info');

      // Short timeout — this is a same-network peer discovered via NSD, not
      // a Wi-Fi Direct group with a guaranteed direct route, so a failed
      // attempt (different subnet, client isolation, sender not hosting a
      // local listener) should fall back to cloud quickly rather than making
      // the user wait out the full 30s establishLocalSocketConnection budget.
      establishLocalSocketConnection({
        isGroupOwner: false,
        groupOwnerAddress: groupInfo.host,
        roomCode: code,
        deviceName: getDeviceLabel()
      }, 4000)
        .then(({ conn, roomCode: agreedCode }) => {
          setTargetPeerId(agreedCode);
          computeSecurityCode(agreedCode, conn.peer).then(setMySecurityCode);
          wireReceiverConnection(conn, agreedCode, isResume);
        })
        .catch(() => {
          connectToSender(code, isResume, 'cloud', null);
        });
      return;
    }

    const peer = new Peer({
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      debug: import.meta.env.DEV ? 2 : 0,
      config: ICE_SERVERS
    });

    peerRef.current = peer;

    // Mirrors the sender's watchdog: an unreachable broker leaves the socket
    // silently un-opened rather than erroring, so without this a receiver
    // with no internet sits on "preparing" forever.
    clearCloudOpenWatchdog();
    cloudOpenWatchdogRef.current = setTimeout(() => {
      cloudOpenWatchdogRef.current = null;
      handleReceiverBrokerFailure(code, isResume);
    }, CLOUD_OPEN_TIMEOUT_MS);

    peer.on('open', () => {
      clearCloudOpenWatchdog();
      if (!isResume) showToast('Connecting to room ' + code + '...', 'info');

      computeSecurityCode(code, peer.id).then(setMySecurityCode);

      const conn = peer.connect(code, { reliable: true });
      wireReceiverConnection(conn, code, isResume);
    });

    peer.on('error', () => {
      clearCloudOpenWatchdog();
      handleReceiverBrokerFailure(code, isResume);
    });
  };

  // Receiver-side counterpart to degradeToOfflineSend. A receiver can't
  // unilaterally switch transports the way a sender can — it has nothing to
  // fall back *to* without a host to dial, since finding one offline needs
  // either a QR scan (hotspot credentials) or an already-formed Wi-Fi Direct
  // group. So instead of degrading, this distinguishes the two failures the
  // old single error message conflated, and arms an automatic retry for the
  // one that resolves itself.
  const handleReceiverBrokerFailure = async (code, isResume) => {
    if (isResume) {
      scheduleReconnectRetry(code);
      return;
    }
    const online = await isOnline({ force: true });
    if (online) {
      setTransferState((prev) => {
        if (prev === 'complete') return 'complete';
        showToast('Could not reach signaling server.', 'error');
        setErrorMsg('Signaling server connection failed. Check the code or try again.');
        return 'error';
      });
      return;
    }
    // Offline: the code is probably fine and the network is the problem, so
    // say that and wait rather than blaming the code. awaitConnectivity below
    // retries the join by itself the moment a route appears.
    setTransferState((prev) => {
      if (prev === 'complete') return 'complete';
      showToast('No internet — waiting for a connection…', 'info');
      setErrorMsg(
        "You're offline, so this room code can't be looked up. Reconnect to the internet and this will retry automatically — or scan the sender's QR code to connect without any network."
      );
      return 'error';
    });
    awaitConnectivityThenRejoin(code);
  };

  // Arms a one-shot rejoin for when connectivity comes back (feature:
  // automatic transport selection). Unsubscribes itself on the first
  // successful re-probe so a flapping interface can't stack up retries, and
  // re-checks mode/transferState at fire time so a user who navigated away or
  // connected some other way in the meantime isn't yanked back into a join.
  const awaitConnectivityThenRejoin = (code) => {
    if (connectivityRetryRef.current) connectivityRetryRef.current();
    const off = subscribeConnectivity(async () => {
      if (!(await isOnline({ force: true }))) return;
      if (connectivityRetryRef.current !== off) return;
      connectivityRetryRef.current = null;
      off();
      if (modeRef.current !== 'p2p-receive' || transferStateRef.current !== 'error') return;
      showToast('Back online — retrying…', 'info');
      connectToSender(code, false, 'cloud', null);
    });
    connectivityRetryRef.current = off;
  };

  // Web-only: a real browser's <a download> already writes to the Downloads
  // folder. Native path saves via NotifyDownload.appendChunk/finishReceive
  // as chunks arrive instead — see handleReceiverData.
  const saveReceivedFile = (blob, fileName, blobUrl) => {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyToClipboard = (text, message = 'Copied to clipboard!') => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message, 'success');
    }).catch(() => {
      showToast('Failed to copy.', 'error');
    });
  };

  const shareRoomCode = async (code) => {
    if (!code) return;
    triggerHaptic();
    const shareText = `Connect to my NovaShare room using code: ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'NovaShare Room Code',
          text: shareText
        });
        showToast('Room code shared!', 'success');
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyToClipboard(code, 'Room code copied to clipboard!');
        }
      }
    } else {
      copyToClipboard(code, 'Room code copied to clipboard!');
    }
  };

  const handleHostRoomCode = (customCode = null) => {
    cleanup();
    const code = customCode || generateRoomCode();
    setRoomCode(code);
    setTransferState('preparing');
    senderTransportRef.current = 'cloud';
    setIsPaused(false);
    isPausedRef.current = false;
    sendQueueRef.current = selectedFiles || [];
    sendQueueIndexRef.current = 0;
    totalQueueBytesRef.current = (selectedFiles || []).reduce((sum, f) => sum + f.size, 0);
    setSendFileCount((selectedFiles || []).length);
    setSendFileIndex(0);
    setConnectedCount(0);
    transferStartTime.current = Date.now();

    const peer = new Peer(code, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      debug: import.meta.env.DEV ? 2 : 0,
      config: ICE_SERVERS
    });

    peerRef.current = peer;

    clearCloudOpenWatchdog();
    cloudOpenWatchdogRef.current = setTimeout(() => {
      cloudOpenWatchdogRef.current = null;
      degradeToOfflineSend('Could not reach the signaling server.');
    }, CLOUD_OPEN_TIMEOUT_MS);

    peer.on('open', () => {
      clearCloudOpenWatchdog();
      setTransferState('waiting');
      showToast(`Your Room Code (${code}) is active!`, 'success');
    });

    peer.on('connection', (conn) => handleIncomingReceiverConnection(conn, code));

    peer.on('error', (err) => {
      clearCloudOpenWatchdog();
      if (err.type === 'unavailable-id') {
        handleHostRoomCode();
      } else {
        setErrorMsg(`Room setup error: ${err.message}`);
        setTransferState('error');
      }
    });
  };

  // Persistent clipboard channel (feature): sends a text snippet over
  // whichever DataConnection(s) are still open post-transfer — broadcasts to
  // every connected receiver on the sender side, or the single sender
  // connection on the receiver side. No-ops quietly if nothing's connected
  // anymore (the panel that calls this is itself gated on a live connection).
  const sendClip = () => {
    const text = clipDraft.trim();
    if (!text) return;
    const targets = connsRef.current.length > 0 ? connsRef.current.map((p) => p.conn) : (connRef.current ? [connRef.current] : []);
    if (targets.length === 0) {
      showToast('No longer connected — nothing to send this to.', 'error');
      return;
    }
    targets.forEach((conn) => {
      try { conn.send({ type: 'clip', text }); } catch { /* that peer dropped, others may still get it */ }
    });
    const entry = { text, direction: 'sent', peerLabel: mode === 'p2p-send' ? `${targets.length} receiver${targets.length === 1 ? '' : 's'}` : targetPeerId, sortTs: Date.now() };
    setSessionClips((prev) => [...prev, entry]);
    addClip(entry);
    setClipDraft('');
  };

  // Same broadcast-or-single-target resolution sendClip uses above, shared
  // by the chat composer's text option so "Chat" and "Quick clipboard" stay
  // one underlying channel instead of two competing ones.
  const sendChatText = () => {
    const text = chatDraft.trim();
    if (!text) return;
    const targets = connsRef.current.length > 0 ? connsRef.current.map((p) => p.conn) : (connRef.current ? [connRef.current] : []);
    if (targets.length === 0) {
      showToast('No longer connected — nothing to send this to.', 'error');
      return;
    }
    targets.forEach((conn) => {
      try { conn.send({ type: 'clip', text }); } catch { /* that peer dropped, others may still get it */ }
    });
    const entry = { text, direction: 'sent', peerLabel: mode === 'p2p-send' ? `${targets.length} receiver${targets.length === 1 ? '' : 's'}` : targetPeerId, sortTs: Date.now() };
    setSessionClips((prev) => [...prev, entry]);
    addClip(entry);
    setChatDraft('');
  };

  // Named (not inlined in the attach menu's JSX) so the ref click below
  // isn't read from inside a render-time array literal — same pattern
  // triggerFileInput/triggerFolderInput already use for the pre-send menu.
  const openChatFilePicker = () => {
    setShowChatAttach(false);
    chatFileInputRef.current?.click();
  };
  const openChatAppPicker = () => {
    setShowChatAttach(false);
    setShowChatApps(true);
  };
  const focusChatTextInput = () => {
    setShowChatAttach(false);
    document.getElementById('chat-text-input')?.focus();
  };

  const updateChatMessage = (id, patch) => {
    setChatMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  // Chat file/app attachment (feature): a small, self-contained protocol
  // riding the same live conn(s) sendClip/sendChatText use — deliberately
  // NOT the main batch-start/metadata/chunk pipeline above (see the
  // chatMessages state comment for why), so sending "one more file" mid- or
  // post-transfer can never disturb the primary transfer's own progress/
  // history/checkpoint state. No resume/pause/dedupe here on purpose — this
  // is the lightweight side channel, not a replacement for the main pipeline.
  const sendChatAttachment = async (file, isApp = false) => {
    const targets = connsRef.current.length > 0 ? connsRef.current.map((p) => p.conn) : (connRef.current ? [connRef.current] : []);
    if (targets.length === 0) {
      showToast('No longer connected — nothing to send this to.', 'error');
      return;
    }
    const chatId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = URL.createObjectURL(file);
    setChatMessages((prev) => [...prev, {
      id: chatId, direction: 'sent', kind: isApp ? 'app' : 'file',
      name: file.name, size: file.size, status: 'sending', progress: 0, sortTs: Date.now(),
      file, url, mime: file.type
    }]);
    targets.forEach((conn) => {
      try { conn.send({ type: 'chat-meta', chatId, name: file.name, size: file.size, mime: file.type, isApp }); } catch { /* peer dropped, others may still get it */ }
    });
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buf = await slice.arrayBuffer();
      targets.forEach((conn) => {
        try { conn.send({ type: 'chunk', chatId, chunk: buf }); } catch { /* peer dropped, others may still get it */ }
      });
      offset += buf.byteLength;
      updateChatMessage(chatId, { progress: file.size ? offset / file.size : 1 });
      // Same 1MB backpressure cap the main stream uses, checked against
      // whichever peer's channel — good enough for this side channel's
      // purpose (avoid unbounded buffering), not trying to be per-peer exact.
      const primary = targets[0];
      while (primary?.dataChannel && primary.dataChannel.bufferedAmount > 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    targets.forEach((conn) => {
      try { conn.send({ type: 'chat-done', chatId }); } catch { /* peer dropped, others may still get it */ }
    });
    updateChatMessage(chatId, { status: 'sent', progress: 1 });
  };

  // Shared by both the sender's per-peer data handler and the receiver's
  // handleReceiverData below — chat is bidirectional, either side can send.
  const handleChatData = (data, fromLabel) => {
    if (data.type === 'chat-meta') {
      chatBuffersRef.current.set(data.chatId, { chunks: [], received: 0, meta: data });
      setChatMessages((prev) => [...prev, {
        id: data.chatId, direction: 'received', kind: data.isApp ? 'app' : 'file',
        name: data.name, size: data.size, status: 'receiving', progress: 0, sortTs: Date.now(), peerLabel: fromLabel
      }]);
    } else if (data.type === 'chunk' && data.chatId) {
      const buf = chatBuffersRef.current.get(data.chatId);
      if (!buf) return;
      buf.chunks.push(data.chunk);
      buf.received += data.chunk.byteLength;
      updateChatMessage(data.chatId, { progress: buf.meta.size ? buf.received / buf.meta.size : 1 });
    } else if (data.type === 'chat-done') {
      const buf = chatBuffersRef.current.get(data.chatId);
      if (!buf) return;
      const blob = new Blob(buf.chunks, { type: buf.meta.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      chatBuffersRef.current.delete(data.chatId);
      updateChatMessage(data.chatId, { status: 'received', progress: 1, url, file: blob });
    }
  };

  const handleOpenChatAttachment = (m) => {
    let fileUrl = m.url;
    if (!fileUrl && m.file) {
      fileUrl = URL.createObjectURL(m.file);
    }
    if (!fileUrl) {
      showToast('Attachment is still transferring…', 'info');
      return;
    }
    const type = getFileType(m.name);
    setChatPreviewItem({
      name: m.name,
      size: m.size,
      url: fileUrl,
      type,
      kind: m.kind,
      direction: m.direction
    });
  };

  // One merged, time-ordered timeline for the Chat overlay — text clips
  // (sessionClips, the pre-existing "Quick clipboard" data) interleaved with
  // file/app attachments (chatMessages, new). Kept as two separate pieces of
  // state (so nothing about the existing clipboard panel had to change) and
  // only merged here, at render time.
  const unifiedChat = useMemo(() => {
    const clips = sessionClips.map((c, i) => ({
      id: `clip-${i}`, kind: 'text', direction: c.direction, text: c.text, peerLabel: c.peerLabel, sortTs: c.sortTs || 0
    }));
    return [...clips, ...chatMessages].sort((a, b) => (a.sortTs || 0) - (b.sortTs || 0));
  }, [sessionClips, chatMessages]);

  // Opens a just-received file in whatever app the device has for its type
  // (gallery, PDF viewer, etc.) via the same content:// URI it was saved
  // with — tapping a "File Received!" row just opens it, no re-navigating
  // to Downloads.
  const openReceivedFile = (f) => {
    if (!f.uri) return;
    NotifyDownload.openFile({ uri: f.uri, mimeType: f.mimeType || '*/*' }).catch(() => {
      showToast('No app found to open this file.', 'error');
    });
  };

  // Extract a room code from raw scanned QR text (full share URL or bare code)
  // Stop camera stream and scan loop
  const stopScanner = () => {
    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (scanStreamRef.current) {
      scanStreamRef.current.getTracks().forEach((track) => track.stop());
      scanStreamRef.current = null;
    }
    setShowScanner(false);
    setCameraReady(false);
    setQrDetected(false);
  };

  // Open camera and start scanning frames for a QR code with auto-adjust zoom
  const openScanner = async () => {
    setScannerError('');
    setCameraReady(false);
    setQrDetected(false);
    setShowScanner(true);
    try {
      const [{ default: jsQR }, stream] = await Promise.all([
        import('jsqr'),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        })
      ]);
      scanStreamRef.current = stream;

      // Auto-apply hardware camera zoom & continuous focus if supported
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && videoTrack.getCapabilities) {
        try {
          const caps = videoTrack.getCapabilities();
          const advanced = [];
          if (caps.zoom) {
            const maxZ = Math.min(caps.zoom.max || 1, 3.5);
            const targetZ = Math.min(maxZ, 2.0);
            advanced.push({ zoom: targetZ });
          }
          if (caps.focusMode && caps.focusMode.includes('continuous')) {
            advanced.push({ focusMode: 'continuous' });
          }
          if (advanced.length > 0) {
            videoTrack.applyConstraints({ advanced }).catch(() => {});
          }
        } catch {
          // Ignore constraint errors on unsupported devices
        }
      }

      if (scanVideoRef.current) {
        scanVideoRef.current.srcObject = stream;
        await scanVideoRef.current.play();
        setCameraReady(true);
      }

      const canvas = scanCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let isProcessingHit = false;
      let lastScanTime = 0;

      const tick = (now) => {
        const video = scanVideoRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA && !isProcessingHit) {
          // Throttle QR scanning to ~75ms interval (~13 FPS) for ultra-low CPU load and 60 FPS video preview
          if (!now || now - lastScanTime >= 75) {
            lastScanTime = now;
            // Downscale analysis canvas to max 640px dimension for maximum jsQR speed
            const maxDim = 640;
            let sw = video.videoWidth;
            let sh = video.videoHeight;
            if (sw > maxDim || sh > maxDim) {
              const scale = maxDim / Math.max(sw, sh);
              sw = Math.floor(sw * scale);
              sh = Math.floor(sh * scale);
            }
            canvas.width = sw;
            canvas.height = sh;
            ctx.drawImage(video, 0, 0, sw, sh);

            // Pass 1: Full-frame scan (downscaled)
            let imageData = ctx.getImageData(0, 0, sw, sh);
            let code = jsQR(imageData.data, sw, sh);

            // Pass 2: Center-cropped 2x digital zoom scan for distant or small QR codes
            if (!code && sw > 150 && sh > 150) {
              const cropW = Math.floor(sw * 0.5);
              const cropH = Math.floor(sh * 0.5);
              const cropX = Math.floor((sw - cropW) / 2);
              const cropY = Math.floor((sh - cropH) / 2);
              const croppedData = ctx.getImageData(cropX, cropY, cropW, cropH);
              code = jsQR(croppedData.data, cropW, cropH);
            }

            if (code && code.data) {
              isProcessingHit = true;
              setQrDetected(true);
              triggerHaptic();

              const roomFromScan = extractRoomCode(code.data);
              const hotspotCreds = extractHotspotCredentials(code.data);

              // Visual auto-zoom snap before completing scan
              setTimeout(() => {
                stopScanner();
                if (hotspotCreds) {
                  joinHotspotFallback(roomFromScan, hotspotCreds);
                } else {
                  setTargetPeerId(roomFromScan);
                  startP2PReceive(roomFromScan);
                }
              }, 250);
              return;
            }
          }
        }
        scanRafRef.current = requestAnimationFrame(tick);
      };
      scanRafRef.current = requestAnimationFrame(tick);
    } catch {
      setScannerError('Camera access denied or unavailable.');
    }
  };

  // Warm-up preload jsQR in background for instant scanner launch & clean up on unmount
  useEffect(() => {
    import('jsqr').catch(() => {});
    return () => stopScanner();
  }, []);

  // Helper file icon component inside local scope
  const renderFileIconComponent = (fileName) => {
    const type = getFileType(fileName);
    const wrapperClass = "w-12 h-12 rounded-xl bg-[rgba(125,211,255,0.15)] flex items-center justify-center text-accent-cyan";
    switch (type) {
      case 'image': return <div className={wrapperClass}><FileImage size={24} /></div>;
      case 'video': return <div className={wrapperClass}><FileVideo size={24} /></div>;
      case 'audio': return <div className={wrapperClass}><FileAudio size={24} /></div>;
      case 'pdf': return <div className={wrapperClass} style={{color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.15)'}}><FileText size={24} /></div>;
      case 'archive': return <div className={wrapperClass} style={{color: '#eab308', backgroundColor: 'rgba(234, 179, 8, 0.15)'}}><FileArchive size={24} /></div>;
      case 'code': return <div className={wrapperClass} style={{color: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.15)'}}><FileCode size={24} /></div>;
      default: return <div className={wrapperClass}><FileIcon size={24} /></div>;
    }
  };

  // Chat becomes reachable the moment there's a live conn to send/receive
  // over — a connected receiver on the sender side, or an active/finished
  // receive on the receiver side (the conn stays open past 'complete').
  const chatAvailable = (mode === 'p2p-send' && connectedCount > 0) || (mode === 'p2p-receive' && (transferState === 'transferring' || transferState === 'complete'));
  const chatPeerLabel = mode === 'p2p-send' ? `${connectedCount} receiver${connectedCount === 1 ? '' : 's'}` : (targetPeerId || 'sender');
  const chatUnreadCount = chatMessages.filter((m) => m.direction === 'received').length;

  return (
    <div className="max-w-[1200px] w-full min-h-0 flex-1 mx-auto flex flex-col justify-start overflow-x-hidden gap-3 max-[640px]:gap-2 p-5 max-[640px]:p-3 max-[380px]:p-2 pt-[max(1.25rem,env(safe-area-inset-top))] max-[640px]:pt-[max(0.75rem,env(safe-area-inset-top))] max-[380px]:pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] max-[640px]:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-[380px]:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* HEADER */}
      <header className="flex items-center justify-between border-b border-border pb-5 max-[640px]:pb-3 max-[640px]:gap-2">
        <div className="flex items-center gap-3 cursor-pointer" onClick={resetToHome}>
          <Zap
            size={32}
            className="text-accent-purple drop-shadow-[0_0_8px_rgba(125,211,255,0.5)] w-8 h-8 max-[640px]:w-6 max-[640px]:h-6"
            fill="currentColor"
          />
          <h1 className="text-[1.75rem] max-[640px]:text-[1.4rem] max-[380px]:text-[1.15rem] font-heading">
            <span className="text-white">Nova</span><span className="bg-[linear-gradient(135deg,#5cc2ec_0%,#cdeeff_100%)] bg-clip-text text-transparent">Share</span>
          </h1>
          <span className="bg-bg-tertiary border border-[rgba(125,211,255,0.3)] text-accent-purple px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase max-[640px]:px-2 max-[640px]:py-[0.15rem] max-[640px]:text-[0.65rem] max-[380px]:hidden">
            Direct P2P
          </span>
        </div>
        <div>
          <button
            className="relative overflow-hidden flex items-center justify-center gap-2 bg-transparent border border-border text-text-primary font-heading font-medium py-2 px-4 rounded-[10px] text-[0.85rem] cursor-pointer transition-all duration-300 hover:bg-white/[0.04] hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={(e) => rippleTap(e, resetToHome)}
          >
            Reset
          </button>
        </div>
      </header>

      {/* UPDATE BANNER (Play Core flexible in-app update) */}
      {appUpdate && (
        <div className="fixed top-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))] left-4 right-4 max-w-[460px] mx-auto bg-[rgba(15,23,42,0.92)] backdrop-blur-md border border-accent-purple rounded-[14px] px-4 py-3 flex items-center gap-3 text-text-primary shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_15px_rgba(125,211,255,0.2)] z-[9999] animate-[slideIn_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-bg-tertiary flex items-center justify-center border border-border">
            {appUpdate.status === 'downloading'
              ? <RefreshCw size={17} className="text-accent-cyan animate-[spin_1.4s_linear_infinite]" />
              : appUpdate.status === 'downloaded'
                ? <Check size={17} className="text-accent-green" />
                : <Download size={17} className="text-accent-cyan" />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {appUpdate.status === 'downloading' && 'Downloading update…'}
              {appUpdate.status === 'downloaded' && 'Update ready to install'}
              {appUpdate.status === 'available' && 'A new version of NovaShare is available'}
            </p>
            {appUpdate.status === 'downloading' && (
              <div className="mt-2 h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-[width] duration-300 ease-out"
                  style={{ width: `${appUpdate.progress}%` }}
                />
              </div>
            )}
            {appUpdate.status === 'downloaded' && (
              <p className="text-xs text-text-secondary mt-0.5">Restart to finish installing.</p>
            )}
          </div>

          {appUpdate.status === 'available' && (
            <button
              className="flex-shrink-0 bg-accent-purple/15 border border-accent-purple text-accent-purple font-heading font-semibold py-1.5 px-3 rounded-[8px] text-[0.8rem] cursor-pointer transition-colors hover:bg-accent-purple/25"
              onClick={handleStartUpdate}
            >
              Update
            </button>
          )}
          {appUpdate.status === 'downloaded' && (
            <button
              className="flex-shrink-0 bg-accent-green/15 border border-accent-green text-accent-green font-heading font-semibold py-1.5 px-3 rounded-[8px] text-[0.8rem] cursor-pointer transition-colors hover:bg-accent-green/25"
              onClick={handleRestartUpdate}
            >
              Restart
            </button>
          )}

          {appUpdate.status !== 'downloading' && (
            <button
              className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleDismissUpdate}
              aria-label="Dismiss update notice"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* RESUME INTERRUPTED TRANSFER BANNER (feature: resume after app restart) */}
      {interruptedTransfer && (
        <div className="fixed top-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))] left-4 right-4 max-w-[460px] mx-auto bg-[rgba(15,23,42,0.92)] backdrop-blur-md border border-accent-purple rounded-[14px] px-4 py-3 flex items-center gap-3 text-text-primary shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_15px_rgba(125,211,255,0.2)] z-[9999] animate-[slideIn_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-bg-tertiary flex items-center justify-center border border-border">
            <Download size={17} className="text-accent-cyan" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">Interrupted transfer found</p>
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              {interruptedTransfer.currentFile?.name || 'A file'} — {formatBytes(interruptedTransfer.offset)} of {formatBytes(interruptedTransfer.currentFile?.size || 0)} received
            </p>
          </div>
          <button
            className="flex-shrink-0 bg-accent-purple/15 border border-accent-purple text-accent-purple font-heading font-semibold py-1.5 px-3 rounded-[8px] text-[0.8rem] cursor-pointer transition-colors hover:bg-accent-purple/25"
            onClick={resumeInterruptedTransfer}
          >
            Resume
          </button>
          <button
            className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            onClick={discardInterruptedTransfer}
            aria-label="Discard interrupted transfer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* TOAST POPUP */}
      {toast && (
        <div className="fixed top-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))] left-3 right-3 max-w-[490px] mx-auto bg-[rgba(15,23,42,0.94)] backdrop-blur-xl border border-accent-purple/50 rounded-xl px-3 py-2 flex items-center justify-between gap-2.5 text-text-primary shadow-[0_8px_30px_rgba(0,0,0,0.6),0_0_15px_rgba(168,85,247,0.2)] z-[99999] animate-[slideDown_0.25s_cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {toast.type === 'success' && <ShieldCheck size={16} className="text-accent-green flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle size={16} className="text-accent-pink flex-shrink-0" />}
            {toast.type === 'info' && <Info size={16} className="text-accent-cyan flex-shrink-0" />}
            <span className="text-[0.82rem] font-medium truncate leading-tight">{toast.message}</span>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors flex-shrink-0 flex items-center justify-center cursor-pointer border-0 bg-transparent"
            onClick={() => setToast(null)}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* MAIN LAYOUT CONTAINER */}
      <main className="flex-1 min-h-0 flex flex-col items-center justify-start py-2 pb-14">
        <div
          className={`w-full ${Capacitor.isNativePlatform() ? 'max-w-[490px]' : 'max-w-[490px] md:max-w-[640px] lg:max-w-[760px]'} flex-1 min-h-0 flex flex-col justify-start p-4 max-[640px]:p-3.5 max-[380px]:p-3 md:p-8 lg:p-10 bg-[rgba(15,23,42,0.45)] backdrop-blur-2xl border border-white/[0.08] rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.07),0_0_40px_rgba(125,211,255,0.04)] transition-[border-color,box-shadow,max-width] duration-300 hover:border-[rgba(125,211,255,0.25)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.12),0_0_50px_rgba(125,211,255,0.08)] overflow-y-auto touch-pan-y`}
        >
          {mainNavTab === 'connect' ? (
            <ConnectPanel
              mode={mode}
              roomCode={roomCode}
              targetPeerId={targetPeerId}
              chatPeerLabel={chatPeerLabel}
              connectedCount={connectedCount}
              nearbyPeers={nearbyPeers}
              wifiDirectPeers={wifiDirectPeers}
              onOpenChat={() => setShowChat(true)}
              onReconnectRoom={(code, autoChat = true) => {
                cleanup();
                setTargetPeerId(code);
                setMode('p2p-receive');
                setMainNavTab('home');
                setTransferState('preparing');
                startP2PReceive(code, 'cloud').then(() => {
                  if (autoChat) setShowChat(true);
                }).catch(() => {});
              }}
              onConnectPeer={(peer) => {
                handleConnectPeer(peer);
                setMainNavTab('home');
              }}
              onHostRoom={() => handleHostRoomCode()}
              onCopyRoomCode={(code) => copyToClipboard(code, 'Room code copied to clipboard!')}
              onShareRoomCode={(code) => shareRoomCode(code)}
              onShowQr={() => {
                if (!roomCode) {
                  handleHostRoomCode();
                }
                setShowQrZoom(true);
              }}
              formatWhen={(ts) => {
                const diff = Date.now() - ts;
                if (diff < 60000) return 'just now';
                if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
                if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
                return new Date(ts).toLocaleDateString();
              }}
            />
          ) : mainNavTab === 'settings' ? (
            <div className="flex-1 flex flex-col w-full pb-2">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h2 className="text-[1.5rem] font-bold glow-text flex items-center gap-2 m-0 font-heading">
                  <Settings size={22} className="text-accent-purple" /> Settings
                </h2>
              </div>
              <SettingsPanel
                formatBytes={formatBytes}
                maxRateKBps={maxRateKBps}
                onSelectMaxRate={(kbps) => {
                  setMaxRateKBps(kbps);
                  showToast(kbps === 0 ? 'Bandwidth cap set to Unlimited' : `Bandwidth cap set to ${kbps} KB/s`, 'info');
                }}
                appUpdate={appUpdate}
                onCheckUpdate={handleManualCheckUpdate}
                onStartUpdate={handleStartUpdate}
                onRestartUpdate={handleRestartUpdate}
                showToast={showToast}
              />
            </div>
          ) : (
          <>
            {mode === 'home' && (
              <div className="flex-1 min-h-0 flex flex-col w-full">
              <div className="text-center mb-4 max-[640px]:mb-3 flex-shrink-0">
                <h2 className="text-[1.5rem] max-[640px]:text-[1.35rem] max-[380px]:text-[1.2rem] leading-[1.2] mb-1 font-bold glow-text">Secure P2P File Sharing</h2>
                <p className="text-text-secondary text-[0.82rem] max-[380px]:text-[0.75rem]">Transfer files directly browser-to-browser. Encrypted & private.</p>
              </div>

              {/* TOP TAB SWITCHER: Home / Apps (hidden once a file is queued) */}
              {selectedFiles.length === 0 && (
                <div
                  className="flex flex-shrink-0 gap-[0.4rem] bg-[rgba(8,12,20,0.5)] border border-border rounded-xl p-[0.25rem] mb-4 max-[640px]:mb-3"
                  onPointerDown={onCardSwipeStart}
                  onPointerUp={onCardSwipeEnd}
                >
                  <button
                    type="button"
                    className={`flex-1 border-0 font-heading text-[0.82rem] font-semibold py-[0.45rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 ${homeTab === 'home' ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_10px_rgba(125,211,255,0.3)]' : 'bg-transparent text-text-muted hover:text-text-primary'}`}
                    onClick={() => setHomeTab('home')}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={`flex-1 border-0 font-heading text-[0.82rem] font-semibold py-[0.45rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 ${homeTab === 'apps' ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_10px_rgba(125,211,255,0.3)]' : 'bg-transparent text-text-muted hover:text-text-primary'}`}
                    onClick={() => setHomeTab('apps')}
                  >
                    Apps
                  </button>
                  <button
                    type="button"
                    className={`flex-1 border-0 font-heading text-[0.82rem] font-semibold py-[0.45rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 flex items-center justify-center gap-1 ${homeTab === 'history' ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_10px_rgba(125,211,255,0.3)]' : 'bg-transparent text-text-muted hover:text-text-primary'}`}
                    onClick={() => { setHomeTab('history'); setHistoryVersion((v) => v + 1); setHistoryOpenedAt(Date.now()); }}
                  >
                    <HistoryIcon size={13} /> History
                  </button>
                </div>
              )}

              {selectedFiles.length === 0 && homeTab === 'apps' ? (
                <AppsPanel
                  formatBytes={formatBytes}
                  onSelectApps={(files) => {
                    setSelectedFiles((prev) => [...prev, ...files]);
                    setHomeTab('home');
                  }}
                />
              ) : selectedFiles.length === 0 && homeTab === 'history' ? (
                <HistoryPanel
                  key={historyVersion}
                  now={historyOpenedAt}
                  formatBytes={formatBytes}
                  onResend={(entry) => {
                    const files = sentFilesMemory.get(entry.id);
                    if (!files || files.length === 0) {
                      showToast('Those files are no longer available — please reselect them.', 'error');
                      return;
                    }
                    setSelectedFiles(files);
                    setHomeTab('home');
                  }}
                  onClear={() => { clearHistory(); setHistoryVersion((v) => v + 1); }}
                />
              ) : (
              <>

              {/* FILE DROP ZONE (IF NO FILES SELECTED) */}
              {selectedFiles.length === 0 ? (
                <div
                  className={`group flex-shrink-0 border-2 border-dashed rounded-[18px] px-4 py-6 max-[640px]:py-4 max-[640px]:px-3 text-center cursor-pointer bg-[rgba(15,23,42,0.25)] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] relative overflow-hidden ${dragActive ? 'border-accent-cyan bg-[rgba(125,211,255,0.04)] shadow-[0_0_25px_rgba(125,211,255,0.12)]' : 'border-[rgba(125,211,255,0.25)] hover:border-accent-cyan hover:bg-[rgba(125,211,255,0.04)] hover:shadow-[0_0_25px_rgba(125,211,255,0.12)]'}`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={triggerFileInput}
                >
                  <input
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                  />
                  <div className="flex flex-col items-center gap-2.5">
                    <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center transition-all duration-300 ${dragActive ? 'bg-[rgba(125,211,255,0.15)] text-accent-cyan -translate-y-1' : 'bg-[rgba(125,211,255,0.08)] text-accent-purple group-hover:bg-[rgba(125,211,255,0.15)] group-hover:text-accent-cyan group-hover:-translate-y-1'}`}>
                      <UploadCloud size={24} />
                    </div>
                    <div>
                      <h3 className="text-[1.05rem] max-[380px]:text-[0.95rem] font-medium text-text-primary">Drag & drop your files here</h3>
                      <p className="text-[0.78rem] text-text-muted">or click to browse files from your device</p>
                    </div>
                    <span className="bg-bg-tertiary border border-[rgba(125,211,255,0.3)] text-accent-purple px-2.5 py-0.5 rounded-full text-[0.68rem] font-semibold tracking-wide uppercase">
                      No File Size Limits
                    </span>
                  </div>
                </div>
              ) : null}

              {selectedFiles.length === 0 && (
                <div className="flex items-center justify-center gap-3 mt-2.5 flex-shrink-0">
                  <button
                    type="button"
                    className="relative overflow-hidden flex items-center gap-1.5 bg-[rgba(30,41,59,0.4)] border border-border text-text-secondary text-[0.78rem] cursor-pointer py-[0.35rem] px-3 rounded-full transition-all duration-200 hover:bg-[rgba(125,211,255,0.1)] hover:border-[rgba(125,211,255,0.3)] hover:text-accent-cyan"
                    onClick={(e) => rippleTap(e, triggerFolderInput)}
                  >
                    <FolderUp size={13} /> Send a folder
                  </button>
                  <button
                    type="button"
                    className="relative overflow-hidden flex items-center gap-1.5 bg-[rgba(30,41,59,0.4)] border border-border text-text-secondary text-[0.78rem] cursor-pointer py-[0.35rem] px-3 rounded-full transition-all duration-200 hover:bg-[rgba(125,211,255,0.1)] hover:border-[rgba(125,211,255,0.3)] hover:text-accent-cyan"
                    onClick={(e) => rippleTap(e, () => setShowTextModal(true))}
                  >
                    <Type size={14} /> Send text
                  </button>
                  <input
                    type="file"
                    className="hidden"
                    ref={folderInputRef}
                    onChange={handleFolderSelect}
                    webkitdirectory=""
                    directory=""
                    multiple
                  />
                </div>
              )}

              {selectedFiles.length > 0 && (
                /* FILES SELECTED STATE CARD */
                <div className="flex-1 min-h-0 flex flex-col">
                  {selectedFiles.length === 1 ? (
                    <div className="flex items-center gap-4 bg-[rgba(30,41,59,0.4)] border border-border rounded-2xl p-5 mb-8 max-[380px]:px-3 max-[380px]:py-4 max-[380px]:gap-3">
                      <FileThumbnail file={selectedFiles[0]} size="md" />
                      <div className="flex-grow min-w-0">
                        <h4 className="text-[0.95rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{selectedFiles[0].name}</h4>
                        <p className="text-[0.8rem] text-text-secondary">{formatBytes(selectedFiles[0].size)}</p>
                      </div>
                      <button className="bg-transparent border-0 text-text-muted cursor-pointer p-1 rounded-md transition-all duration-200 hover:text-accent-pink hover:bg-[rgba(248,113,113,0.15)]" onClick={() => setSelectedFiles([])}>
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="flex justify-between items-baseline gap-2 text-[0.8rem] text-text-secondary mb-3 flex-wrap flex-shrink-0">
                        <span>{selectedFiles.length} files selected &middot; {formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))} total</span>
                        <span className="text-[0.72rem] text-text-muted">swipe or tap &times; to drop a file</span>
                      </div>
                      <div className="queue flex-1 min-h-[80px] max-h-[45vh] flex flex-col gap-[0.6rem] mb-6 overflow-y-auto p-3 pr-[0.6rem] rounded-2xl border border-border bg-[rgba(8,12,20,0.25)]">
                        {groupedQueue.map((item) => item.type === 'folder' ? (
                          <FolderQueueRow
                            key={`folder-${item.name}`}
                            name={item.name}
                            entries={item.entries}
                            formatBytes={formatBytes}
                            onRemoveAll={() => {
                              const dropIndexes = new Set(item.entries.map((e) => e.index));
                              setSelectedFiles((prev) => prev.filter((_, idx) => !dropIndexes.has(idx)));
                            }}
                            onRemoveOne={(index) => setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index))}
                          />
                        ) : (
                          <SwipeableFileRow
                            key={`${item.file.name}-${item.file.size}-${item.index}`}
                            file={item.file}
                            sizeLabel={formatBytes(item.file.size)}
                            onRemove={() => setSelectedFiles((prev) => prev.filter((_, idx) => idx !== item.index))}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="relative w-full mb-3 flex-shrink-0">
                    <button
                      type="button"
                      className="relative overflow-hidden flex items-center justify-center gap-2 w-full bg-transparent border border-border text-text-secondary text-[0.85rem] font-heading font-medium cursor-pointer py-[0.65rem] px-4 rounded-xl transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
                      onClick={(e) => rippleTap(e, () => setShowAddMoreMenu((v) => !v))}
                    >
                      <UploadCloud size={16} /> Add more
                      <ChevronDown size={14} className={`transition-transform duration-200 ${showAddMoreMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showAddMoreMenu && (
                      <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-bg-secondary border border-border rounded-xl p-1 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.4)] flex flex-col">
                        {[
                          { label: 'Add Files', icon: <UploadCloud size={16} />, onClick: triggerFileInput },
                          { label: 'Add Folder', icon: <FolderUp size={16} />, onClick: triggerFolderInput },
                          { label: 'Add Apps', icon: <Smartphone size={16} />, onClick: () => setShowAddApps(true) },
                          { label: 'Send Text', icon: <Type size={16} />, onClick: () => setShowTextModal(true) }
                        ].map((action) => (
                          <button
                            key={action.label}
                            type="button"
                            className="flex items-center gap-2.5 text-left text-[0.82rem] py-[0.55rem] px-3 rounded-lg border-0 bg-transparent text-text-secondary cursor-pointer hover:bg-white/5 hover:text-text-primary"
                            onClick={() => { setShowAddMoreMenu(false); action.onClick(); }}
                          >
                            {action.icon} {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                  />
                  <input
                    type="file"
                    className="hidden"
                    ref={folderInputRef}
                    onChange={handleFolderSelect}
                    webkitdirectory=""
                    directory=""
                    multiple
                  />

                  <div className="flex flex-col gap-3 flex-shrink-0">
                    <button className={BTN_PRIMARY} onClick={(e) => rippleTap(e, () => startAutoSend())}>
                      <Zap size={18} /> Start P2P Sharing Room
                    </button>
                    <button className={BTN_SECONDARY} onClick={(e) => rippleTap(e, () => setSelectedFiles([]))}>
                      Cancel Selection
                    </button>
                  </div>

                  {/* ADD APPS MODAL: append more apps to the existing queue */}
                  {showAddApps && (
                    <div className="fixed inset-0 bg-[rgba(4,6,12,0.85)] backdrop-blur-sm flex items-center justify-center z-[1000] p-5" onClick={(e) => rippleTap(e, () => setShowAddApps(false))}>
                      <div className="bg-bg-secondary border border-border rounded-[20px] p-4 w-full max-w-[360px] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)] has-[.apps-panel]:max-h-[80vh] has-[.apps-panel]:flex has-[.apps-panel]:flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3 font-heading font-semibold">
                          <span className="flex items-center gap-[0.4rem]">
                            <Smartphone size={16} /> Add Apps to Queue
                          </span>
                          <button className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary" onClick={(e) => rippleTap(e, () => setShowAddApps(false))} title="Close">
                            <X size={18} />
                          </button>
                        </div>
                        <AppsPanel
                          formatBytes={formatBytes}
                          onSelectApps={(files) => {
                            setSelectedFiles((prev) => [...prev, ...files]);
                            setShowAddApps(false);
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* NEARBY DEVICES (feature #2): same-Wi-Fi senders discovered via NSD — tap to connect with no code entry */}
              {selectedFiles.length === 0 && nearbyPeers.length > 0 && !wifiDirectConnecting && (
                <div className="mt-5 mb-2 flex-shrink-0">
                  <div className="flex items-center gap-[0.4rem] text-[0.78rem] text-text-muted mb-2">
                    <Radar size={14} className="text-accent-cyan" /> Nearby on this Wi-Fi
                  </div>
                  <div className="flex flex-col gap-2 max-h-[16vh] overflow-y-auto pr-[0.2rem]">
                    {nearbyPeers.map((peer) => (
                      <button
                        key={peer.roomCode}
                        type="button"
                        className="relative overflow-hidden flex items-center gap-3 bg-[rgba(125,211,255,0.08)] border border-[rgba(125,211,255,0.3)] rounded-xl py-[0.6rem] px-[0.8rem] text-left cursor-pointer transition-all duration-200 hover:bg-[rgba(125,211,255,0.15)]"
                        onClick={(e) => rippleTap(e, () => {
                          setTargetPeerId(peer.roomCode);
                          // Try connecting straight to the sender's LAN IP first (no
                          // internet needed); startP2PReceive/connectToSender falls
                          // back to the PeerJS cloud room transparently if that fails.
                          startP2PReceive(peer.roomCode, peer.host ? 'lan' : 'cloud', peer.host ? { host: peer.host } : null);
                        })}
                      >
                        <div className="w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center bg-[rgba(125,211,255,0.15)] text-accent-cyan">
                          <Laptop size={16} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <span className="text-[0.85rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{peer.deviceName}</span>
                          <span className="text-[0.72rem] text-text-muted">Tap to connect</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* NEARBY (OFFLINE): Wi-Fi Direct — no router, no shared Wi-Fi, no
                  internet required at all. Explicit opt-in toggle since it
                  needs a location/nearby-Wi-Fi permission prompt on first use. */}
              {wifiDirectAvailable && (
                <div className="mt-4 mb-2 flex-shrink-0">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-[0.4rem] text-[0.78rem] text-text-muted min-w-0">
                      <Zap size={14} className="text-accent-purple flex-shrink-0" /> <span>Nearby (offline, no Wi-Fi needed)</span>
                    </div>
                    <button
                      type="button"
                      className={`relative overflow-hidden flex-shrink-0 whitespace-nowrap flex items-center gap-1.5 text-[0.72rem] font-semibold rounded-full cursor-pointer py-1 px-3 border transition-all duration-200 ${
                        wifiDirectBrowsing
                          ? 'bg-accent-purple text-[#06222c] border-accent-purple'
                          : 'bg-[rgba(125,211,255,0.1)] text-accent-purple border-[rgba(125,211,255,0.3)] hover:bg-[rgba(125,211,255,0.18)]'
                      }`}
                      onClick={(e) => rippleTap(e, () => setWifiDirectBrowsing((prev) => !prev))}
                    >
                      {wifiDirectBrowsing && <span className="w-1.5 h-1.5 rounded-full bg-[#06222c] animate-pulse flex-shrink-0" />}
                      {wifiDirectBrowsing ? 'Stop searching' : 'Find devices'}
                    </button>
                  </div>

                  {wifiDirectBrowsing && wifiDirectWifiOff && (
                    <div className="flex items-center gap-2.5 bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.3)] rounded-xl py-2.5 px-3 my-1">
                      <AlertCircle size={16} className="text-accent-pink flex-shrink-0" />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[0.78rem] text-text-primary font-semibold leading-tight">Wi-Fi is off</p>
                        <p className="text-[0.72rem] text-text-muted leading-snug">Wi-Fi Direct needs the Wi-Fi radio on (no internet or router required) — this will resume automatically once it's on.</p>
                      </div>
                      <button
                        type="button"
                        className="relative overflow-hidden flex-shrink-0 bg-accent-pink/15 border border-accent-pink text-accent-pink font-heading font-semibold py-1.5 px-3 rounded-lg text-[0.75rem] cursor-pointer hover:bg-accent-pink/25"
                        onClick={(e) => rippleTap(e, wifiDirectOpenWifiSettings)}
                      >
                        Open Settings
                      </button>
                    </div>
                  )}

                  {wifiDirectBrowsing && !wifiDirectWifiOff && wifiDirectLocationOff && (
                    <div className="flex items-center gap-2.5 bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.3)] rounded-xl py-2.5 px-3 my-1">
                      <AlertCircle size={16} className="text-accent-pink flex-shrink-0" />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[0.78rem] text-text-primary font-semibold leading-tight">Location is off</p>
                        <p className="text-[0.72rem] text-text-muted leading-snug">Android requires it to find nearby devices — this will resume automatically once it's on.</p>
                      </div>
                      <button
                        type="button"
                        className="relative overflow-hidden flex-shrink-0 bg-accent-pink/15 border border-accent-pink text-accent-pink font-heading font-semibold py-1.5 px-3 rounded-lg text-[0.75rem] cursor-pointer hover:bg-accent-pink/25"
                        onClick={(e) => rippleTap(e, wifiDirectOpenLocationSettings)}
                      >
                        Open Settings
                      </button>
                    </div>
                  )}

                  {wifiDirectBrowsing && !wifiDirectWifiOff && !wifiDirectLocationOff && wifiDirectPeers.length === 0 && (
                    <div className="text-[0.78rem] text-text-muted py-1">Searching nearby devices…</div>
                  )}

                  {wifiDirectPeers.length > 0 && (
                    <div className="flex flex-col gap-2 max-h-[16vh] overflow-y-auto pr-[0.2rem]">
                      {wifiDirectPeers.map((peer) => (
                        <button
                          key={peer.deviceAddress}
                          type="button"
                          disabled={!!wifiDirectConnecting}
                          className="relative overflow-hidden flex items-center gap-3 bg-[rgba(125,211,255,0.08)] border border-[rgba(125,211,255,0.3)] rounded-xl py-[0.6rem] px-[0.8rem] text-left cursor-pointer transition-all duration-200 hover:bg-[rgba(125,211,255,0.15)] disabled:opacity-60 disabled:cursor-wait"
                          onClick={(e) => rippleTap(e, () => connectToWifiDirectPeer(peer))}
                        >
                          <div className="w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center bg-[rgba(125,211,255,0.15)] text-accent-purple">
                            <Smartphone size={16} />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span className="text-[0.85rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{peer.deviceName}</span>
                            <span className="text-[0.72rem] text-text-muted">
                              {wifiDirectConnecting === peer.deviceAddress ? 'Waiting for them to tap too…' : 'No internet needed — tap to connect'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {wifiDirectConnecting && (
                    <div className="flex items-center gap-2 text-[0.75rem] text-accent-purple py-2 px-1">
                      <RefreshCw size={13} className="animate-[spin_1.1s_linear_infinite] flex-shrink-0" />
                      <span>Connecting requires both devices to tap — ask the other person to tap your device in their "Find devices" list too.</span>
                    </div>
                  )}

                  {/* HOTSPOT FALLBACK (feature: Wi-Fi Direct → hotspot) —
                      manual escape hatch for when Wi-Fi Direct itself is
                      flaky/unavailable on this hardware. Sender-only UI; the
                      receiving device just scans the resulting QR code with
                      the existing "Scan QR Code" button, which detects the
                      hotspot credentials automatically. */}
                  {hotspotSupported && selectedFiles.length > 0 && !wifiDirectConnecting && (
                    <button
                      type="button"
                      disabled={hotspotStarting}
                      className="relative overflow-hidden mt-2 w-full flex items-center justify-center gap-1.5 text-[0.72rem] font-semibold rounded-full cursor-pointer py-1.5 px-3 border border-border bg-transparent text-text-secondary transition-all duration-200 hover:bg-white/[0.04] hover:text-text-primary disabled:opacity-60 disabled:cursor-wait"
                      onClick={(e) => rippleTap(e, startHotspotFallbackSend)}
                      title="If Wi-Fi Direct isn't connecting, host a hotspot instead"
                    >
                      {hotspotStarting ? 'Starting hotspot…' : "Wi-Fi Direct not connecting? Try hotspot fallback"}
                    </button>
                  )}
                </div>
              )}

              {/* RECEIVE AREA (ONLY SHOW IF NO FILE CURRENTLY BEING SENT). Hidden
                  (not just disabled) while a Wi-Fi Direct handshake is pending —
                  startP2PReceive's setTargetPeerId() would otherwise fill this
                  box with the Wi-Fi Direct room code and make it look like a
                  code got typed in on its own. */}
              {selectedFiles.length === 0 && !wifiDirectConnecting && (
                <div className="mb-2 flex-shrink-0">
                  <div className="flex items-center text-center my-3 text-text-muted text-[0.8rem] before:content-[''] before:flex-1 before:border-b before:border-border before:mr-3 after:content-[''] after:flex-1 after:border-b after:border-border after:ml-3">or receive a file</div>
                  <div className="flex flex-col gap-3">
                    <div className="relative flex items-center gap-[0.4rem] w-full min-w-0">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex items-center">
                        <Download size={20} />
                      </div>
                      <input
                        type="text"
                        placeholder="Enter Room Code (e.g. 4D8G2X)"
                        className="w-auto flex-1 min-w-0 bg-[rgba(8,12,20,0.5)] border border-border rounded-xl py-[0.8rem] pr-4 pl-10 font-heading text-[0.95rem] text-text-primary outline-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(125,211,255,0.12)]"
                        value={targetPeerId}
                        onChange={(e) => setTargetPeerId(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && startP2PReceive()}
                      />
                      <button
                        className="relative overflow-hidden flex-shrink-0 bg-transparent border border-border text-text-secondary cursor-pointer flex items-center p-[0.7rem] rounded-xl transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
                        onClick={(e) => rippleTap(e, openScanner)}
                        title="Scan QR Code"
                      >
                        <QrCode size={20} />
                      </button>
                    </div>
                    <button
                      className={`${targetPeerId.trim() ? `${BTN_PRIMARY} shadow-[0_2px_14px_rgba(125,211,255,0.35)]` : BTN_SECONDARY} justify-center mb-1`}
                      onClick={(e) => rippleTap(e, () => startP2PReceive())}
                    >
                      Connect & Download
                    </button>
                  </div>
                </div>
              )}

              {/* QR SCANNER MODAL */}
              {showScanner && (
                <div className="fixed inset-0 bg-[rgba(4,6,12,0.85)] backdrop-blur-sm flex items-center justify-center z-[1000] p-5" onClick={(e) => rippleTap(e, stopScanner)}>
                  <div className="bg-bg-secondary border border-border rounded-[20px] p-4 w-full max-w-[360px] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)]" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-3 font-heading font-semibold">
                      <span className="flex items-center gap-[0.4rem]">
                        <Camera size={16} /> Scan Room QR Code
                      </span>
                      <button className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary" onClick={(e) => rippleTap(e, stopScanner)} title="Close">
                        <X size={18} />
                      </button>
                    </div>
                    {scannerError ? (
                      <div className="flex items-center gap-2 text-text-secondary text-[0.9rem] px-2 py-8 text-center justify-center">
                        <AlertCircle size={18} /> {scannerError}
                      </div>
                    ) : (
                      <div className="relative w-full aspect-square rounded-[14px] overflow-hidden bg-black">
                        {!cameraReady && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <RefreshCw size={32} className="text-accent-purple drop-shadow-[0_0_10px_rgba(125,211,255,0.5)] animate-[spin_1.1s_linear_infinite]" />
                          </div>
                        )}
                        <video
                          ref={scanVideoRef}
                          className={`w-full h-full object-cover transition-transform duration-300 ease-out ${qrDetected ? 'scale-125' : 'scale-100'}`}
                          style={{ visibility: cameraReady ? 'visible' : 'hidden' }}
                          playsInline
                          muted
                        />
                        {cameraReady && (
                          <div className={`absolute inset-[12%] border-2 rounded-xl transition-all duration-300 pointer-events-none ${qrDetected ? 'border-accent-green shadow-[0_0_35px_rgba(74,222,128,0.9)] scale-90 bg-accent-green/10' : 'border-accent-purple shadow-[0_0_20px_rgba(125,211,255,0.4)]'}`} />
                        )}
                      </div>
                    )}
                    <canvas ref={scanCanvasRef} style={{ display: 'none' }} />
                  </div>
                </div>
              )}
              </>
              )}

              {/* SEND TEXT MODAL (feature #5) */}
              {showTextModal && (
                <div className="fixed inset-0 bg-[rgba(4,6,12,0.85)] backdrop-blur-sm flex items-center justify-center z-[1000] p-5" onClick={(e) => rippleTap(e, () => setShowTextModal(false))}>
                  <div className="bg-bg-secondary border border-border rounded-[20px] p-4 w-full max-w-[360px] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)]" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-3 font-heading font-semibold">
                      <span className="flex items-center gap-[0.4rem]">
                        <Type size={16} /> Send Text
                      </span>
                      <button className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary" onClick={(e) => rippleTap(e, () => setShowTextModal(false))} title="Close">
                        <X size={18} />
                      </button>
                    </div>
                    <textarea
                      autoFocus
                      rows={5}
                      placeholder="Paste or type a note, link, or password to send..."
                      className="w-full bg-[rgba(8,12,20,0.5)] border border-border rounded-xl p-3 font-heading text-[0.9rem] text-text-primary outline-none resize-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(125,211,255,0.12)]"
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                    />
                    <button
                      className={`${BTN_PRIMARY} w-full mt-3`}
                      disabled={!textDraft.trim()}
                      onClick={(e) => rippleTap(e, sendTextSnippet)}
                    >
                      <Zap size={16} /> Add to Queue
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* VIEW: SENDER P2P STATE                              */}
          {/* ==================================================== */}
          {mode === 'p2p-send' && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-full flex items-center gap-3 mb-1 flex-wrap">
                <button
                  className="relative overflow-hidden flex items-center justify-center gap-1 bg-transparent border border-border text-text-primary font-heading font-medium py-[0.4rem] px-3 rounded-lg text-[0.8rem] cursor-pointer transition-all duration-300 hover:bg-white/[0.04] hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={(e) => rippleTap(e, resetToHome)}
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <h3 className="font-[Georgia,'Iowan_Old_Style',serif] italic text-xl m-0 bg-[linear-gradient(120deg,var(--color-accent-purple),var(--color-accent-cyan))] bg-clip-text text-transparent">
                  Direct P2P Sharing
                </h3>
              </div>

              {/* File Info Inline Pill */}
              <div className="text-[0.85rem] text-text-secondary flex items-center gap-2 mb-1 bg-white/[0.03] py-[0.35rem] px-3 rounded-lg border border-border max-w-full w-fit min-w-0">
                <span className="font-semibold text-accent-cyan flex-shrink-0">Sharing:</span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">
                  {selectedFiles.length > 1 ? `${selectedFiles.length} files` : selectedFiles[0]?.name}
                </span>
                <span className="text-text-muted flex-shrink-0">({formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))})</span>
              </div>

              {/* Preparing: negotiating a room code with the signaling server */}
              {transferState === 'preparing' && (
                <div className="flex flex-col items-center gap-6 w-full">
                  <p className="text-text-secondary text-[0.925rem] max-[380px]:text-[0.85rem] font-medium text-center">
                    Setting up your P2P sharing room&hellip;
                  </p>
                  <RefreshCw size={40} className="text-accent-purple drop-shadow-[0_0_10px_rgba(125,211,255,0.5)] animate-[spin_1.1s_linear_infinite]" />
                  <p className="text-[0.85rem] text-text-muted max-w-[280px] text-center mx-auto">
                    Reaching the signaling server to allocate your room code. This can take a moment on a slow connection.
                  </p>
                </div>
              )}

              {/* Waiting for connection */}
              {transferState === 'waiting' && (
                <>
                  <div className="flex items-center justify-center w-full gap-3 my-1 mb-2" role="img" aria-label="Waiting for a peer to connect">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-[1] bg-[rgba(125,211,255,0.15)] border border-[rgba(125,211,255,0.4)] text-accent-purple shadow-[0_0_14px_rgba(125,211,255,0.25)]"><Zap size={18} /></div>
                    <div className="relative flex-1 min-w-[60px] max-w-[180px] h-[3px] rounded-full overflow-hidden bg-[linear-gradient(90deg,rgba(125,211,255,0.45),rgba(125,211,255,0.45))] shadow-[0_0_6px_rgba(125,211,255,0.3)] after:content-[''] after:absolute after:top-0 after:h-full after:w-[40%] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.95),transparent)] after:animate-[hsSweep_1.8s_ease-in-out_infinite]" />
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-[1] bg-[rgba(125,211,255,0.15)] border border-[rgba(125,211,255,0.4)] text-accent-cyan shadow-[0_0_14px_rgba(125,211,255,0.25)]"><Laptop size={18} /></div>
                  </div>
                  <p className="text-center text-[0.8rem] text-text-muted mb-2">Waiting for peers to scan or enter your code&hellip; anyone with it can join.</p>

                  {/* BANDWIDTH THROTTLE (feature #8) */}
                  <div className="relative w-full flex justify-center mb-2">
                    <button
                      type="button"
                      className="relative overflow-hidden flex items-center gap-2 bg-transparent border border-border text-text-secondary text-[0.78rem] cursor-pointer py-[0.35rem] px-3 rounded-lg hover:bg-white/5 hover:text-text-primary"
                      onClick={(e) => rippleTap(e, () => setShowRateMenu((v) => !v))}
                    >
                      <Gauge size={14} /> Speed limit: {RATE_PRESETS.find((r) => r.kbps === maxRateKBps)?.label || 'Unlimited'}
                    </button>
                    {showRateMenu && (
                      <div className="absolute top-full mt-1 z-10 bg-bg-secondary border border-border rounded-xl p-1 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.4)] flex flex-col min-w-[140px]">
                        {RATE_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className={`text-left text-[0.8rem] py-[0.4rem] px-3 rounded-lg border-0 cursor-pointer ${maxRateKBps === preset.kbps ? 'bg-[rgba(125,211,255,0.15)] text-accent-purple' : 'bg-transparent text-text-secondary hover:bg-white/5'}`}
                            onClick={() => { setMaxRateKBps(preset.kbps); setShowRateMenu(false); }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center justify-between bg-white/[0.03] border border-accent-purple/30 rounded-xl py-[0.5rem] px-[0.9rem]">
                      <RoomCodeFlap code={roomCode} />
                      <button
                        className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
                        onClick={(e) => rippleTap(e, () => copyToClipboard(roomCode, 'Room code copied!'))}
                        title="Copy Code"
                      >
                        <Copy size={16} />
                      </button>
                    </div>

                    <div className="flex flex-col items-center gap-2 bg-white/[0.03] border border-accent-purple/30 rounded-xl px-4 py-3">
                      <div
                        className="bg-white rounded-xl p-2 flex items-center justify-center cursor-pointer transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none"
                        onClick={() => setShowQrZoom(true)}
                        role="button"
                        tabIndex={0}
                        title="Tap to enlarge"
                      >
                        <QRCodeSVG
                          value={qrPayload}
                          size={92}
                          bgColor={"#ffffff"}
                          fgColor={"#0b0e1c"}
                          level={"M"}
                          includeMargin={false}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1 text-center max-w-[240px]">
                        <b className="text-text-primary text-[0.8rem]">{hotspotCredentials ? 'Scan to connect via hotspot' : 'Scan to connect'}</b>
                        <p className="text-[0.72rem] text-text-secondary leading-[1.5]">
                          {hotspotCredentials
                            ? 'No internet or Wi-Fi Direct needed — the other device joins your hotspot directly. Tap the QR code to enlarge.'
                            : 'Keep this tab open — the file streams directly, peer to peer. Tap the QR code to enlarge.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="flex flex-col gap-6 w-full">
                  <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(125,211,255,0.08)] border border-[rgba(125,211,255,0.2)] text-accent-cyan">
                    <Users size={14} /> {connectedCount} {connectedCount === 1 ? 'receiver' : 'receivers'} connected
                  </div>

                  {/* VERIFIED HANDSHAKE CODES (feature #4) — one per connected receiver */}
                  {Object.keys(peerSecurityCodes).length > 0 && (
                    <div className="flex flex-col gap-1 bg-white/[0.03] border border-border rounded-xl px-3 py-2 text-left">
                      <div className="flex items-center gap-1 text-[0.72rem] text-text-muted uppercase tracking-wide">
                        <ShieldQuestion size={12} /> Verify on both screens
                      </div>
                      {Object.entries(peerSecurityCodes).map(([peerId, code]) => (
                        <div key={peerId} className="flex items-center justify-between text-[0.8rem]">
                          <span className="text-text-muted">Receiver {peerId.slice(0, 4)}&hellip;</span>
                          <span className="font-mono font-semibold text-accent-cyan tracking-wider">{code}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {sendFileCount > 1 && (
                    <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(125,211,255,0.08)] border border-[rgba(125,211,255,0.2)] text-accent-purple">
                      File {sendFileIndex + 1} of {sendFileCount}: {selectedFiles[sendFileIndex]?.name}
                    </div>
                  )}

                  <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(125,211,255,0.1)] border border-[rgba(125,211,255,0.2)] text-accent-cyan">
                    <RefreshCw size={14} style={{animation: isPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPaused ? 'Paused' : 'Streaming File...'}
                  </div>

                  <div className="flex justify-center">
                    <TransferRing progress={transferProgress} gradientId="ringGradSend" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[rgba(8,12,20,0.4)] border border-border p-4 rounded-xl text-center">
                      <div className="text-xs text-text-muted uppercase mb-1 tracking-wide">Speed</div>
                      <div className="font-heading text-[1.15rem] font-semibold text-text-primary">{isPaused ? 'Paused' : (transferSpeed || 'Connecting...')}</div>
                    </div>
                    <div className="bg-[rgba(8,12,20,0.4)] border border-border p-4 rounded-xl text-center">
                      <div className="text-xs text-text-muted uppercase mb-1 tracking-wide">Estimated Time</div>
                      <div className="font-heading text-[1.15rem] font-semibold text-text-primary">{isPaused ? '--' : (timeRemaining || '--')}</div>
                    </div>
                  </div>

                  <button className={`${BTN_SECONDARY} w-full justify-center`} onClick={(e) => rippleTap(e, togglePauseTransfer)}>
                    {isPaused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
                  </button>

                  {/* BANDWIDTH THROTTLE (feature #8) — also shown mid-transfer
                      (not just on the waiting screen) so the manual override
                      mentioned in the battery-auto-throttle toast is actually
                      reachable while a transfer is running. */}
                  <div className="relative w-full flex justify-center">
                    <button
                      type="button"
                      className="relative overflow-hidden flex items-center gap-2 bg-transparent border border-border text-text-secondary text-[0.78rem] cursor-pointer py-[0.35rem] px-3 rounded-lg hover:bg-white/5 hover:text-text-primary"
                      onClick={(e) => rippleTap(e, () => setShowRateMenu((v) => !v))}
                    >
                      <Gauge size={14} /> Speed limit: {RATE_PRESETS.find((r) => r.kbps === maxRateKBps)?.label || 'Unlimited'}
                    </button>
                    {showRateMenu && (
                      <div className="absolute bottom-full mb-1 z-10 bg-bg-secondary border border-border rounded-xl p-1 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.4)] flex flex-col min-w-[140px]">
                        {RATE_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className={`text-left text-[0.8rem] py-[0.4rem] px-3 rounded-lg border-0 cursor-pointer ${maxRateKBps === preset.kbps ? 'bg-[rgba(125,211,255,0.15)] text-accent-purple' : 'bg-transparent text-text-secondary hover:bg-white/5'}`}
                            onClick={() => { setMaxRateKBps(preset.kbps); setShowRateMenu(false); }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(52,211,153,0.15)] text-accent-green drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="text-[1.75rem] mb-1 leading-[1.2] font-bold glow-text">Transfer Complete!</h3>
                    <p className="text-text-secondary text-[0.925rem]">
                      {sendFileCount > 1 ? `Your ${sendFileCount} files were shared directly and securely.` : 'Your file was shared directly and securely.'}
                    </p>
                  </div>

                  {/* PERSISTENT CLIPBOARD CHANNEL (feature) — the connection
                      from this transfer is still open; send another quick
                      snippet without starting a whole new transfer. */}
                  <div className="w-full bg-white/[0.03] border border-border rounded-2xl p-3 flex flex-col gap-2 text-left">
                    <div className="flex items-center gap-1.5 text-[0.72rem] text-text-muted uppercase tracking-wide">
                      <ClipboardCopy size={12} /> Quick clipboard
                    </div>
                    {sessionClips.length > 0 && (
                      <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
                        {sessionClips.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 bg-[rgba(125,211,255,0.06)] border border-[rgba(125,211,255,0.2)] rounded-lg px-2.5 py-1.5">
                            <span className="flex-1 min-w-0 text-[0.8rem] text-text-primary truncate">{c.text}</span>
                            <span className="text-[0.68rem] text-text-muted flex-shrink-0">{c.direction === 'sent' ? 'Sent' : 'Received'}</span>
                            <button type="button" className="flex-shrink-0 bg-transparent border-0 text-text-muted hover:text-accent-cyan cursor-pointer p-0.5" onClick={() => copyToClipboard(c.text)} title="Copy">
                              <Copy size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={clipDraft}
                        onChange={(e) => setClipDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') sendClip(); }}
                        placeholder="Send a quick note or link…"
                        className="flex-1 min-w-0 bg-[rgba(8,12,20,0.5)] border border-border rounded-lg px-3 py-2 text-[0.85rem] text-text-primary outline-none focus:border-accent-purple"
                      />
                      <button
                        type="button"
                        className="flex-shrink-0 bg-accent-purple/15 border border-accent-purple text-accent-purple font-heading font-semibold py-2 px-3 rounded-lg text-[0.8rem] cursor-pointer hover:bg-accent-purple/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!clipDraft.trim()}
                        onClick={(e) => rippleTap(e, sendClip)}
                      >
                        Send
                      </button>
                    </div>
                  </div>

                  <button className={`${BTN_PRIMARY} w-full`} onClick={(e) => rippleTap(e, resetToHome)}>
                    Share Another File
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(248,113,113,0.15)] text-accent-pink">
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="text-[1.75rem] mb-1 leading-[1.2] font-bold glow-text">Connection Interrupted</h3>
                    <p className="text-accent-pink text-[0.9rem]">{errorMsg}</p>
                  </div>
                  <div className="flex flex-col gap-3 w-full">
                    <button className={BTN_PRIMARY} onClick={(e) => rippleTap(e, () => startAutoSend())}>
                      Retry Transfer
                    </button>
                    <button className={BTN_SECONDARY} onClick={(e) => rippleTap(e, resetToHome)}>
                      Return Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* VIEW: RECEIVER P2P STATE                            */}
          {/* ==================================================== */}
          {mode === 'p2p-receive' && (
            <div className="flex flex-col items-center text-center gap-8">
              <div className="w-full flex items-center gap-3 mb-2 flex-wrap">
                <button
                  className="relative overflow-hidden flex items-center justify-center gap-1 bg-transparent border border-border text-text-primary font-heading font-medium py-[0.4rem] px-3 rounded-lg text-[0.8rem] cursor-pointer transition-all duration-300 hover:bg-white/[0.04] hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={(e) => rippleTap(e, resetToHome)}
                >
                  <ArrowLeft size={14} /> Leave
                </button>
                <h3 className="gradient-text font-heading text-xl m-0">
                  Direct P2P Receiver
                </h3>
              </div>

              {/* Connecting/Resolving */}
              {transferState === 'preparing' && (
                <>
                  <p className="text-text-secondary text-[0.925rem] max-[380px]:text-[0.85rem] mb-4 font-medium text-center">
                    Connecting to sender room <strong className="text-accent-cyan">{targetPeerId}</strong>&hellip;
                  </p>
                  <div className="flex items-center justify-center py-10 pb-6">
                    <RefreshCw size={40} className="text-accent-purple drop-shadow-[0_0_10px_rgba(125,211,255,0.5)] animate-[spin_1.1s_linear_infinite]" />
                  </div>
                  <p className="text-[0.85rem] text-text-muted max-w-[280px] text-center mx-auto mt-3">
                    Establishing WebRTC data tunnel. Ensure the sender has the page active.
                  </p>
                </>
              )}

              {/* Reconnecting: connection dropped mid-transfer, auto-retrying with what we've already received kept intact */}
              {transferState === 'reconnecting' && (
                <>
                  <p className="text-text-secondary text-[0.925rem] max-[380px]:text-[0.85rem] mb-4 font-medium text-center">
                    Connection lost &mdash; reconnecting&hellip;
                  </p>
                  <div className="flex items-center justify-center py-10 pb-6">
                    <RefreshCw size={40} className="text-accent-purple drop-shadow-[0_0_10px_rgba(125,211,255,0.5)] animate-[spin_1.1s_linear_infinite]" />
                  </div>
                  <p className="text-[0.85rem] text-text-muted max-w-[280px] text-center mx-auto mt-3">
                    Your progress is saved &mdash; the transfer will resume from where it left off.
                  </p>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="flex flex-col gap-6 w-full">
                  {receiveFileCount > 1 && (
                    <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(125,211,255,0.08)] border border-[rgba(125,211,255,0.2)] text-accent-purple">
                      File {receiveFileIndex + 1} of {receiveFileCount}
                    </div>
                  )}

                  {incomingFile && (
                    <div className="flex items-center gap-4 bg-[rgba(30,41,59,0.4)] border border-border rounded-2xl p-5 max-[380px]:px-3 max-[380px]:py-4 max-[380px]:gap-3 text-left w-full">
                      {renderFileIconComponent(incomingFile.name)}
                      <div className="flex-grow min-w-0">
                        <h4 className="text-[0.95rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{incomingFile.name}</h4>
                        <p className="text-[0.8rem] text-text-secondary">{formatBytes(incomingFile.size)}</p>
                      </div>
                    </div>
                  )}

                  <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(125,211,255,0.1)] border border-[rgba(125,211,255,0.2)] text-accent-purple">
                    <RefreshCw size={14} style={{animation: isPeerPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPeerPaused ? 'Paused by sender' : 'Receiving File...'}
                  </div>

                  {/* VERIFIED HANDSHAKE CODE (feature #4) */}
                  {mySecurityCode && (
                    <div className="flex items-center justify-center gap-2 bg-white/[0.03] border border-border rounded-xl px-3 py-2 text-[0.8rem]">
                      <ShieldQuestion size={13} className="text-text-muted flex-shrink-0" />
                      <span className="text-text-muted">Verify code matches sender:</span>
                      <span className="font-mono font-semibold text-accent-cyan tracking-wider">{mySecurityCode}</span>
                    </div>
                  )}

                  <div className="flex justify-center">
                    <TransferRing progress={transferProgress} gradientId="ringGradRecv" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[rgba(8,12,20,0.4)] border border-border p-4 rounded-xl text-center">
                      <div className="text-xs text-text-muted uppercase mb-1 tracking-wide">Download Speed</div>
                      <div className="font-heading text-[1.15rem] font-semibold text-text-primary">{transferSpeed || 'Negotiating...'}</div>
                    </div>
                    <div className="bg-[rgba(8,12,20,0.4)] border border-border p-4 rounded-xl text-center">
                      <div className="text-xs text-text-muted uppercase mb-1 tracking-wide">Time Remaining</div>
                      <div className="font-heading text-[1.15rem] font-semibold text-text-primary">{timeRemaining || '--'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(52,211,153,0.15)] text-accent-green drop-shadow-[0_0_10px_rgba(52,211,153,0.3)]">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="text-[1.75rem] mb-1 leading-[1.2] font-bold glow-text">
                      {completedFiles.length > 1 ? `${completedFiles.length} Files Received!` : 'File Received!'}
                    </h3>
                    <p className="text-text-secondary text-[0.925rem]">
                      {completedFiles.length > 1
                        ? 'All files were downloaded to your device.'
                        : `${completedFiles[0]?.name || incomingFile?.name || 'Shared file'} was successfully downloaded to your device.`}
                    </p>
                  </div>

                  {/* RECEIVED TEXT SNIPPETS (feature #5) — copy instead of download */}
                  {receivedTexts.length > 0 && (
                    <div className="flex flex-col gap-2 w-full text-left">
                      {receivedTexts.map((t, i) => (
                        <div key={i} className="bg-[rgba(125,211,255,0.08)] border border-[rgba(125,211,255,0.3)] rounded-xl p-3 flex flex-col gap-2">
                          <p className="text-[0.85rem] text-text-primary whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto m-0">{t.text}</p>
                          <button
                            type="button"
                            className="relative overflow-hidden self-end flex items-center gap-1 bg-transparent border border-[rgba(125,211,255,0.4)] text-accent-cyan text-[0.75rem] cursor-pointer py-1 px-2 rounded-md hover:bg-[rgba(125,211,255,0.12)]"
                            onClick={(e) => rippleTap(e, () => copyToClipboard(t.text, 'Text copied!'))}
                          >
                            <ClipboardCopy size={12} /> Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {completedFiles.filter((f) => !f.isText).length > 0 && (
                    <div className="flex flex-col gap-2 w-full">
                      {completedFiles.filter((f) => !f.isText).map((f, i) => (
                        f.skipped ? (
                          // Duplicate-file skip / delta folder sync: already had
                          // this exact content, so there's nothing new to open.
                          <div
                            key={i}
                            className="flex items-center gap-3 bg-white/[0.03] border border-border rounded-2xl py-3 px-4 text-left w-full"
                          >
                            <Check size={16} className="text-text-muted flex-shrink-0" />
                            <span className="text-[0.85rem] text-text-secondary">
                              {f.relPath ? `${f.relPath}/${f.name}` : f.name} — already had this file, skipped
                            </span>
                          </div>
                        ) : Capacitor.isNativePlatform() ? (
                          <button
                            key={i}
                            type="button"
                            className="relative overflow-hidden bg-gradient-to-br from-accent-green to-[#059669] text-[#080c14] border-0 font-heading font-bold text-[0.85rem] py-[1.2rem] px-8 rounded-2xl cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_4px_20px_rgba(52,211,153,0.4)] w-full mt-4 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(52,211,153,0.6)] hover:from-[#34d399] hover:to-[#047857]"
                            onClick={(e) => rippleTap(e, () => openReceivedFile(f))}
                          >
                            <Download size={16} /> {f.relPath ? `${f.relPath}/${f.name}` : f.name}
                          </button>
                        ) : (
                          <a
                            key={i}
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-gradient-to-br from-accent-green to-[#059669] text-[#080c14] border-0 font-heading font-bold text-[0.85rem] py-[1.2rem] px-8 rounded-2xl cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_4px_20px_rgba(52,211,153,0.4)] no-underline w-full mt-4 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(52,211,153,0.6)] hover:from-[#34d399] hover:to-[#047857]"
                          >
                            <Download size={16} /> {f.name}
                          </a>
                        )
                      ))}
                    </div>
                  )}

                  {/* PERSISTENT CLIPBOARD CHANNEL (feature) — the connection
                      back to the sender is still open; send a quick snippet
                      without starting a whole new transfer. */}
                  <div className="w-full bg-white/[0.03] border border-border rounded-2xl p-3 flex flex-col gap-2 text-left">
                    <div className="flex items-center gap-1.5 text-[0.72rem] text-text-muted uppercase tracking-wide">
                      <ClipboardCopy size={12} /> Quick clipboard
                    </div>
                    {sessionClips.length > 0 && (
                      <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
                        {sessionClips.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 bg-[rgba(125,211,255,0.06)] border border-[rgba(125,211,255,0.2)] rounded-lg px-2.5 py-1.5">
                            <span className="flex-1 min-w-0 text-[0.8rem] text-text-primary truncate">{c.text}</span>
                            <span className="text-[0.68rem] text-text-muted flex-shrink-0">{c.direction === 'sent' ? 'Sent' : 'Received'}</span>
                            <button type="button" className="flex-shrink-0 bg-transparent border-0 text-text-muted hover:text-accent-cyan cursor-pointer p-0.5" onClick={() => copyToClipboard(c.text)} title="Copy">
                              <Copy size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={clipDraft}
                        onChange={(e) => setClipDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') sendClip(); }}
                        placeholder="Send a quick note or link…"
                        className="flex-1 min-w-0 bg-[rgba(8,12,20,0.5)] border border-border rounded-lg px-3 py-2 text-[0.85rem] text-text-primary outline-none focus:border-accent-purple"
                      />
                      <button
                        type="button"
                        className="flex-shrink-0 bg-accent-purple/15 border border-accent-purple text-accent-purple font-heading font-semibold py-2 px-3 rounded-lg text-[0.8rem] cursor-pointer hover:bg-accent-purple/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!clipDraft.trim()}
                        onClick={(e) => rippleTap(e, sendClip)}
                      >
                        Send
                      </button>
                    </div>
                  </div>

                  <button className={`${BTN_SECONDARY} w-full mt-2`} onClick={(e) => rippleTap(e, resetToHome)}>
                    Close & Return
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(248,113,113,0.15)] text-accent-pink">
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="text-[1.75rem] mb-1 leading-[1.2] font-bold glow-text">Transfer Failed</h3>
                    <p className="text-accent-pink text-[0.9rem]">{errorMsg}</p>
                  </div>
                  <div className="flex flex-col gap-3 w-full">
                    <button className={BTN_PRIMARY} onClick={(e) => rippleTap(e, () => startP2PReceive())}>
                      Try Reconnecting
                    </button>
                    <button className={BTN_SECONDARY} onClick={(e) => rippleTap(e, resetToHome)}>
                      Return Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </main>

      {/* BOTTOM NAVIGATION BAR */}
      <nav className="fixed bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.5rem))] left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-2rem)] max-w-[390px] bg-[rgba(15,23,42,0.88)] backdrop-blur-2xl border border-white/[0.12] rounded-full p-1.5 flex items-center justify-between shadow-[0_10px_30px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.12)]">
        <button
          type="button"
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-full font-heading text-[0.85rem] font-semibold transition-all duration-200 border-0 cursor-pointer ${
            mainNavTab === 'home'
              ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_12px_rgba(125,211,255,0.35)]'
              : 'bg-transparent text-text-muted hover:text-text-primary'
          }`}
          onClick={(e) => {
            rippleTap(e, () => {
              setMainNavTab('home');
              triggerHaptic();
            });
          }}
        >
          <Home size={18} />
          <span>Home</span>
        </button>

        <button
          type="button"
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-full font-heading text-[0.85rem] font-semibold transition-all duration-200 border-0 cursor-pointer relative ${
            mainNavTab === 'connect'
              ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_12px_rgba(125,211,255,0.35)]'
              : 'bg-transparent text-text-muted hover:text-text-primary'
          }`}
          onClick={(e) => {
            rippleTap(e, () => {
              setMainNavTab('connect');
              triggerHaptic();
            });
          }}
        >
          <Radio size={18} />
          <span>Connect</span>
          {chatUnreadCount > 0 && (
            <span className="w-2.5 h-2.5 rounded-full bg-accent-pink absolute top-1.5 right-3 border-2 border-bg-primary" />
          )}
        </button>

        <button
          type="button"
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-full font-heading text-[0.85rem] font-semibold transition-all duration-200 border-0 cursor-pointer ${
            mainNavTab === 'settings'
              ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_12px_rgba(125,211,255,0.35)]'
              : 'bg-transparent text-text-muted hover:text-text-primary'
          }`}
          onClick={(e) => {
            rippleTap(e, () => {
              setMainNavTab('settings');
              triggerHaptic();
            });
          }}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>

      {/* QR ZOOM MODAL */}
      {showQrZoom && createPortal(
        <div className="fixed inset-0 bg-[rgba(4,6,12,0.92)] backdrop-blur-md flex items-center justify-center z-[2000] px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-[qrZoomFadeIn_0.18s_ease]" onClick={() => setShowQrZoom(false)}>
          <div className="bg-bg-secondary border border-border rounded-[20px] p-5 max-[380px]:p-4 w-full max-w-[340px] flex flex-col items-center gap-4 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)] animate-[qrZoomPopIn_0.2s_ease]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between w-full font-heading font-semibold text-[0.95rem] text-text-primary">
              <span>Scan to Connect</span>
              <button
                className="bg-white/[0.06] border border-border rounded-full w-8 h-8 flex-shrink-0 flex items-center justify-center text-text-primary cursor-pointer transition-colors duration-150 hover:bg-white/[0.14]"
                onClick={() => setShowQrZoom(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="bg-white p-4 rounded-2xl flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
              <QRCodeSVG
                value={qrPayload}
                size={240}
                bgColor={"#ffffff"}
                fgColor={"#0b0e1c"}
                level={"M"}
                includeMargin={false}
              />
            </div>
            <div className="flex gap-[0.4rem]">
              {roomCode.split('').map((ch, i) => (
                <span key={i} className="font-heading text-[1.15rem] font-bold tracking-[0.02em] text-accent-cyan bg-white/5 border border-border rounded-lg w-8 h-[38px] flex items-center justify-center">{ch}</span>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* CHAT LAUNCHER (feature): floating entry point into the chat
          section, visible any time there's a live connection to use it on —
          purely additive, doesn't change what the Waiting/Transferring/
          Complete screens already show. */}
      {chatAvailable && !showChat && createPortal(
        <button
          type="button"
          className="fixed bottom-[max(5.25rem,calc(env(safe-area-inset-bottom)+4.75rem))] right-5 z-[1900] w-14 h-14 rounded-full bg-accent-purple text-[#06222c] shadow-[0_10px_24px_-6px_rgba(125,211,255,0.55)] flex items-center justify-center cursor-pointer border-0"
          onClick={(e) => rippleTap(e, () => setShowChat(true))}
          title="Open chat"
        >
          <MessageCircle size={24} />
          {chatUnreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-accent-pink text-white text-[0.68rem] font-bold flex items-center justify-center border-2 border-bg-primary">
              {chatUnreadCount}
            </span>
          )}
        </button>,
        document.body
      )}

      {/* CHAT OVERLAY (feature): a persistent thread over the same live
          conn(s) — text (reusing the existing clipboard channel), files and
          installed apps, sendable any time after connecting, not just from
          the pre-send queue. See sendChatAttachment/handleChatData above for
          why this rides its own small protocol instead of the main one. */}
      {showChat && createPortal(
        <div className="fixed inset-0 bg-bg-primary z-[2000] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
            <button
              className="bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-1.5 rounded-md hover:bg-white/5 hover:text-text-primary"
              onClick={(e) => rippleTap(e, () => setShowChat(false))}
              title="Close chat"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-heading font-semibold text-[0.95rem] text-text-primary truncate">{chatPeerLabel}</div>
              <div className="text-[0.72rem] text-accent-green flex items-center gap-1.5">
                <span className="w-[6px] h-[6px] rounded-full bg-accent-green inline-block" />
                Connected — files, apps or a note, anytime
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-2.5">
            {unifiedChat.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-text-muted text-[0.85rem] px-8">
                <MessageCircle size={28} className="opacity-50" />
                Say hi, or use the paperclip to send a file, an app, or a note.
              </div>
            )}
            {unifiedChat.map((m) => {
              const mine = m.direction === 'sent';
              if (m.kind === 'text') {
                return (
                  <div key={m.id} className={`flex flex-col max-w-[78%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
                    <div className={`rounded-2xl px-3 py-2 text-[0.85rem] leading-snug ${mine ? 'bg-[rgba(125,211,255,0.14)] border border-[rgba(125,211,255,0.32)] rounded-br-[6px]' : 'bg-bg-secondary border border-border rounded-bl-[6px]'}`}>
                      {m.text}
                    </div>
                  </div>
                );
              }

              const isImage = getFileType(m.name) === 'image';
              const fileUrl = m.url || (m.file ? URL.createObjectURL(m.file) : null);

              if (isImage && fileUrl) {
                return (
                  <div key={m.id} className={`flex flex-col max-w-[78%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
                    <div
                      className={`relative overflow-hidden rounded-2xl border cursor-pointer transition-all duration-200 hover:opacity-95 shadow-md ${mine ? 'bg-[rgba(125,211,255,0.14)] border-[rgba(125,211,255,0.32)] rounded-br-[6px]' : 'bg-bg-secondary border-border rounded-bl-[6px]'}`}
                      onClick={() => handleOpenChatAttachment(m)}
                      title="Click to preview image"
                    >
                      <img
                        src={fileUrl}
                        alt={m.name}
                        className="max-h-[220px] w-full object-cover rounded-xl block min-w-[180px]"
                      />
                      {(m.status === 'sending' || m.status === 'receiving') && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-1 text-white text-[0.75rem] font-semibold">
                          <RefreshCw size={20} className="animate-spin text-accent-cyan" />
                          <span>{m.status === 'sending' ? `Sending ${Math.round((m.progress || 0) * 100)}%` : `Receiving ${Math.round((m.progress || 0) * 100)}%`}</span>
                        </div>
                      )}
                      <div className="p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between gap-2 text-white">
                        <span className="text-[0.75rem] font-semibold truncate flex-1">{m.name}</span>
                        <span className="text-[0.68rem] text-white/80 flex-shrink-0">{formatBytes(m.size)}</span>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id} className={`flex flex-col max-w-[78%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
                  <div
                    className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 min-w-[190px] cursor-pointer transition-all duration-150 hover:bg-white/10 ${mine ? 'bg-[rgba(125,211,255,0.14)] border border-[rgba(125,211,255,0.32)] rounded-br-[6px]' : 'bg-bg-secondary border border-border rounded-bl-[6px]'}`}
                    onClick={() => handleOpenChatAttachment(m)}
                    title="Click to open attachment"
                  >
                    <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${mine ? 'bg-[rgba(125,211,255,0.18)] text-accent-purple' : 'bg-white/[0.06] text-text-secondary'}`}>
                      {m.kind === 'app' ? <Smartphone size={17} /> : <FileIcon size={17} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.8rem] font-semibold text-text-primary truncate">{m.name}</div>
                      <div className="text-[0.7rem] text-text-muted">
                        {formatBytes(m.size)} · {m.status === 'sending' ? `sending ${Math.round((m.progress || 0) * 100)}%` : m.status === 'receiving' ? `receiving ${Math.round((m.progress || 0) * 100)}%` : mine ? 'delivered' : 'received'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="flex-shrink-0 text-[0.72rem] font-semibold text-accent-purple bg-[rgba(125,211,255,0.12)] border border-[rgba(125,211,255,0.3)] rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-[rgba(125,211,255,0.25)] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenChatAttachment(m);
                      }}
                    >
                      Open
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative flex items-center gap-2 px-3 py-2.5 border-t border-border flex-shrink-0 bg-bg-secondary">
            {showChatAttach && (
              <div className="absolute bottom-full left-2 mb-2 bg-bg-secondary border border-border rounded-2xl p-1.5 flex gap-1 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)]">
                {[
                  { label: 'File', icon: <UploadCloud size={18} />, tint: 'text-accent-purple bg-[rgba(125,211,255,0.14)]', onClick: openChatFilePicker },
                  { label: 'App', icon: <Smartphone size={18} />, tint: 'text-accent-green bg-[rgba(52,211,153,0.14)]', onClick: openChatAppPicker },
                  { label: 'Text', icon: <Type size={18} />, tint: 'text-accent-pink bg-[rgba(248,113,113,0.13)]', onClick: focusChatTextInput }
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className="w-[68px] flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl border-0 bg-transparent cursor-pointer hover:bg-white/5"
                    onClick={opt.onClick}
                  >
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${opt.tint}`}>{opt.icon}</span>
                    <span className="text-[0.66rem] font-semibold text-text-secondary">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`flex-shrink-0 w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer transition-transform duration-150 ${showChatAttach ? 'bg-accent-purple text-[#06222c] border-transparent rotate-45' : 'bg-white/[0.05] border-border text-text-secondary'}`}
              onClick={(e) => rippleTap(e, () => setShowChatAttach((v) => !v))}
              title="Attach"
            >
              <Paperclip size={16} />
            </button>
            <input
              id="chat-text-input"
              type="text"
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendChatText(); }}
              placeholder="Send a note…"
              className="flex-1 min-w-0 bg-[rgba(8,12,20,0.5)] border border-border rounded-full px-4 py-2 text-[0.85rem] text-text-primary outline-none focus:border-accent-purple"
            />
            <button
              type="button"
              className="flex-shrink-0 w-9 h-9 rounded-full bg-accent-purple text-[#06222c] flex items-center justify-center cursor-pointer border-0 disabled:opacity-40"
              disabled={!chatDraft.trim()}
              onClick={(e) => rippleTap(e, sendChatText)}
            >
              <Send size={15} />
            </button>
            <input
              type="file"
              className="hidden"
              ref={chatFileInputRef}
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                files.forEach((f) => sendChatAttachment(f, false));
                e.target.value = '';
              }}
            />
          </div>

          {showChatApps && (
            <div className="fixed inset-0 bg-[rgba(4,6,12,0.85)] backdrop-blur-sm flex items-center justify-center z-[2100] p-5" onClick={(e) => rippleTap(e, () => setShowChatApps(false))}>
              <div className="bg-bg-secondary border border-border rounded-[20px] p-4 w-full max-w-[360px] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.3),0_8px_10px_-6px_rgba(0,0,0,0.3)] has-[.apps-panel]:max-h-[80vh] has-[.apps-panel]:flex has-[.apps-panel]:flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3 font-heading font-semibold">
                  <span className="flex items-center gap-[0.4rem]">
                    <Smartphone size={16} /> Send an app
                  </span>
                  <button className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary" onClick={(e) => rippleTap(e, () => setShowChatApps(false))} title="Close">
                    <X size={18} />
                  </button>
                </div>
                <AppsPanel
                  formatBytes={formatBytes}
                  onSelectApps={(files) => {
                    files.forEach((f) => sendChatAttachment(f, true));
                    setShowChatApps(false);
                  }}
                />
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* CHAT ATTACHMENT LIGHTBOX PREVIEW MODAL */}
      {chatPreviewItem && createPortal(
        <div
          className="fixed inset-0 z-[3000] bg-black/92 backdrop-blur-xl flex flex-col justify-between p-4 max-[640px]:p-3 select-none animate-[fadeIn_0.2s_ease-out]"
          onClick={() => setChatPreviewItem(null)}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-3 text-white flex-shrink-0 py-2 px-1 z-10" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="bg-white/10 hover:bg-white/20 border-0 text-white rounded-full p-2.5 cursor-pointer flex items-center justify-center transition-colors"
              onClick={() => setChatPreviewItem(null)}
              title="Close preview"
            >
              <X size={20} />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <div className="font-semibold text-[0.95rem] truncate text-text-primary">{chatPreviewItem.name}</div>
              <div className="text-[0.72rem] text-text-muted">{formatBytes(chatPreviewItem.size)}</div>
            </div>

            <a
              href={chatPreviewItem.url}
              download={chatPreviewItem.name}
              target="_blank"
              rel="noreferrer"
              className="bg-accent-purple hover:bg-accent-purple/90 text-[#06222c] font-semibold text-[0.8rem] rounded-xl px-3.5 py-2 no-underline flex items-center gap-1.5 flex-shrink-0 transition-colors shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={16} /> Save / Open
            </a>
          </div>

          {/* Body Viewer */}
          <div className="flex-1 min-h-0 flex items-center justify-center p-2">
            {chatPreviewItem.type === 'image' ? (
              <img
                src={chatPreviewItem.url}
                alt={chatPreviewItem.name}
                className="max-h-[82vh] max-w-[95vw] object-contain rounded-2xl shadow-2xl border border-white/10"
                onClick={(e) => e.stopPropagation()}
              />
            ) : chatPreviewItem.type === 'video' ? (
              <video
                controls
                autoPlay
                src={chatPreviewItem.url}
                className="max-h-[82vh] max-w-[95vw] rounded-2xl shadow-2xl border border-white/10"
                onClick={(e) => e.stopPropagation()}
              />
            ) : chatPreviewItem.type === 'audio' ? (
              <div className="bg-bg-secondary border border-border rounded-2xl p-6 flex flex-col items-center gap-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="w-16 h-16 rounded-2xl bg-[rgba(125,211,255,0.15)] text-accent-cyan flex items-center justify-center">
                  <FileAudio size={32} />
                </div>
                <div className="text-center">
                  <div className="font-semibold text-text-primary text-[1rem] truncate max-w-[280px]">{chatPreviewItem.name}</div>
                  <div className="text-[0.78rem] text-text-muted mt-1">{formatBytes(chatPreviewItem.size)}</div>
                </div>
                <audio controls autoPlay src={chatPreviewItem.url} className="w-[280px]" />
              </div>
            ) : (
              <div className="bg-bg-secondary border border-border rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl text-center max-w-[340px]" onClick={(e) => e.stopPropagation()}>
                <div className="w-20 h-20 rounded-2xl bg-[rgba(125,211,255,0.15)] text-accent-purple flex items-center justify-center">
                  {chatPreviewItem.kind === 'app' ? <Smartphone size={40} /> : <FileIcon size={40} />}
                </div>
                <div className="font-semibold text-text-primary text-[1.1rem] break-words">{chatPreviewItem.name}</div>
                <div className="text-[0.8rem] text-text-muted">{formatBytes(chatPreviewItem.size)}</div>
                <a
                  href={chatPreviewItem.url}
                  download={chatPreviewItem.name}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full mt-2 bg-accent-purple text-[#06222c] font-semibold py-2.5 px-4 rounded-xl no-underline flex items-center justify-center gap-2 shadow-lg"
                >
                  <Download size={18} /> Download / Open
                </a>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
