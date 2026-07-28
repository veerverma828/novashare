import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import confetti from 'canvas-confetti';
import {
  Share2,
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
  File,
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
  Search,
  Check,
  Users
} from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const NotifyDownload = registerPlugin('NotifyDownload');
import {
  triggerHaptic,
  listInstalledApps,
  getAppIcon,
  getAppApkFile,
  clearApkCache,
  getPendingSharedFiles,
  onSharedFilesReceived,
  sharedEntryToFile,
  pushTransferNotification,
  stopTransferNotification
} from './native';
import './App.css';

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for P2P WebRTC
const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Spawns a ripple span inside whatever element was tapped, and gives it a
// light haptic tick on-device. Purely a feedback layer; never blocks the
// actual click handler.
function rippleTap(e, handler) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.6;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = `${size}px`;
  const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  el.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
  triggerHaptic();
  if (handler) handler(e);
}

// Split-flap style reveal for the freshly generated room code: each
// character scrambles briefly before settling, staggered left to right.
function RoomCodeFlap({ code }) {
  const [display, setDisplay] = useState(code.split(''));

  useEffect(() => {
    const target = code.split('');
    const timers = [];
    target.forEach((ch, i) => {
      let ticks = 0;
      const maxTicks = 5 + i * 2;
      const iv = setInterval(() => {
        ticks += 1;
        setDisplay((prev) => {
          const next = [...prev];
          next[i] = ticks >= maxTicks ? ch : FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
          return next;
        });
        if (ticks >= maxTicks) clearInterval(iv);
      }, 45);
      timers.push(iv);
    });
    return () => timers.forEach(clearInterval);
  }, [code]);

  return (
    <div className="signal-code-digits">
      {display.map((ch, i) => (
        <span key={i} className="flap-digit">{ch}</span>
      ))}
    </div>
  );
}

