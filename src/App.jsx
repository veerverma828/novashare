import { useState, useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { createPortal } from 'react-dom';
import Peer from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';
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

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for P2P WebRTC
const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Reusable Tailwind class strings for the two button variants used all over
// the app — kept as constants instead of @apply so JSX stays the source of
// truth for styling, while avoiding retyping this string 30+ times.
const BTN_PRIMARY = 'relative overflow-hidden flex items-center justify-center gap-2 bg-gradient-to-br from-accent-purple to-[#7c3aed] text-white border-0 font-heading text-[0.95rem] font-semibold py-[0.8rem] px-5 rounded-xl cursor-pointer transition-all duration-300 shadow-[0_4px_12px_rgba(124,58,237,0.25)] hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(124,58,237,0.4)] hover:from-[#9061f9] hover:to-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_SECONDARY = 'relative overflow-hidden flex items-center justify-center gap-2 bg-transparent border border-border text-text-primary font-heading text-[0.95rem] font-medium py-[0.8rem] px-5 rounded-xl cursor-pointer transition-all duration-300 hover:bg-white/[0.04] hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed';

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
    <div className="flex gap-[0.3rem] font-[Georgia,serif] text-[1.1rem] max-[380px]:text-[0.95rem] tracking-[0.02em] text-accent-cyan [font-variant-numeric:lining-nums_tabular-nums]">
      {display.map((ch, i) => (
        <span key={i} className="bg-[rgba(6,182,212,0.08)] rounded-md px-[0.4rem] py-[0.1rem] [font-variant-numeric:tabular-nums]">{ch}</span>
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
      className="relative flex items-center gap-[0.7rem] bg-[rgba(30,41,59,0.5)] border border-border rounded-xl py-[0.65rem] px-[0.8rem] [touch-action:pan-y] cursor-grab"
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
      <span className="w-2 h-2 rounded-full bg-accent-purple shadow-[0_0_6px_var(--color-accent-purple)] flex-shrink-0" />
      <span className="text-[0.85rem] text-text-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: dragProgress > 0 ? 'var(--color-accent-pink)' : undefined }}>{file.name}</span>
      <span className="text-[0.72rem] text-text-muted flex-shrink-0">{sizeLabel}</span>
      <button
        type="button"
        className="relative overflow-hidden w-[22px] h-[22px] rounded-full bg-[rgba(236,72,153,0.15)] text-accent-pink border-0 flex items-center justify-center flex-shrink-0 cursor-pointer"
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
    ? <img src={icon} alt="" className="w-9 h-9 rounded-[9px] flex-shrink-0 object-cover" />
    : <div className="w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center bg-[rgba(139,92,246,0.15)] text-accent-purple"><Smartphone size={18} /></div>;
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
      <div className="flex flex-col items-center gap-3 text-text-muted text-center px-4 py-10">
        <Smartphone size={28} />
        <p>App sharing is only available in the installed NovaShare app.</p>
      </div>
    );
  }

  return (
    <div className="apps-panel flex-1 min-h-0 flex flex-col gap-4">
      <div className="relative flex items-center gap-[0.4rem] flex-shrink-0">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex items-center"><Search size={16} /></div>
        <input
          type="text"
          className="flex-1 bg-[rgba(8,12,20,0.5)] border border-border rounded-xl py-[0.8rem] pr-4 pl-10 font-heading text-[0.95rem] text-text-primary outline-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(139,92,246,0.12)]"
          placeholder="Search installed apps..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-[0.6rem] text-text-muted text-[0.85rem] py-8">
          <RefreshCw size={22} className="text-accent-purple drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] animate-[spin_1.1s_linear_infinite]" />
          <span>Loading installed apps&hellip;</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-text-secondary text-[0.9rem] px-2 py-8 text-center justify-center"><AlertCircle size={16} /> {error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-[0.85rem] text-text-muted text-center">
          {apps.length === 0 ? 'No user-installed apps found.' : `No apps match "${query}".`}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="apps-list flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pb-1 pr-[0.4rem]">
          {filtered.map((app) => {
            const isChecked = selected.has(app.packageName);
            return (
              <div
                key={app.packageName}
                className={`flex items-center gap-3 rounded-xl py-[0.6rem] px-[0.8rem] cursor-pointer transition-[background-color,border-color] duration-150 ease-linear border ${isChecked ? 'bg-[rgba(139,92,246,0.14)] border-accent-purple' : 'bg-[rgba(30,41,59,0.4)] border-border hover:bg-[rgba(30,41,59,0.65)] hover:border-accent-purple'}`}
                onClick={() => toggleSelected(app.packageName)}
              >
                <span className={`w-5 h-5 flex-shrink-0 rounded-md border-[1.5px] flex items-center justify-center text-white transition-all duration-150 ${isChecked ? 'bg-gradient-to-br from-accent-purple to-[#7c3aed] border-accent-purple' : 'border-border'}`}>
                  {isChecked && <Check size={13} strokeWidth={3} />}
                </span>
                <AppIcon packageName={app.packageName} />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[0.88rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{app.appName}</span>
                  <span className="text-[0.72rem] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
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
          className={BTN_PRIMARY}
          disabled={!!preparing}
          onClick={(e) => rippleTap(e, handleShareSelected)}
        >
          {preparing
            ? <><RefreshCw size={16} className="animate-[spin_1.1s_linear_infinite]" /> Preparing {preparing.index}/{preparing.total}&hellip;</>
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
    <svg className="w-[130px] h-[130px]" viewBox="0 0 120 120" role="img" aria-label={`Transfer ${Math.round(progress)}% complete`}>
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
        className="transition-[stroke-dashoffset] duration-200 ease-out"
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-purple)" />
          <stop offset="100%" stopColor="var(--color-accent-cyan)" />
        </linearGradient>
      </defs>
      <text x="60" y="66" textAnchor="middle" className="font-heading text-[1.35rem] font-bold fill-text-primary [font-variant-numeric:tabular-nums]">{Math.round(progress)}%</text>
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

  // "Add more" picker state (queue view: append files or apps to the queue)
  const [showAddApps, setShowAddApps] = useState(false);

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

  // Hardware back button: step back through modal > view > tab instead of
  // closing the app. Refs mirror the live state so the listener (registered
  // once) never sees stale values.
  const modeRef = useRef(mode);
  const homeTabRef = useRef(homeTab);
  const showQrZoomRef = useRef(showQrZoom);
  const showScannerRef = useRef(showScanner);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { homeTabRef.current = homeTab; }, [homeTab]);
  useEffect(() => { showQrZoomRef.current = showQrZoom; }, [showQrZoom]);
  useEffect(() => { showScannerRef.current = showScanner; }, [showScanner]);

  useEffect(() => {
    const handle = CapacitorApp.addListener('backButton', () => {
      if (showQrZoomRef.current) {
        setShowQrZoom(false);
        return;
      }
      if (showScannerRef.current) {
        setShowScanner(false);
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

  // Cleanup active peer/connections
  function cleanup() {
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
      try { peerState.conn.send({ type: 'batch-complete' }); } catch { /* ignore */ }
      updateAggregateStats();
      if (connsRef.current.length > 0 && connsRef.current.every((p) => p.queueIndex >= files.length)) {
        setTransferState('complete');
        import('canvas-confetti').then(({ default: confetti }) => confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } }));
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

  function startP2PReceive(roomCodeInput) {
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
  }

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
      import('canvas-confetti').then(({ default: confetti }) => confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      }));
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
      const { default: jsQR } = await import('jsqr');
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
    } catch {
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
    const wrapperClass = "w-12 h-12 rounded-xl bg-[rgba(6,182,212,0.15)] flex items-center justify-center text-accent-cyan";
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
    <div className="max-w-[1200px] w-full min-h-0 flex-1 mx-auto flex flex-col justify-start overflow-x-hidden gap-3 max-[640px]:gap-2 p-5 max-[640px]:p-3 max-[380px]:p-2 pt-[max(1.25rem,env(safe-area-inset-top))] max-[640px]:pt-[max(0.75rem,env(safe-area-inset-top))] max-[380px]:pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] max-[640px]:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-[380px]:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* HEADER */}
      <header className="flex items-center justify-between border-b border-border pb-5 max-[640px]:pb-3 max-[640px]:gap-2">
        <div className="flex items-center gap-3 cursor-pointer" onClick={resetToHome}>
          <Zap
            size={32}
            className="text-accent-purple drop-shadow-[0_0_8px_rgba(139,92,246,0.5)] w-8 h-8 max-[640px]:w-6 max-[640px]:h-6"
            fill="currentColor"
          />
          <h1 className="text-[1.75rem] max-[640px]:text-[1.4rem] max-[380px]:text-[1.15rem] font-heading bg-[linear-gradient(135deg,#fff_30%,var(--color-accent-cyan)_100%)] bg-clip-text text-transparent">
            NovaShare
          </h1>
          <span className="bg-bg-tertiary border border-[rgba(139,92,246,0.3)] text-accent-purple px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase max-[640px]:px-2 max-[640px]:py-[0.15rem] max-[640px]:text-[0.65rem] max-[380px]:hidden">
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

      {/* TOAST POPUP */}
      {toast && (
        <div className="fixed bottom-8 right-8 max-[640px]:left-4 max-[640px]:right-4 max-[640px]:bottom-4 bg-[rgba(15,23,42,0.9)] backdrop-blur-md border border-accent-purple rounded-[14px] px-6 py-4 flex items-center gap-3 text-text-primary shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_15px_rgba(139,92,246,0.2)] z-[9999] animate-[slideIn_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          {toast.type === 'success' && <ShieldCheck size={20} className="text-accent-green" />}
          {toast.type === 'error' && <AlertCircle size={20} className="text-accent-pink" />}
          {toast.type === 'info' && <Info size={20} className="text-accent-cyan" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MAIN LAYOUT CONTAINER */}
      <main className="flex-1 min-h-0 flex flex-col items-center justify-start py-2">
        <div className="w-full max-w-[490px] flex-1 min-h-0 flex flex-col justify-center p-6 max-[640px]:px-4 max-[640px]:py-5 max-[640px]:rounded-2xl max-[640px]:m-0 max-[380px]:px-3 max-[380px]:py-4 bg-[rgba(15,23,42,0.45)] backdrop-blur-2xl border border-white/[0.08] rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.07),0_0_40px_rgba(139,92,246,0.04)] transition-[border-color,box-shadow] duration-300 hover:border-[rgba(139,92,246,0.25)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.12),0_0_50px_rgba(139,92,246,0.08)]">

          {/* ==================================================== */}
          {/* VIEW: HOME VIEW                                      */}
          {/* ==================================================== */}
          {mode === 'home' && (
            <div className="flex-1 min-h-0 flex flex-col w-full">
              <div className="text-center mb-6 flex-shrink-0">
                <h2 className="text-[1.85rem] max-[640px]:text-2xl max-[380px]:text-[1.3rem] leading-[1.2] mb-2 font-bold glow-text">Secure P2P File Sharing</h2>
                <p className="text-text-secondary text-[0.925rem] max-[380px]:text-[0.85rem]">Transfer files directly browser-to-browser. Encrypted, private, with zero size limits.</p>
              </div>

              {/* TOP TAB SWITCHER: Home / Apps (hidden once a file is queued) */}
              {selectedFiles.length === 0 && (
                <div className="flex flex-shrink-0 gap-[0.4rem] bg-[rgba(8,12,20,0.5)] border border-border rounded-xl p-[0.3rem] mb-6">
                  <button
                    type="button"
                    className={`flex-1 bg-transparent border-0 font-heading text-[0.85rem] font-semibold py-[0.55rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 ${homeTab === 'home' ? 'bg-gradient-to-br from-accent-purple to-[#7c3aed] text-white shadow-[0_2px_10px_rgba(124,58,237,0.3)]' : 'text-text-muted hover:text-text-primary'}`}
                    onClick={() => setHomeTab('home')}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={`flex-1 bg-transparent border-0 font-heading text-[0.85rem] font-semibold py-[0.55rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 ${homeTab === 'apps' ? 'bg-gradient-to-br from-accent-purple to-[#7c3aed] text-white shadow-[0_2px_10px_rgba(124,58,237,0.3)]' : 'text-text-muted hover:text-text-primary'}`}
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
                  className={`group border-2 border-dashed rounded-[18px] px-6 py-10 max-[640px]:py-8 max-[640px]:px-4 max-[380px]:py-6 max-[380px]:px-3 text-center cursor-pointer bg-[rgba(15,23,42,0.25)] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] relative overflow-hidden ${dragActive ? 'border-accent-cyan bg-[rgba(6,182,212,0.04)] shadow-[0_0_25px_rgba(6,182,212,0.12)]' : 'border-[rgba(139,92,246,0.25)] hover:border-accent-cyan hover:bg-[rgba(6,182,212,0.04)] hover:shadow-[0_0_25px_rgba(6,182,212,0.12)]'}`}
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
                  <div className="flex flex-col items-center gap-4">
                    <div className={`w-14 h-14 rounded-[14px] flex items-center justify-center transition-all duration-300 ${dragActive ? 'bg-[rgba(6,182,212,0.15)] text-accent-cyan -translate-y-1' : 'bg-[rgba(139,92,246,0.08)] text-accent-purple group-hover:bg-[rgba(6,182,212,0.15)] group-hover:text-accent-cyan group-hover:-translate-y-1'}`}>
                      <UploadCloud size={32} />
                    </div>
                    <div>
                      <h3 className="text-[1.15rem] max-[380px]:text-base font-medium text-text-primary">Drag & drop your files here</h3>
                      <p className="text-[0.85rem] text-text-muted">or click to browse files from your device</p>
                    </div>
                    <span className="bg-bg-tertiary border border-[rgba(139,92,246,0.3)] text-accent-purple px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase max-[640px]:px-2 max-[640px]:py-[0.15rem] max-[640px]:text-[0.65rem]">
                      No File Size Limits
                    </span>
                  </div>
                </div>
              ) : (
                /* FILES SELECTED STATE CARD */
                <div className="flex-1 min-h-0 flex flex-col">
                  {selectedFiles.length === 1 ? (
                    <div className="flex items-center gap-4 bg-[rgba(30,41,59,0.4)] border border-border rounded-2xl p-5 mb-8 max-[380px]:px-3 max-[380px]:py-4 max-[380px]:gap-3">
                      {renderFileIconComponent(selectedFiles[0].name)}
                      <div className="flex-grow min-w-0">
                        <h4 className="text-[0.95rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{selectedFiles[0].name}</h4>
                        <p className="text-[0.8rem] text-text-secondary">{formatBytes(selectedFiles[0].size)}</p>
                      </div>
                      <button className="bg-transparent border-0 text-text-muted cursor-pointer p-1 rounded-md transition-all duration-200 hover:text-accent-pink hover:bg-[rgba(236,72,153,0.15)]" onClick={() => setSelectedFiles([])}>
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="flex justify-between items-baseline gap-2 text-[0.8rem] text-text-secondary mb-3 flex-wrap flex-shrink-0">
                        <span>{selectedFiles.length} files selected &middot; {formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))} total</span>
                        <span className="text-[0.72rem] text-text-muted">swipe or tap &times; to drop a file</span>
                      </div>
                      <div className="queue flex-1 min-h-[80px] flex flex-col gap-[0.6rem] mb-6 overflow-y-auto p-3 pr-[0.6rem] rounded-2xl border border-border bg-[rgba(8,12,20,0.25)]">
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

                  <div className="flex flex-row gap-3 mb-3 flex-shrink-0">
                    <button className={`${BTN_SECONDARY} flex-1`} onClick={(e) => rippleTap(e, triggerFileInput)}>
                      <UploadCloud size={16} /> Add Files
                    </button>
                    <button className={`${BTN_SECONDARY} flex-1`} onClick={(e) => rippleTap(e, () => setShowAddApps(true))}>
                      <Smartphone size={16} /> Add Apps
                    </button>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                  />

                  <div className="flex flex-col gap-3 flex-shrink-0">
                    <button className={BTN_PRIMARY} onClick={(e) => rippleTap(e, startP2PSend)}>
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

              {/* RECEIVE AREA (ONLY SHOW IF NO FILE CURRENTLY BEING SENT) */}
              {selectedFiles.length === 0 && (
                <div>
                  <div className="flex items-center text-center my-[1.1rem] text-text-muted text-[0.8rem] before:content-[''] before:flex-1 before:border-b before:border-border before:mr-3 after:content-[''] after:flex-1 after:border-b after:border-border after:ml-3">or receive a file</div>
                  <div className="flex flex-col gap-3">
                    <div className="relative flex items-center gap-[0.4rem] flex-shrink-0">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex items-center">
                        <Download size={20} />
                      </div>
                      <input
                        type="text"
                        placeholder="Enter Room Code (e.g. 4D8G2X)"
                        className="w-auto flex-1 bg-[rgba(8,12,20,0.5)] border border-border rounded-xl py-[0.8rem] pr-4 pl-10 font-heading text-[0.95rem] text-text-primary outline-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(139,92,246,0.12)]"
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
                    <button className={`${BTN_SECONDARY} justify-center`} onClick={(e) => rippleTap(e, () => startP2PReceive())}>
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
                            <RefreshCw size={32} className="text-accent-purple drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] animate-[spin_1.1s_linear_infinite]" />
                          </div>
                        )}
                        <video
                          ref={scanVideoRef}
                          className="w-full h-full object-cover"
                          style={{ visibility: cameraReady ? 'visible' : 'hidden' }}
                          playsInline
                          muted
                        />
                        {cameraReady && <div className="absolute inset-[12%] border-2 border-accent-purple rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.4)] pointer-events-none" />}
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
            <div className="flex flex-col items-center text-center gap-8">
              <div className="w-full flex items-center gap-3 mb-2 flex-wrap">
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
                <>
                  <p className="text-text-secondary text-[0.925rem] max-[380px]:text-[0.85rem] mb-4 font-medium text-center">
                    Setting up your P2P sharing room&hellip;
                  </p>
                  <div className="flex items-center justify-center py-10 pb-6">
                    <RefreshCw size={40} className="text-accent-purple drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] animate-[spin_1.1s_linear_infinite]" />
                  </div>
                  <p className="text-[0.85rem] text-text-muted max-w-[280px] text-center mx-auto mt-3">
                    Reaching the signaling server to allocate your room code. This can take a moment on a slow connection.
                  </p>
                </>
              )}

              {/* Waiting for connection */}
              {transferState === 'waiting' && (
                <>
                  <div className="flex items-center justify-center w-full gap-3 my-2 mb-3" role="img" aria-label="Waiting for a peer to connect">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-[1] bg-[rgba(139,92,246,0.15)] border border-[rgba(139,92,246,0.4)] text-accent-purple shadow-[0_0_14px_rgba(139,92,246,0.25)]"><Zap size={18} /></div>
                    <div className="relative flex-1 min-w-[60px] max-w-[180px] h-[3px] rounded-full overflow-hidden bg-[linear-gradient(90deg,rgba(139,92,246,0.45),rgba(6,182,212,0.45))] shadow-[0_0_6px_rgba(139,92,246,0.3)] after:content-[''] after:absolute after:top-0 after:h-full after:w-[40%] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.95),transparent)] after:animate-[hsSweep_1.8s_ease-in-out_infinite]" />
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-[1] bg-[rgba(6,182,212,0.15)] border border-[rgba(6,182,212,0.4)] text-accent-cyan shadow-[0_0_14px_rgba(6,182,212,0.25)]"><Laptop size={18} /></div>
                  </div>
                  <p className="text-center text-[0.8rem] text-text-muted mb-4">Waiting for peers to scan or enter your code&hellip; anyone with it can join.</p>

                  <div className="flex flex-col gap-3 w-full">
                    <div className="flex items-center justify-between bg-white/[0.03] border border-accent-purple/30 rounded-xl py-[0.65rem] px-[0.9rem]">
                      <RoomCodeFlap code={roomCode} />
                      <button
                        className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
                        onClick={(e) => rippleTap(e, () => copyToClipboard(roomCode, 'Room code copied!'))}
                        title="Copy Code"
                      >
                        <Copy size={16} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-[0.6rem] bg-white/[0.03] border border-accent-purple/30 rounded-xl py-[0.6rem] px-[0.9rem] text-[0.72rem] text-text-secondary">
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{getSharingUrl()}</span>
                      <button
                        className="relative overflow-hidden bg-transparent border-0 text-text-secondary cursor-pointer flex items-center p-[0.4rem] rounded-md transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
                        onClick={(e) => rippleTap(e, () => copyToClipboard(getSharingUrl(), 'Share link copied!'))}
                        title="Copy Link"
                      >
                        <Copy size={14} />
                      </button>
                    </div>

                    <div className="flex items-center gap-4 mt-1">
                      <div
                        className="w-[82px] h-[82px] bg-white rounded-[10px] p-[5px] flex-shrink-0 flex items-center justify-center cursor-pointer transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none"
                        onClick={() => setShowQrZoom(true)}
                        role="button"
                        tabIndex={0}
                        title="Tap to enlarge"
                      >
                        <QRCodeSVG
                          value={getSharingUrl()}
                          size={72}
                          bgColor={"#ffffff"}
                          fgColor={"#0b0e1c"}
                          level={"H"}
                          includeMargin={false}
                        />
                      </div>
                      <div className="flex-1 min-w-0 text-[0.72rem] text-text-secondary leading-[1.5] flex flex-col gap-[0.15rem] text-left">
                        <b className="text-text-primary text-[0.78rem]">Scan to connect</b>
                        Keep this tab open &mdash; the file streams directly, peer to peer. Tap the QR code to enlarge.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Transferring State */}
              {transferState === 'transferring' && (
                <div className="flex flex-col gap-6 w-full">
                  <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(6,182,212,0.08)] border border-[rgba(6,182,212,0.2)] text-accent-cyan">
                    <Users size={14} /> {connectedCount} {connectedCount === 1 ? 'receiver' : 'receivers'} connected
                  </div>

                  {sendFileCount > 1 && (
                    <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(139,92,246,0.08)] border border-[rgba(139,92,246,0.2)] text-accent-purple">
                      File {sendFileIndex + 1} of {sendFileCount}: {selectedFiles[sendFileIndex]?.name}
                    </div>
                  )}

                  <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(6,182,212,0.1)] border border-[rgba(6,182,212,0.2)] text-accent-cyan">
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
                </div>
              )}

              {/* Complete State */}
              {transferState === 'complete' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(16,185,129,0.15)] text-accent-green drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <h3 className="text-[1.75rem] mb-1 leading-[1.2] font-bold glow-text">Transfer Complete!</h3>
                    <p className="text-text-secondary text-[0.925rem]">
                      {sendFileCount > 1 ? `Your ${sendFileCount} files were shared directly and securely.` : 'Your file was shared directly and securely.'}
                    </p>
                  </div>
                  <button className={`${BTN_PRIMARY} w-full`} onClick={(e) => rippleTap(e, resetToHome)}>
                    Share Another File
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(236,72,153,0.15)] text-accent-pink">
                    <AlertCircle size={36} />
                  </div>
                  <div>
                    <h3 className="text-[1.75rem] mb-1 leading-[1.2] font-bold glow-text">Connection Interrupted</h3>
                    <p className="text-accent-pink text-[0.9rem]">{errorMsg}</p>
                  </div>
                  <div className="flex flex-col gap-3 w-full">
                    <button className={BTN_PRIMARY} onClick={(e) => rippleTap(e, startP2PSend)}>
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
                    <RefreshCw size={40} className="text-accent-purple drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] animate-[spin_1.1s_linear_infinite]" />
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
                    <RefreshCw size={40} className="text-accent-purple drop-shadow-[0_0_10px_rgba(139,92,246,0.5)] animate-[spin_1.1s_linear_infinite]" />
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
                    <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(139,92,246,0.08)] border border-[rgba(139,92,246,0.2)] text-accent-purple">
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

                  <div className="inline-flex items-center gap-2 py-[0.4rem] px-4 rounded-full text-[0.85rem] font-semibold mx-auto bg-[rgba(139,92,246,0.1)] border border-[rgba(139,92,246,0.2)] text-accent-purple">
                    <RefreshCw size={14} style={{animation: isPeerPaused ? 'none' : 'spin 2s linear infinite'}} />
                    {isPeerPaused ? 'Paused by sender' : 'Receiving File...'}
                  </div>

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
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(16,185,129,0.15)] text-accent-green drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]">
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

                  {completedFiles.length > 0 && (
                    <div className="flex flex-col gap-2 w-full">
                      {completedFiles.map((f, i) => (
                        <a
                          key={i}
                          href={f.url}
                          download={f.name}
                          className="bg-gradient-to-br from-accent-green to-[#059669] text-[#080c14] border-0 font-heading font-bold text-[0.85rem] py-[1.2rem] px-8 rounded-2xl cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_4px_20px_rgba(16,185,129,0.4)] no-underline w-full mt-4 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(16,185,129,0.6)] hover:from-[#34d399] hover:to-[#047857]"
                        >
                          <Download size={16} /> {f.name}
                        </a>
                      ))}
                    </div>
                  )}

                  <button className={`${BTN_SECONDARY} w-full mt-2`} onClick={(e) => rippleTap(e, resetToHome)}>
                    Close & Return
                  </button>
                </div>
              )}

              {/* Error State */}
              {transferState === 'error' && (
                <div className="flex flex-col items-center text-center gap-6 w-full">
                  <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-[rgba(236,72,153,0.15)] text-accent-pink">
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

        </div>
      </main>

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
                value={getSharingUrl()}
                size={240}
                bgColor={"#ffffff"}
                fgColor={"#0b0e1c"}
                level={"H"}
                includeMargin={false}
              />
            </div>
            <div className="flex gap-[0.4rem]">
              {roomCode.split('').map((ch, i) => (
                <span key={i} className="font-heading text-[1.15rem] font-bold tracking-[0.02em] text-accent-cyan bg-white/5 border border-border rounded-lg w-8 h-[38px] flex items-center justify-center">{ch}</span>
              ))}
            </div>
            <button
              className="flex items-center gap-2 w-full bg-white/[0.03] border border-border rounded-[10px] py-[0.55rem] px-3 cursor-pointer text-text-secondary transition-colors duration-150 hover:bg-white/[0.07]"
              onClick={(e) => rippleTap(e, () => copyToClipboard(getSharingUrl(), 'Share link copied!'))}
              title="Copy link"
            >
              <span className="flex-1 text-[0.72rem] text-left overflow-hidden text-ellipsis whitespace-nowrap">{getSharingUrl()}</span>
              <Copy size={14} className="flex-shrink-0" />
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