// One row in the multi-file send queue: drag/swipe left (or tap the X) to
// drop a file before the transfer starts. Pointer Events cover mouse,
// touch, and pen with one handler set.
function SwipeableFileRow({ file, sizeLabel, onRemove }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const removedRef = useRef(false);

  const REMOVE_THRESHOLD = -72;

  const onPointerDown = (e) => {
    startXRef.current = e.clientX;
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const delta = Math.min(0, e.clientX - startXRef.current);
    setDragX(delta);
  };

  const finishDrag = () => {
    setDragging(false);
    if (dragX < REMOVE_THRESHOLD && !removedRef.current) {
      removedRef.current = true;
      onRemove();
    } else {
      setDragX(0);
    }
  };

  const dragProgress = dragX < 0 ? Math.min(1, dragX / REMOVE_THRESHOLD) : 0;

  return (
    <div
      className="qitem"
      style={{
        transform: `translateX(${dragX}px)`,
        opacity: 1 - dragProgress * 0.5,
        borderColor: dragProgress > 0
          ? `rgba(236, 72, 153, ${0.25 + dragProgress * 0.75})`
          : undefined,
        background: dragProgress > 0
          ? `rgba(236, 72, 153, ${dragProgress * 0.22})`
          : undefined,
        transition: dragging ? 'none' : 'transform 0.25s ease'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerLeave={() => dragging && finishDrag()}
    >
      <span className="dot" />
      <span className="qname" style={{ color: dragProgress > 0 ? 'var(--accent-pink)' : undefined }}>{file.name}</span>
      <span className="qsize">{sizeLabel}</span>
      <button
        type="button"
        className="qx"
        onClick={(e) => { e.stopPropagation(); rippleTap(e, onRemove); }}
        aria-label={`Remove ${file.name}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// Module-scope cache so re-mounting the Apps tab doesn't refetch icons
// already fetched over the native bridge this session.
const appIconCache = new Map();

function AppIcon({ packageName }) {
  const [icon, setIcon] = useState(appIconCache.get(packageName) || null);

  useEffect(() => {
    if (icon) return;
    let cancelled = false;
    getAppIcon(packageName)
      .then((src) => {
        if (cancelled || !src) return;
        appIconCache.set(packageName, src);
        setIcon(src);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [packageName]);

  return icon
    ? <img src={icon} alt="" className="app-icon-img" />
    : <div className="app-icon-fallback"><Smartphone size={18} /></div>;
}

// Runs `worker` over `items` with at most `limit` in flight at once, resolving
// to results in original item order regardless of completion order.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const lane = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// Installed-apps browser for the "Apps" home tab: lists user-installed
// packages (native bridge only), lets the user search and multi-select, and
// hands back ready-to-send Files built from each APK's bytes so they drop
// straight into the same selectedFiles queue the file dropzone uses.
function AppsPanel({ onSelectApps, formatBytes }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [preparing, setPreparing] = useState(null); // { index, total }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listInstalledApps()
      .then((list) => {
        if (cancelled) return;
        setApps([...list].sort((a, b) => a.appName.localeCompare(b.appName)));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load installed apps.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = query.trim()
    ? apps.filter((a) =>
        a.appName.toLowerCase().includes(query.toLowerCase()) ||
        a.packageName.toLowerCase().includes(query.toLowerCase())
      )
    : apps;

  const toggleSelected = (packageName) => {
    if (preparing) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(packageName)) next.delete(packageName);
      else next.add(packageName);
      return next;
    });
  };

  const handleShareSelected = async () => {
    if (preparing || selected.size === 0) return;
    const picked = apps.filter((a) => selected.has(a.packageName));
    setError('');
    let completed = 0;
    setPreparing({ index: 0, total: picked.length });
    try {
      // A few APK cache-copy+fetch calls run concurrently — each is now a
      // plain native file copy rather than a heavy base64 bridge payload, so
      // parallelizing a handful at a time is safe and meaningfully faster
      // than preparing them one at a time.
      const files = await mapWithConcurrency(picked, 3, async (app) => {
        const file = await getAppApkFile(app.packageName, app.appName, app.versionName);
        completed += 1;
        setPreparing({ index: completed, total: picked.length });
        return file;
      });
      onSelectApps(files);
    } catch (err) {
      setError(err.message || 'Could not prepare the selected apps.');
    } finally {
      setPreparing(null);
      clearApkCache();
    }
  };

  if (!Capacitor.isNativePlatform()) {
    return (
      <div className="apps-empty-state">
        <Smartphone size={28} />
        <p>App sharing is only available in the installed NovaShare app.</p>
      </div>
    );
  }

  return (
    <div className="apps-panel">
      <div className="input-group">
        <div className="input-icon-wrapper"><Search size={16} /></div>
        <input
          type="text"
          className="code-input"
          placeholder="Search installed apps..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && (
        <div className="apps-loading">
          <RefreshCw size={22} className="connecting-spinner" />
          <span>Loading installed apps&hellip;</span>
        </div>
      )}

      {!loading && error && (
        <div className="qr-scanner-error"><AlertCircle size={16} /> {error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="dropzone-subtitle" style={{ textAlign: 'center' }}>
          {apps.length === 0 ? 'No user-installed apps found.' : `No apps match "${query}".`}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="apps-list">
          {filtered.map((app) => {
            const isChecked = selected.has(app.packageName);
            return (
              <div
                key={app.packageName}
                className={`app-row ${isChecked ? 'checked' : ''}`}
                onClick={() => toggleSelected(app.packageName)}
              >
                <span className={`app-checkbox ${isChecked ? 'checked' : ''}`}>
                  {isChecked && <Check size={13} strokeWidth={3} />}
                </span>
                <AppIcon packageName={app.packageName} />
                <div className="app-row-details">
                  <span className="app-row-name">{app.appName}</span>
                  <span className="app-row-pkg">
                    {app.packageName}
                    {app.versionName ? ` · v${app.versionName}` : ''} · {formatBytes(app.apkSize)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected.size > 0 && (
        <button
          type="button"
          className="btn-primary"
          disabled={!!preparing}
          onClick={(e) => rippleTap(e, handleShareSelected)}
        >
          {preparing
            ? <><RefreshCw size={16} className="connecting-spinner" /> Preparing {preparing.index}/{preparing.total}&hellip;</>
            : <><Share2 size={16} /> Share {selected.size} {selected.size === 1 ? 'App' : 'Apps'}</>}
        </button>
      )}
    </div>
  );
}

// Circular transfer progress — reads the same speed/ETA lines the linear
// bar used to, just given a shape that matches the round dropzone/radar
// motifs already in the app.
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function TransferRing({ progress, gradientId = 'ringGrad' }) {
  const offset = RING_CIRCUMFERENCE - (Math.min(100, Math.max(0, progress)) / 100) * RING_CIRCUMFERENCE;
  return (
    <svg className="ring" viewBox="0 0 120 120" role="img" aria-label={`Transfer ${Math.round(progress)}% complete`}>
      <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
      <circle
        cx="60"
        cy="60"
        r={RING_RADIUS}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 60 60)"
        className="ring-fill"
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-purple)" />
          <stop offset="100%" stopColor="var(--accent-cyan)" />
        </linearGradient>
      </defs>
      <text x="60" y="66" textAnchor="middle" className="ring-pct">{Math.round(progress)}%</text>
    </svg>
  );
}

function App() {
  // Navigation & Mode States
  const [mode, setMode] = useState('home'); // 'home' | 'p2p-send' | 'p2p-receive'
  const [homeTab, setHomeTab] = useState('home'); // 'home' | 'apps'

  // File States
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [incomingFile, setIncomingFile] = useState(null); // { name, size, type }

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

  // Refs for background processes
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const transferStartTime = useRef(null);
  const receivedChunks = useRef([]);
  const receivedBytes = useRef(0);
  const incomingFileRef = useRef(null);
  const fileInputRef = useRef(null);
  const scanVideoRef = useRef(null);
  const scanCanvasRef = useRef(null);
  const scanStreamRef = useRef(null);
  const scanRafRef = useRef(null);

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
  // Throttles the background transfer notification to a few updates/sec
  // instead of firing on every 64KB chunk
  const notifyThrottleRef = useRef(0);
  // Pause/resume refs (avoid stale closures inside the send loop)
  const isPausedRef = useRef(false);

  // Format Helper: Bytes -> Human Readable
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format Helper: Speed
  const formatSpeed = (bytesPerSecond) => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format Helper: Time (ETA)
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity) return '--';
    if (seconds < 60) return Math.round(seconds) + 's';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins + 'm ' + secs + 's';
  };

  // Dynamic File Icon Selector
  const getFileType = (fileName) => {
    if (!fileName) return 'file';
    const ext = fileName.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return 'audio';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['txt', 'md', 'html', 'css', 'js', 'json', 'py', 'java', 'cpp'].includes(ext)) return 'code';
    return 'file';
  };

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
      } catch (err) {
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

  // Cleanup active peer/connections
  const cleanup = () => {
    if (connRef.current) {
      try { connRef.current.close(); } catch(e){}
      connRef.current = null;
    }
    connsRef.current.forEach((p) => { try { p.conn.close(); } catch (e) {} });
    connsRef.current = [];
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch(e){}
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
  };

  // Reset UI back to Home State
  const resetToHome = () => {
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

    // Clear URL search params without page reload
    window.history.pushState({}, document.title, window.location.pathname);
  };

  // Toggle pause/resume of an in-progress send (sender-side control) —
  // broadcasts to every connected receiver, not just one.
  const togglePauseTransfer = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    connsRef.current.forEach((p) => {
      try { p.conn.send({ type: 'control', action: next ? 'pause' : 'resume' }); } catch (e) {}
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
  const generateRoomCode = () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

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

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // ----------------------------------------------------
  // SENDER P2P WORKFLOW (broadcast: one room, several receivers)
  // ----------------------------------------------------
  const MAX_RECEIVERS = 8;

  const startP2PSend = () => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    cleanup();
    setTransferState('preparing');
    setMode('p2p-send');
    setIsPaused(false);
    isPausedRef.current = false;
    sendQueueRef.current = selectedFiles;
    sendQueueIndexRef.current = 0;
    totalQueueBytesRef.current = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    setSendFileCount(selectedFiles.length);
    setSendFileIndex(0);
    setConnectedCount(0);
    transferStartTime.current = Date.now();

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
        debug: 1
      });

      peerRef.current = peer;

      peer.on('open', () => {
        setTransferState('waiting');
        showToast('Direct P2P Room Ready!', 'success');
      });

      peer.on('connection', (conn) => {
        // Broadcast mode: the room stays open to more receivers up to a cap,
        // rather than rejecting everyone after the first connects.
        if (connsRef.current.length >= MAX_RECEIVERS) {
          try { conn.send({ type: 'room-full' }); } catch (e) {}
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
          openTimer: null
        };
        connsRef.current = [...connsRef.current, peerState];
        setConnectedCount(connsRef.current.length);
        setTransferState('transferring');
        showToast(
          connsRef.current.length > 1
            ? `Receiver connected! (${connsRef.current.length} total)`
            : 'Receiver connected! Starting stream...',
          'info'
        );

        conn.on('open', () => {
          // Give a reconnecting receiver a brief window to send a 'resume'
          // message before defaulting to a fresh batch-start — a plain new
          // connection just falls through once the timer fires.
          peerState.openTimer = setTimeout(() => {
            if (peerState.resumed) return;
            conn.send({ type: 'batch-start', totalFiles: sendQueueRef.current.length });
            sendNextQueuedFileForPeer(peerState);
          }, 150);
        });

        conn.on('data', (data) => {
          if (data.type !== 'resume') return;
          if (peerState.openTimer) {
            clearTimeout(peerState.openTimer);
            peerState.openTimer = null;
          }
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
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          peer.destroy();
          attemptConnection(retryCount + 1);
        } else {
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

    const remaining = totalQueueBytesRef.current - slowest.totalBytesSent;
    setTimeRemaining(formatTime(speed > 0 ? remaining / speed : 0));

    const files = sendQueueRef.current;
    const fileLabel = files.length > 1 ? `${files.length} files` : (files[0]?.name || 'file');
    notifyTransfer(
      `Sending ${fileLabel} to ${peers.length} receiver${peers.length === 1 ? '' : 's'}`,
      `${formatSpeed(speed)} · ${formatTime(speed > 0 ? remaining / speed : 0)} left`,
      Math.min(100, minFraction * 100)
    );
  };

  const sendNextQueuedFileForPeer = (peerState) => {
    const idx = peerState.queueIndex;
    const files = sendQueueRef.current;

    if (idx >= files.length) {
      try { peerState.conn.send({ type: 'batch-complete' }); } catch (e) {}
      updateAggregateStats();
      if (connsRef.current.length > 0 && connsRef.current.every((p) => p.queueIndex >= files.length)) {
        setTransferState('complete');
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        showToast('Transfer completed!', 'success');
      }
      return;
    }

    const file = files[idx];
    try {
      peerState.conn.send({
        type: 'metadata',
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        fileIndex: idx,
        totalFiles: files.length
      });
    } catch (e) {
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

          sendNext();
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

  const startP2PReceive = (roomCodeInput) => {
    const code = roomCodeInput || targetPeerId;
    if (!code) {
      showToast('Please enter a valid room code.', 'error');
      return;
    }

    cleanup();
    setTransferState('preparing');
    setMode('p2p-receive');
    setTargetPeerId(code);
    reconnectAttemptRef.current = 0;
    currentFileIndexRef.current = 0;

    connectToSender(code, false);
  };

  // Handles every 'data' message from the sender — shared by the initial
  // connection and any resumed reconnection, since a resume just continues
  // feeding this same handler mid-batch instead of starting over.
  const handleReceiverData = (data) => {
    if (data.type === 'batch-start') {
      receivedFilesRef.current = [];
      setCompletedFiles([]);
    } else if (data.type === 'metadata') {
      currentFileIndexRef.current = data.fileIndex || 0;
      incomingFileRef.current = {
        name: data.name,
        size: data.size,
        type: data.mime
      };
      setIncomingFile(incomingFileRef.current);
      setReceiveFileIndex(data.fileIndex || 0);
      setReceiveFileCount(data.totalFiles || 1);
      setTransferProgress(0);
      setTransferSpeed('0 B/s');
      setTimeRemaining('--');
      receivedChunks.current = [];
      receivedBytes.current = 0;
      transferStartTime.current = Date.now();
    } else if (data.type === 'control') {
      setIsPeerPaused(data.action === 'pause');
    } else if (data.type === 'room-full') {
      setTransferState('error');
      setErrorMsg('This room already has the maximum number of receivers.');
    } else if (data.type === 'chunk') {
      receivedChunks.current.push(data.chunk);
      receivedBytes.current += data.chunk.byteLength;

      const totalSize = incomingFileRef.current ? incomingFileRef.current.size : 0;

      if (totalSize > 0) {
        const pct = Math.min((receivedBytes.current / totalSize) * 100, 100);
        setTransferProgress(pct);

        const elapsed = (Date.now() - transferStartTime.current) / 1000;
        const speed = elapsed > 0 ? (receivedBytes.current / elapsed) : 0;
        setTransferSpeed(formatSpeed(speed));

        const remaining = totalSize - receivedBytes.current;
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
        const blob = new Blob(receivedChunks.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const fileName = incomingFileRef.current ? incomingFileRef.current.name : 'downloaded-file';
        const fileSize = incomingFileRef.current ? incomingFileRef.current.size : receivedBytes.current;

        receivedFilesRef.current = [...receivedFilesRef.current, { name: fileName, url, size: fileSize }];
        setCompletedFiles(receivedFilesRef.current);

        saveReceivedFile(blob, fileName, url);
      }
    } else if (data.type === 'batch-complete') {
      setTransferState('complete');
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
      showToast('Transfer completed!', 'success');
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
    setTimeout(() => connectToSender(code, true), reconnectAttemptRef.current * 1000);
  };

  // isResume: re-establishing after a mid-transfer drop — skips wiping
  // already-received bytes and tells the sender exactly where to continue
  // from, instead of restarting the whole batch.
  const connectToSender = (code, isResume) => {
    const peer = new Peer({
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      debug: 1
    });

    peerRef.current = peer;

    peer.on('open', () => {
      if (!isResume) showToast('Connecting to room ' + code + '...', 'info');

      const conn = peer.connect(code, { reliable: true });
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
    });

    peer.on('error', () => {
      if (isResume) {
        scheduleReconnectRetry(code);
        return;
      }
      setTransferState((prev) => {
        if (prev === 'complete') return 'complete';
        showToast('Could not reach signaling server.', 'error');
        setErrorMsg('Signaling server connection failed. Check the code or try again.');
        return 'error';
      });
    });
  };

  // Save a received file to actual device storage.
  // In a real browser, <a download> already writes to the Downloads folder.
  // Inside the Capacitor WebView that click is a no-op, so write bytes via Filesystem instead.
  const saveReceivedFile = async (blob, fileName, blobUrl) => {
    if (!Capacitor.isNativePlatform()) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Writes into the real system Downloads folder via MediaStore and
      // registers the file with DownloadManager, so it shows the standard
      // "Download complete" notification and appears in the system Downloads app.
      await NotifyDownload.saveToDownloads({
        fileName,
        data: base64Data,
        mimeType: blob.type || 'application/octet-stream'
      });

      showToast(`${fileName} saved to Downloads`, 'success');
    } catch (err) {
      showToast(`Could not save ${fileName}: ${err.message}`, 'error');
    }
  };

  const copyToClipboard = (text, message = 'Copied to clipboard!') => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message, 'success');
    }).catch(() => {
      showToast('Failed to copy.', 'error');
    });
  };

  const getSharingUrl = () => {
    let origin = window.location.origin;
    const localIp = import.meta.env.VITE_LOCAL_IP;
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && localIp && localIp !== 'localhost') {
      origin = `${window.location.protocol}//${localIp}:${window.location.port}`;
    }
    return `${origin}${window.location.pathname}?room=${roomCode}`;
  };

  // Extract a room code from raw scanned QR text (full share URL or bare code)
  const extractRoomCode = (text) => {
    try {
      const url = new URL(text);
      const room = url.searchParams.get('room');
      if (room) return room.toUpperCase();
    } catch {
      // Not a URL, fall through to treat as a bare code
    }
    return text.trim().toUpperCase();
  };

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
  };

  // Open camera and start scanning frames for a QR code
  const openScanner = async () => {
    setScannerError('');
    setCameraReady(false);
    setShowScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      scanStreamRef.current = stream;
      if (scanVideoRef.current) {
        scanVideoRef.current.srcObject = stream;
        await scanVideoRef.current.play();
        setCameraReady(true);
      }

      const canvas = scanCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = () => {
        const video = scanVideoRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            const roomFromScan = extractRoomCode(code.data);
            stopScanner();
            setTargetPeerId(roomFromScan);
            startP2PReceive(roomFromScan);
            return;
          }
        }
        scanRafRef.current = requestAnimationFrame(tick);
      };
      scanRafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setScannerError('Camera access denied or unavailable.');
    }
  };

  // Clean up camera on unmount
  useEffect(() => {
    return () => stopScanner();
  }, []);

  // Helper file icon component inside local scope
  const renderFileIconComponent = (fileName) => {
    const type = getFileType(fileName);
    const wrapperClass = "file-icon-wrapper";
    switch (type) {
      case 'image': return <div className={wrapperClass}><FileImage size={24} /></div>;
      case 'video': return <div className={wrapperClass}><FileVideo size={24} /></div>;
      case 'audio': return <div className={wrapperClass}><FileAudio size={24} /></div>;
      case 'pdf': return <div className={wrapperClass} style={{color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.15)'}}><FileText size={24} /></div>;
      case 'archive': return <div className={wrapperClass} style={{color: '#eab308', backgroundColor: 'rgba(234, 179, 8, 0.15)'}}><FileArchive size={24} /></div>;
      case 'code': return <div className={wrapperClass} style={{color: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.15)'}}><FileCode size={24} /></div>;
      default: return <div className={wrapperClass}><File size={24} /></div>;
    }
  };

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="logo-container" onClick={resetToHome} style={{cursor: 'pointer'}}>
          <Zap size={32} className="logo-icon" fill="currentColor" />
          <h1 className="logo-text">NovaShare</h1>
          <span className="badge" style={{color: 'var(--accent-purple)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
            Direct P2P
          </span>
        </div>
        <div>
          <button className="btn-secondary" onClick={(e) => rippleTap(e, resetToHome)} style={{padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.85rem'}}>
            Reset
          </button>
        </div>
      </header>

      {/* TOAST POPUP */}
      {toast && (
        <div className="toast">
          {toast.type === 'success' && <ShieldCheck size={20} style={{color: 'var(--accent-green)'}} />}
          {toast.type === 'error' && <AlertCircle size={20} style={{color: 'var(--accent-pink)'}} />}
          {toast.type === 'info' && <Info size={20} style={{color: 'var(--accent-cyan)'}} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MAIN LAYOUT CONTAINER */}
      <main className="app-main">
        <div className="glass-panel share-card">

          {/* ==================================================== */}
          {/* VIEW: HOME VIEW                                      */}
          {/* ==================================================== */}
          {mode === 'home' && (
            <div className={selectedFiles.length === 0 && homeTab === 'apps' ? 'home-view home-view-fill' : 'home-view'}>
              <div className="hero-text-center">
                <h2 className="hero-title glow-text">Secure P2P File Sharing</h2>
                <p className="hero-subtitle">Transfer files directly browser-to-browser. Encrypted, private, with zero size limits.</p>
              </div>

              {/* TOP TAB SWITCHER: Home / Apps (hidden once a file is queued) */}
              {selectedFiles.length === 0 && (
                <div className="home-tab-switcher">
                  <button
                    type="button"
                    className={`home-tab-btn ${homeTab === 'home' ? 'active' : ''}`}
                    onClick={() => setHomeTab('home')}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={`home-tab-btn ${homeTab === 'apps' ? 'active' : ''}`}
                    onClick={() => setHomeTab('apps')}
                  >
                    Apps
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
              ) : (
              <>

              {/* FILE DROP ZONE (IF NO FILES SELECTED) */}
              {selectedFiles.length === 0 ? (
                <div
                  className={`dropzone ${dragActive ? 'drag-active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={triggerFileInput}
                >
                  <input
                    type="file"
                    className="file-input"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                  />
                  <div className="dropzone-content">
                    <div className="upload-icon-wrapper">
                      <UploadCloud size={32} />
                    </div>
                    <div>
                      <h3 className="dropzone-title">Drag & drop your files here</h3>
                      <p className="dropzone-subtitle">or click to browse files from your device</p>
                    </div>
                    <span className="badge" style={{color: 'var(--accent-purple)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
                      No File Size Limits
                    </span>
                  </div>
                </div>
              ) : (
                /* FILES SELECTED STATE CARD */
                <div>
                  {selectedFiles.length === 1 ? (
                    <div className="file-card">
                      {renderFileIconComponent(selectedFiles[0].name)}
                      <div className="file-details">
                        <h4 className="file-name">{selectedFiles[0].name}</h4>
                        <p className="file-size">{formatBytes(selectedFiles[0].size)}</p>
                      </div>
                      <button className="remove-file-btn" onClick={() => setSelectedFiles([])}>
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="queue-header">
                        <span>{selectedFiles.length} files selected &middot; {formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))} total</span>
                        <span className="queue-hint">swipe or tap &times; to drop a file</span>
                      </div>
                      <div className="queue">
                        {selectedFiles.map((f, i) => (
                          <SwipeableFileRow
                            key={`${f.name}-${f.size}-${i}`}
                            file={f}
                            sizeLabel={formatBytes(f.size)}
                            onRemove={() => setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="action-buttons">
                    <button className="btn-primary" onClick={(e) => rippleTap(e, startP2PSend)}>
                      <Zap size={18} /> Start P2P Sharing Room
                    </button>
                    <button className="btn-secondary" onClick={(e) => rippleTap(e, () => setSelectedFiles([]))}>
                      Cancel Selection
                    </button>
                  </div>
                </div>
              )}

              {/* RECEIVE AREA (ONLY SHOW IF NO FILE CURRENTLY BEING SENT) */}
              {selectedFiles.length === 0 && (
                <div>
                  <div className="or-divider">or receive a file</div>
                  <div className="receive-block">
                    <div className="input-group">
                      <div className="input-icon-wrapper">
                        <Download size={20} />
                      </div>
                      <input
                        type="text"
                        placeholder="Enter Room Code (e.g. 4D8G2X)"
                        className="code-input"
                        value={targetPeerId}
                        onChange={(e) => setTargetPeerId(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && startP2PReceive()}
                      />
                      <button className="btn-icon-copy" onClick={(e) => rippleTap(e, openScanner)} title="Scan QR Code">
                        <QrCode size={20} />
                      </button>
                    </div>
                    <button className="btn-secondary" onClick={(e) => rippleTap(e, () => startP2PReceive())} style={{justifyContent: 'center'}}>
                      Connect & Download
                    </button>
                  </div>
                </div>
              )}

              {/* QR SCANNER MODAL */}
              {showScanner && (
                <div className="qr-scanner-overlay" onClick={(e) => rippleTap(e, stopScanner)}>
                  <div className="qr-scanner-panel" onClick={(e) => e.stopPropagation()}>
                    <div className="qr-scanner-header">
                      <span style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                        <Camera size={16} /> Scan Room QR Code
                      </span>
                      <button className="btn-icon-copy" onClick={(e) => rippleTap(e, stopScanner)} title="Close">
                        <X size={18} />
                      </button>
                    </div>
                    {scannerError ? (
                      <div className="qr-scanner-error">
                        <AlertCircle size={18} /> {scannerError}
                      </div>
                    ) : (
                      <div className="qr-scanner-video-wrapper">
                        {!cameraReady && (
                          <div className="qr-scanner-loading">
                            <RefreshCw size={32} className="connecting-spinner" />
                          </div>
                        )}
                        <video
                          ref={scanVideoRef}
                          className="qr-scanner-video"
                          style={{ visibility: cameraReady ? 'visible' : 'hidden' }}
                          playsInline
                          muted
                        />
                        {cameraReady && <div className="qr-scanner-frame" />}
                      </div>
                    )}
                    <canvas ref={scanCanvasRef} style={{ display: 'none' }} />
                  </div>
                </div>
              )}

              </>
              )}

            </div>
          )}

          {/* ==================================================== */}
          {/* VIEW: SENDER P2P STATE                              */}
          {/* ==================================================== */}
          {mode === 'p2p-send' && (
            <div className="p2p-setup-container">
              <div className="view-header-row">
                <button className="btn-secondary" onClick={(e) => rippleTap(e, resetToHome)} style={{padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', gap: '0.25rem'}}>
                  <ArrowLeft size={14} /> Back
                </button>
                <h3 className="signal-title">
                  Direct P2P Sharing
                </h3>
              </div>

              {/* File Info Inline Pill */}
              <div className="share-info-pill">
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)', flexShrink: 0 }}>Sharing:</span>
                <span className="share-info-pill-name">
                  {selectedFiles.length > 1 ? `${selectedFiles.length} files` : selectedFiles[0]?.name}
                </span>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>({formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))})</span>
              </div>

              {/* Preparing: negotiating a room code with the signaling server */}
              {transferState === 'preparing' && (
                <>
                  <p className="hero-subtitle" style={{ margin: '0 0 1rem', fontWeight: 500, textAlign: 'center' }}>
                    Setting up your P2P sharing room&hellip;
                  </p>
                  <div className="connecting-spinner-wrap">
                    <RefreshCw size={40} className="connecting-spinner" />
                  </div>
                  <p className="dropzone-subtitle" style={{ maxWidth: '280px', textAlign: 'center', margin: '0.75rem auto 0' }}>
                    Reaching the signaling server to allocate your room code. This can take a moment on a slow connection.
                  </p>
                </>
              )}

              {/* Waiting for connection */}
              {transferState === 'waiting' && (
                <>
                  <div className="hs-visual" role="img" aria-label="Waiting for a peer to connect">
                    <div className="hs-node hs-node-you"><Zap size={18} /></div>
                    <div className="hs-track" />
                    <div className="hs-node hs-node-peer"><Laptop size={18} /></div>
                  </div>
                  <p className="hs-caption">Waiting for peers to scan or enter your code&hellip; anyone with it can join.</p>

                  <div className="signal-fields">
                    <div className="signal-code-row">
                      <RoomCodeFlap code={roomCode} />
                      <button className="btn-icon-copy" onClick={(e) => rippleTap(e, () => copyToClipboard(roomCode, 'Room code copied!'))} title="Copy Code">
                        <Copy size={16} />
                      </button>
                    </div>

                    <div className="signal-link-row">
                      <span>{getSharingUrl()}</span>
                      <button className="btn-icon-copy" onClick={(e) => rippleTap(e, () => copyToClipboard(getSharingUrl(), 'Share link copied!'))} title="Copy Link">
                        <Copy size={14} />
                      </button>
                    </div>

                    <div className="signal-qr-row">
                      <div className="signal-qr" onClick={() => setShowQrZoom(true)} role="button" tabIndex={0} title="Tap to enlarge">
                        <QRCodeSVG
                          value={getSharingUrl()}
                          size={72}
                          bgColor={"#ffffff"}
                          fgColor={"#0b0e1c"}
                          level={"H"}
                          includeMargin={false}
                        />
                      </div>
                      <div className="signal-qr-note">
                        <b>Scan to connect</b>
                        Keep this tab open &mdash; the file streams directly, peer to peer. Tap the QR code to enlarge.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="transfer-status-container" style={{width: '100%'}}>
                  <div className="status-badge" style={{background: 'rgba(6, 182, 212, 0.08)', color: 'var(--accent-cyan)'}}>
                    <Users size={14} /> {connectedCount} {connectedCount === 1 ? 'receiver' : 'receivers'} connected
                  </div>

                  {sendFileCount > 1 && (
                    <div className="status-badge" style={{background: 'rgba(139, 92, 246, 0.08)'}}>
                      File {sendFileIndex + 1} of {sendFileCount}: {selectedFiles[sendFileIndex]?.name}
                    </div>
                  )}

                  <div className="status-badge uploading">
                    <RefreshCw size={14} className="radar-center-icon" style={{animation: isPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPaused ? 'Paused' : 'Streaming File...'}
                  </div>

                  <div className="ring-wrap">
                    <TransferRing progress={transferProgress} gradientId="ringGradSend" />
                  </div>

                  <div className="stats-grid">
                    <div className="stat-box">
                      <div className="stat-label">Speed</div>
                      <div className="stat-value">{isPaused ? 'Paused' : (transferSpeed || 'Connecting...')}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Estimated Time</div>
                      <div className="stat-value">{isPaused ? '--' : (timeRemaining || '--')}</div>
                    </div>
                  </div>

                  <button className="btn-secondary" onClick={(e) => rippleTap(e, togglePauseTransfer)} style={{width: '100%', justifyContent: 'center'}}>
                    {isPaused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
                  </button>
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>Transfer Complete!</h3>
                    <p className="hero-subtitle">
                      {sendFileCount > 1 ? `Your ${sendFileCount} files were shared directly and securely.` : 'Your file was shared directly and securely.'}
                    </p>
                  </div>
                  <button className="btn-primary" onClick={(e) => rippleTap(e, resetToHome)} style={{width: '100%'}}>
                    Share Another File
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper" style={{color: 'var(--accent-pink)', backgroundColor: 'rgba(236, 72, 153, 0.15)', filter: 'none'}}>
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>Connection Interrupted</h3>
                    <p className="hero-subtitle" style={{color: 'var(--accent-pink)', fontSize: '0.9rem'}}>{errorMsg}</p>
                  </div>
                  <div className="action-buttons" style={{width: '100%'}}>
                    <button className="btn-primary" onClick={(e) => rippleTap(e, startP2PSend)}>
                      Retry Transfer
                    </button>
                    <button className="btn-secondary" onClick={(e) => rippleTap(e, resetToHome)}>
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
            <div className="p2p-setup-container">
              <div className="view-header-row">
                <button className="btn-secondary" onClick={(e) => rippleTap(e, resetToHome)} style={{padding: '0.4rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', gap: '0.25rem'}}>
                  <ArrowLeft size={14} /> Leave
                </button>
                <h3 className="gradient-text" style={{fontSize: '1.25rem', fontFamily: 'var(--font-heading)', margin: 0}}>
                  Direct P2P Receiver
                </h3>
              </div>

              {/* Connecting/Resolving */}
              {transferState === 'preparing' && (
                <>
                  <p className="hero-subtitle" style={{ margin: '0 0 1rem', fontWeight: 500, textAlign: 'center' }}>
                    Connecting to sender room <strong style={{ color: 'var(--accent-cyan)' }}>{targetPeerId}</strong>&hellip;
                  </p>
                  <div className="connecting-spinner-wrap">
                    <RefreshCw size={40} className="connecting-spinner" />
                  </div>
                  <p className="dropzone-subtitle" style={{ maxWidth: '280px', textAlign: 'center', margin: '0.75rem auto 0' }}>
                    Establishing WebRTC data tunnel. Ensure the sender has the page active.
                  </p>
                </>
              )}

              {/* Reconnecting: connection dropped mid-transfer, auto-retrying with what we've already received kept intact */}
              {transferState === 'reconnecting' && (
                <>
                  <p className="hero-subtitle" style={{ margin: '0 0 1rem', fontWeight: 500, textAlign: 'center' }}>
                    Connection lost &mdash; reconnecting&hellip;
                  </p>
                  <div className="connecting-spinner-wrap">
                    <RefreshCw size={40} className="connecting-spinner" />
                  </div>
                  <p className="dropzone-subtitle" style={{ maxWidth: '280px', textAlign: 'center', margin: '0.75rem auto 0' }}>
                    Your progress is saved &mdash; the transfer will resume from where it left off.
                  </p>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="transfer-status-container" style={{width: '100%'}}>
                  {receiveFileCount > 1 && (
                    <div className="status-badge" style={{background: 'rgba(139, 92, 246, 0.08)'}}>
                      File {receiveFileIndex + 1} of {receiveFileCount}
                    </div>
                  )}

                  {incomingFile && (
                    <div className="file-card" style={{textAlign: 'left', width: '100%'}}>
                      {renderFileIconComponent(incomingFile.name)}
                      <div className="file-details">
                        <h4 className="file-name">{incomingFile.name}</h4>
                        <p className="file-size">{formatBytes(incomingFile.size)}</p>
                      </div>
                    </div>
                  )}

                  <div className="status-badge">
                    <RefreshCw size={14} className="radar-center-icon" style={{animation: isPeerPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPeerPaused ? 'Paused by sender' : 'Receiving File...'}
                  </div>

                  <div className="ring-wrap">
                    <TransferRing progress={transferProgress} gradientId="ringGradRecv" />
                  </div>

                  <div className="stats-grid">
                    <div className="stat-box">
                      <div className="stat-label">Download Speed</div>
                      <div className="stat-value">{transferSpeed || 'Negotiating...'}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Time Remaining</div>
                      <div className="stat-value">{timeRemaining || '--'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>
                      {completedFiles.length > 1 ? `${completedFiles.length} Files Received!` : 'File Received!'}
                    </h3>
                    <p className="hero-subtitle">
                      {completedFiles.length > 1
                        ? 'All files were downloaded to your device.'
                        : `${completedFiles[0]?.name || incomingFile?.name || 'Shared file'} was successfully downloaded to your device.`}
                    </p>
                  </div>

                  {completedFiles.length > 0 && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%'}}>
                      {completedFiles.map((f, i) => (
                        <a key={i} href={f.url} download={f.name} className="btn-download-glow" style={{fontSize: '0.85rem'}}>
                          <Download size={16} /> {f.name}
                        </a>
                      ))}
                    </div>
                  )}

                  <button className="btn-secondary" onClick={(e) => rippleTap(e, resetToHome)} style={{width: '100%', marginTop: '0.5rem'}}>
                    Close & Return
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="success-container" style={{width: '100%'}}>
                  <div className="success-icon-wrapper" style={{color: 'var(--accent-pink)', backgroundColor: 'rgba(236, 72, 153, 0.15)', filter: 'none'}}>
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="hero-title" style={{fontSize: '1.75rem', marginBottom: '0.25rem'}}>Transfer Failed</h3>
                    <p className="hero-subtitle" style={{color: 'var(--accent-pink)', fontSize: '0.9rem'}}>{errorMsg}</p>
                  </div>
                  <div className="action-buttons" style={{width: '100%'}}>
                    <button className="btn-primary" onClick={(e) => rippleTap(e, () => startP2PReceive())}>
                      Try Reconnecting
                    </button>
                    <button className="btn-secondary" onClick={(e) => rippleTap(e, resetToHome)}>
                      Return Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* QR ZOOM MODAL */}
      {showQrZoom && createPortal(
        <div className="qr-zoom-overlay" onClick={() => setShowQrZoom(false)}>
          <div className="qr-zoom-panel" onClick={(e) => e.stopPropagation()}>
            <div className="qr-zoom-header">
              <span>Scan to Connect</span>
              <button className="qr-zoom-close" onClick={() => setShowQrZoom(false)} title="Close">
                <X size={18} />
              </button>
            </div>
            <div className="qr-zoom-code">
              <QRCodeSVG
                value={getSharingUrl()}
                size={240}
                bgColor={"#ffffff"}
                fgColor={"#0b0e1c"}
                level={"H"}
                includeMargin={false}
              />
            </div>
            <div className="qr-zoom-roomcode">
              {roomCode.split('').map((ch, i) => <span key={i}>{ch}</span>)}
            </div>
            <button className="qr-zoom-link" onClick={(e) => rippleTap(e, () => copyToClipboard(getSharingUrl(), 'Share link copied!'))} title="Copy link">
              <span>{getSharingUrl()}</span>
              <Copy size={14} />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
