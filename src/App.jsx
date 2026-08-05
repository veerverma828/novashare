import { useState, useEffect, useRef, useMemo } from 'react';
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
  Search,
  Check,
  Users,
  History as HistoryIcon,
  Type,
  FolderUp,
  Folder,
  ChevronDown,
  ChevronRight,
  Gauge,
  Radar,
  ShieldQuestion,
  ClipboardCopy,
  Trash2
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
  wifiDirectConnect,
  wifiDirectRequestGroupInfo,
  wifiDirectRemoveGroup,
  onWifiDirectPeersChanged,
  onWifiDirectConnectionChanged,
  localSignalingStartServer,
  localSignalingStopServer,
  localSignalingConnect,
  localSignalingSend,
  localSignalingClose,
  onLocalSignalingMessage,
  onLocalSignalingPeerConnected,
  checkForAppUpdate,
  startFlexibleAppUpdate,
  completeFlexibleAppUpdate,
  onAppUpdateStateChanged
} from './native';
import { addHistoryEntry, getHistory, clearHistory } from './history';
import { computeSecurityCode } from './security';
import {
  RATE_PRESETS,
  arrayBufferToBase64,
  mapWithConcurrency,
  formatBytes,
  formatSpeed,
  formatTime,
  getFileType,
  generateRoomCode,
  extractRoomCode
} from './transferUtils';
import {
  createLocalPeerConnection,
  createOfferAndChannel,
  waitForRemoteChannel,
  createAnswerFromOffer,
  applyRemoteAnswer,
  addRemoteIceCandidate,
  waitForChannelOpen,
  PeerJsCompatDataConnection
} from './webrtcLocal';

const LOCAL_SIGNALING_PORT = 8916;

// Fully offline handshake: negotiates a manual WebRTC data channel over the
// Wi-Fi Direct link's local signaling pipe (LocalSignaling native plugin)
// instead of PeerJS's cloud broker — no internet involved at any point.
// Whichever device is NOT the Wi-Fi Direct group owner already knows the
// owner's address, so it connects to the signaling socket and sends the SDP
// offer immediately; the group owner starts the socket and waits, then
// answers. Resolves with a PeerJsCompatDataConnection once the resulting
// RTCDataChannel is open, so callers can treat it exactly like a PeerJS conn.
// Resolves with { conn, roomCode, deviceName }, not just conn — the group
// owner side doesn't generate its own roomCode, it learns the offerer's
// via the offer message, so both ends converge on one canonical value
// (required for computeSecurityCode(roomCode, ...) to match on both sides).
async function establishLocalConnection({ isGroupOwner, groupOwnerAddress, roomCode, deviceName }, timeoutMs = 30000) {
  const pc = createLocalPeerConnection();
  let signalConnId = null;
  let settled = false;

  const sendSignal = (msg) => {
    if (signalConnId == null) return;
    localSignalingSend(signalConnId, msg);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ type: 'ice', candidate: e.candidate.toJSON() });
  };

  let resolvedRoomCode = roomCode;
  let resolvedDeviceName = deviceName;

  const offMessage = onLocalSignalingMessage(async (connId, msg) => {
    if (signalConnId != null && connId !== signalConnId) return;
    if (msg.type === 'offer') {
      resolvedRoomCode = msg.roomCode || resolvedRoomCode;
      resolvedDeviceName = msg.deviceName || resolvedDeviceName;
      const answerSdp = await createAnswerFromOffer(pc, msg.sdp);
      sendSignal({ type: 'answer', sdp: answerSdp });
    } else if (msg.type === 'answer') {
      await applyRemoteAnswer(pc, msg.sdp);
    } else if (msg.type === 'ice') {
      await addRemoteIceCandidate(pc, msg.candidate);
    }
  });
  const offConnected = onLocalSignalingPeerConnected((connId) => { signalConnId = connId; });

  const cleanupSignal = () => {
    offMessage();
    offConnected();
    if (isGroupOwner) {
      localSignalingStopServer();
    } else if (signalConnId != null) {
      localSignalingClose(signalConnId);
    }
  };

  try {
    const channel = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out negotiating a local Wi-Fi Direct connection'));
      }, timeoutMs);

      const finish = (ch) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waitForChannelOpen(ch, timeoutMs).then(resolve).catch(reject);
      };

      if (isGroupOwner) {
        waitForRemoteChannel(pc).then(finish);
        localSignalingStartServer().catch((err) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(err); }
        });
      } else {
        (async () => {
          try {
            signalConnId = await localSignalingConnect(groupOwnerAddress, LOCAL_SIGNALING_PORT);
            const { channel: ch, sdp } = await createOfferAndChannel(pc);
            sendSignal({ type: 'offer', sdp, roomCode, deviceName });
            finish(ch);
          } catch (err) {
            if (!settled) { settled = true; clearTimeout(timer); reject(err); }
          }
        })();
      }
    });
    const peerId = groupOwnerAddress || 'wifi-direct-peer';
    return { conn: new PeerJsCompatDataConnection(channel, peerId), roomCode: resolvedRoomCode, deviceName: resolvedDeviceName };
  } finally {
    cleanupSignal();
  }
}

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
const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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

// Reusable Tailwind class strings for the two button variants used all over
// the app — kept as constants instead of @apply so JSX stays the source of
// truth for styling, while avoiding retyping this string 30+ times.
const BTN_PRIMARY = 'relative overflow-hidden flex items-center justify-center gap-2 bg-accent-purple text-[#06222c] border-0 font-heading text-[0.95rem] font-semibold py-[0.8rem] px-5 rounded-xl cursor-pointer transition-all duration-300 hover:-translate-y-px hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed';
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
export function RoomCodeFlap({ code }) {
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
        <span key={i} className="bg-[rgba(125,211,255,0.08)] rounded-md px-[0.4rem] py-[0.1rem] [font-variant-numeric:tabular-nums]">{ch}</span>
      ))}
    </div>
  );
}

// One row in the multi-file send queue: drag/swipe left (or tap the X) to
// drop a file before the transfer starts. Pointer Events cover mouse,
// touch, and pen with one handler set.
export function SwipeableFileRow({ file, sizeLabel, onRemove }) {
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
      className="relative flex items-center gap-[0.7rem] bg-[rgba(30,41,59,0.5)] border border-border rounded-xl py-[0.65rem] px-[0.8rem] [touch-action:pan-y] cursor-grab flex-shrink-0"
      style={{
        transform: `translateX(${dragX}px)`,
        opacity: 1 - dragProgress * 0.5,
        borderColor: dragProgress > 0
          ? `rgba(248,113,113, ${0.25 + dragProgress * 0.75})`
          : undefined,
        background: dragProgress > 0
          ? `rgba(248,113,113, ${dragProgress * 0.22})`
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
        className="relative overflow-hidden w-[22px] h-[22px] rounded-full bg-[rgba(248,113,113,0.15)] text-accent-pink border-0 flex items-center justify-center flex-shrink-0 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); rippleTap(e, onRemove); }}
        aria-label={`Remove ${file.name}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// A picked folder's files ride in the same flat selectedFiles queue as loose
// files (webkitRelativePath is how we tell them apart), but shown flat that
// queue turns into a wall of individual filenames for a big folder. This
// collapses a folder's files behind one row — tap to expand and browse what's
// actually going to send, tap X to drop the whole folder at once.
export function FolderQueueRow({ name, entries, formatBytes, onRemoveAll, onRemoveOne }) {
  const [open, setOpen] = useState(false);
  const totalSize = entries.reduce((sum, { file }) => sum + file.size, 0);

  return (
    <div className="rounded-xl border border-border bg-[rgba(30,41,59,0.5)] overflow-hidden flex-shrink-0">
      <div
        className="relative flex items-center gap-[0.7rem] py-[0.65rem] px-[0.8rem] cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={14} className="text-text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-text-muted flex-shrink-0" />}
        <Folder size={16} className="text-accent-cyan flex-shrink-0" />
        <span className="text-[0.85rem] text-text-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
        <span className="text-[0.72rem] text-text-muted flex-shrink-0">{entries.length} file{entries.length === 1 ? '' : 's'} &middot; {formatBytes(totalSize)}</span>
        <button
          type="button"
          className="relative overflow-hidden w-[22px] h-[22px] rounded-full bg-[rgba(248,113,113,0.15)] text-accent-pink border-0 flex items-center justify-center flex-shrink-0 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); rippleTap(e, onRemoveAll); }}
          aria-label={`Remove folder ${name}`}
        >
          <X size={12} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-[0.4rem] p-[0.5rem] pt-0 pl-8">
          {entries.map(({ file, index }) => (
            <SwipeableFileRow
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              sizeLabel={formatBytes(file.size)}
              onRemove={() => onRemoveOne(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Module-scope cache so re-mounting the Apps tab doesn't refetch icons
// already fetched over the native bridge this session.
const appIconCache = new Map();

export function AppIcon({ packageName }) {
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
  }, [packageName, icon]);

  return icon
    ? <img src={icon} alt="" className="w-9 h-9 rounded-[9px] flex-shrink-0 object-cover" />
    : <div className="w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center bg-[rgba(125,211,255,0.15)] text-accent-purple"><Smartphone size={18} /></div>;
}

// Wraps the substring of `text` matching `query` (case-insensitive) in a
// highlighted <mark> — used to show which part of an app name matched search.
export function HighlightMatch({ text, query }) {
  const q = query.trim();
  if (!q) return text;

  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-purple/30 text-accent-purple rounded-[3px] px-[1px]">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// Runs `worker` over `items` with at most `limit` in flight at once, resolving
// to results in original item order regardless of completion order.
// Installed-apps browser for the "Apps" home tab: lists user-installed
// packages (native bridge only), lets the user search and multi-select, and
// hands back ready-to-send Files built from each APK's bytes so they drop
// straight into the same selectedFiles queue the file dropzone uses.
export function AppsPanel({ onSelectApps, formatBytes }) {
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
    ? apps.filter((a) => a.appName.toLowerCase().includes(query.toLowerCase()))
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
      // Each app is prepped independently — one failure (over the size cap,
      // uninstalled mid-scan, etc.) must not drop the rest of the selection.
      const failed = [];
      const results = await mapWithConcurrency(picked, 3, async (app) => {
        try {
          const file = await getAppApkFile(app.packageName, app.appName, app.versionName);
          return file;
        } catch (err) {
          console.error(`Failed to prepare ${app.packageName}:`, err);
          failed.push(app.appName || app.packageName);
          return null;
        } finally {
          completed += 1;
          setPreparing({ index: completed, total: picked.length });
        }
      });
      const files = results.filter(Boolean);

      if (failed.length > 0) {
        setError(`Could not prepare: ${failed.join(', ')}${files.length > 0 ? ' — sending the rest.' : ''}`);
      }
      if (files.length > 0) onSelectApps(files);
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
          className="flex-1 bg-[rgba(8,12,20,0.5)] border border-border rounded-xl py-[0.8rem] pr-4 pl-10 font-heading text-[0.95rem] text-text-primary outline-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(125,211,255,0.12)]"
          placeholder="Search installed apps..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-[0.6rem] text-text-muted text-[0.85rem] py-8">
          <RefreshCw size={22} className="text-accent-purple drop-shadow-[0_0_10px_rgba(125,211,255,0.5)] animate-[spin_1.1s_linear_infinite]" />
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
        // Responsive tile grid (was a vertical list): auto-fill sizes each
        // tile to a ~92px minimum and lets the track add/remove columns as
        // the panel width changes, so it self-adjusts across phone sizes
        // (and the wider modal/desktop width) with no manual breakpoints.
        // Behavior below (click-to-toggle, checkbox state, search highlight,
        // AppsPanel state/handlers) is unchanged from the list version.
        <div className="apps-list flex-1 min-h-0 grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] auto-rows-max gap-2.5 content-start overflow-y-auto pb-1 pr-[0.4rem]">
          {filtered.map((app) => {
            const isChecked = selected.has(app.packageName);
            return (
              <div
                key={app.packageName}
                title={`${app.packageName}${app.versionName ? ` · v${app.versionName}` : ''} · ${formatBytes(app.apkSize)}`}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl py-3 px-2 cursor-pointer transition-[background-color,border-color] duration-150 ease-linear border text-center ${isChecked ? 'bg-[rgba(125,211,255,0.14)] border-accent-purple' : 'bg-[rgba(30,41,59,0.4)] border-border hover:bg-[rgba(30,41,59,0.65)] hover:border-accent-purple'}`}
                onClick={() => toggleSelected(app.packageName)}
              >
                <span className={`absolute top-1.5 right-1.5 w-5 h-5 flex-shrink-0 rounded-md border-[1.5px] flex items-center justify-center text-white transition-all duration-150 ${isChecked ? 'bg-accent-purple border-accent-purple !text-[#06222c]' : 'border-border bg-[rgba(8,12,20,0.5)]'}`}>
                  {isChecked && <Check size={13} strokeWidth={3} />}
                </span>
                <AppIcon packageName={app.packageName} />
                <div className="w-full min-w-0 flex flex-col items-center">
                  <span className="w-full text-[0.78rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis"><HighlightMatch text={app.appName} query={query} /></span>
                  <span className="w-full text-[0.65rem] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
                    {app.versionName ? `v${app.versionName} · ` : ''}{formatBytes(app.apkSize)}
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

// Past sent/received transfers (feature #3), read fresh from localStorage
// each time it mounts (parent remounts it via a `key` bump). Re-send only
// works for "sent" entries whose File objects are still alive in
// sentFilesMemory (this session only) — otherwise it prompts to reselect.
export function HistoryPanel({ formatBytes, onResend, onClear, now }) {
  const entries = getHistory();

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-text-muted text-center px-4 py-10">
        <HistoryIcon size={28} />
        <p>No transfers yet — sent and received files will show up here.</p>
      </div>
    );
  }

  // `now` is captured by the caller (at the moment the History tab was
  // opened, in an event handler) rather than read here via Date.now() —
  // component render must stay pure/idempotent.
  const formatWhen = (ts) => {
    const diff = now - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-[0.8rem] text-text-muted">{entries.length} transfer{entries.length === 1 ? '' : 's'}</span>
        <button
          type="button"
          className="relative overflow-hidden flex items-center gap-1 bg-transparent border-0 text-text-muted text-[0.78rem] cursor-pointer py-1 px-2 rounded-md hover:text-accent-pink hover:bg-[rgba(248,113,113,0.1)]"
          onClick={(e) => rippleTap(e, onClear)}
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-[0.4rem]">
        {entries.map((entry) => {
          const totalSize = entry.files.reduce((sum, f) => sum + (f.size || 0), 0);
          const label = entry.files.length > 1
            ? `${entry.files.length} ${entry.kind === 'text' ? 'text snippets' : 'files'}`
            : (entry.files[0]?.name || 'Unknown');
          return (
            <div key={entry.id} className="flex items-center gap-3 bg-[rgba(30,41,59,0.4)] border border-border rounded-xl py-[0.6rem] px-[0.8rem]">
              <div className={`w-9 h-9 rounded-[9px] flex-shrink-0 flex items-center justify-center ${entry.direction === 'sent' ? 'bg-[rgba(125,211,255,0.15)] text-accent-purple' : 'bg-[rgba(125,211,255,0.15)] text-accent-cyan'}`}>
                {entry.direction === 'sent' ? <UploadCloud size={16} /> : <Download size={16} />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-[0.85rem] font-semibold text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
                <span className="text-[0.72rem] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
                  {entry.direction === 'sent' ? 'Sent' : 'Received'} · {formatBytes(totalSize)} · {formatWhen(entry.timestamp)} · room {entry.roomCode}
                </span>
              </div>
              {entry.direction === 'sent' && (
                <button
                  type="button"
                  className="relative overflow-hidden flex-shrink-0 bg-transparent border border-border text-text-secondary cursor-pointer flex items-center gap-1 py-[0.4rem] px-[0.6rem] rounded-lg text-[0.75rem] transition-all duration-200 hover:bg-white/5 hover:text-text-primary"
                  onClick={(e) => rippleTap(e, () => onResend(entry))}
                  title="Re-send"
                >
                  <RefreshCw size={13} /> Re-send
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Circular transfer progress — reads the same speed/ETA lines the linear
// bar used to, just given a shape that matches the round dropzone/radar
// motifs already in the app.
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function TransferRing({ progress, gradientId = 'ringGrad' }) {
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
  const [wifiDirectConnecting, setWifiDirectConnecting] = useState(null); // deviceAddress mid-connect, or null

  // Transfer history tab — bumped to force a re-read from localStorage.
  // historyOpenedAt is captured once (in the tab-click handler) rather than
  // read fresh during HistoryPanel's render, keeping render pure.
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyOpenedAt, setHistoryOpenedAt] = useState(0);

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

  // Bandwidth throttle (feature #8) — 0 = unlimited, else target KB/s per peer.
  const [maxRateKBps, setMaxRateKBps] = useState(0);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const maxRateRef = useRef(0);
  useEffect(() => { maxRateRef.current = maxRateKBps; }, [maxRateKBps]);

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
  // Active receiver transport, so a mid-transfer reconnect (scheduleReconnectRetry)
  // retries over the same transport it was using rather than defaulting to cloud.
  const receiverTransportRef = useRef({ mode: 'cloud', groupInfo: null });
  // Tracks the active send's transport so the room-advertising effect below
  // knows whether it's safe to also host a direct local-LAN listener (only
  // for 'cloud' sends — a 'local' Wi-Fi Direct send already owns the same
  // native LocalSignaling server for its own handshake).
  const senderTransportRef = useRef('cloud');
  // Throttles the background transfer notification to a few updates/sec
  // instead of firing on every 64KB chunk
  const notifyThrottleRef = useRef(0);
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
    }).catch(() => {});
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
      wifiDirectStopDiscovery();
      return;
    }

    let cancelled = false;
    wifiDirectInitialize()
      .then(() => { if (!cancelled) wifiDirectDiscoverPeers(); })
      .catch((err) => {
        if (!cancelled) {
          setWifiDirectBrowsing(false);
          showToast('Could not start Wi-Fi Direct discovery: ' + err.message, 'error');
        }
      });

    const offPeers = onWifiDirectPeersChanged((peers) => setWifiDirectPeers(peers));

    return () => {
      cancelled = true;
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
      wifiDirectRequestGroupInfo().then(finish).catch(() => {});
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
        await startP2PSend('local', groupInfo);
      } else {
        await startP2PReceive(generateRoomCode(), 'local', groupInfo);
      }
    } catch (err) {
      showToast('Could not connect over Wi-Fi Direct: ' + err.message, 'error');
    } finally {
      setWifiDirectConnecting(null);
    }
  };

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
        conn.send({ type: 'batch-start', totalFiles: sendQueueRef.current.length });
        sendNextQueuedFileForPeer(peerState);
      }, 150);
    });

    conn.on('data', (data) => {
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
  // without ever reaching PeerJS's cloud broker. Unlike establishLocalConnection
  // (one-shot: resolves once and stops the server), this keeps the server
  // running and wires up every receiver that connects while the room stays
  // open, same as the PeerJS 'connection' event does for the cloud path.
  const startLocalRoomHost = (code) => {
    const pcsByConnId = new Map();

    const offMessage = onLocalSignalingMessage(async (connId, msg) => {
      if (msg.type === 'offer') {
        const pc = createLocalPeerConnection();
        pcsByConnId.set(connId, pc);
        pc.onicecandidate = (e) => {
          if (e.candidate) localSignalingSend(connId, { type: 'ice', candidate: e.candidate.toJSON() });
        };
        try {
          const channelPromise = waitForRemoteChannel(pc);
          const answerSdp = await createAnswerFromOffer(pc, msg.sdp);
          localSignalingSend(connId, { type: 'answer', sdp: answerSdp });
          const channel = await waitForChannelOpen(await channelPromise);
          const conn = new PeerJsCompatDataConnection(channel, `lan-${connId}`);
          pcsByConnId.delete(connId);
          handleIncomingReceiverConnection(conn, code);
        } catch {
          pcsByConnId.delete(connId);
        }
      } else if (msg.type === 'ice') {
        const pc = pcsByConnId.get(connId);
        if (pc) await addRemoteIceCandidate(pc, msg.candidate);
      }
    });

    localSignalingStartServer().catch(() => {
      // No native LocalSignaling support (web/desktop) — receivers on this
      // list transparently fall back to the cloud path below.
    });

    return () => {
      offMessage();
      localSignalingStopServer();
      pcsByConnId.forEach((pc) => { try { pc.close(); } catch { /* already closed */ } });
    };
  };

  // transportMode: 'cloud' (default, PeerJS broker — works cross-network as
  // long as both sides can reach the internet) or 'local' (Wi-Fi Direct, zero
  // internet/router needed — see establishLocalConnection above). groupInfo
  // is required for 'local' and comes from a completed WifiDirect connection.
  const startP2PSend = (transportMode = 'cloud', groupInfo = null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    cleanup();
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
      // an object shaped like one so it can tear down Wi-Fi Direct the same
      // way it destroys a real Peer.
      peerRef.current = { destroy: () => { wifiDirectRemoveGroup(); } };

      // Stays on the home screen (no setMode/setTransferState here) until the
      // handshake actually completes — the Wi-Fi Direct group forming just
      // means both devices tapped connect, not that the other side is ready
      // to receive; jumping to a "connecting" screen before that point is
      // what looked like it skipped waiting for the other person entirely.
      return establishLocalConnection({
        isGroupOwner: groupInfo.isGroupOwner,
        groupOwnerAddress: groupInfo.groupOwnerAddress,
        roomCode: code,
        deviceName: getDeviceLabel()
      })
        .then(({ conn, roomCode: agreedCode }) => {
          setRoomCode(agreedCode);
          setMode('p2p-send');
          setTransferState('waiting');
          showToast('Offline Wi-Fi Direct link ready!', 'success');
          handleIncomingReceiverConnection(conn, agreedCode);
        })
        .catch((err) => {
          showToast('Offline connection failed: ' + err.message, 'error');
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

      peer.on('open', () => {
        setTransferState('waiting');
        showToast('Direct P2P Room Ready!', 'success');
      });

      peer.on('connection', (conn) => handleIncomingReceiverConnection(conn, code));

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
          : ''
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
        type: data.mime,
        relPath: data.relPath || '',
        isText: data.mime === TEXT_SNIPPET_MIME
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
    } else if (data.type === 'control') {
      setIsPeerPaused(data.action === 'pause');
    } else if (data.type === 'room-full') {
      setTransferState('error');
      setErrorMsg('This room already has the maximum number of receivers.');
    } else if (data.type === 'chunk') {
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
          writeChainRef.current = writeChainRef.current.then(async () => {
            try {
              await NotifyDownload.finishReceive({ fileId, fileName, mimeType, relPath });
              receivedFilesRef.current = [...receivedFilesRef.current, { name: fileName, size: fileSize, relPath, isText }];
              setCompletedFiles(receivedFilesRef.current);
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
        }
      }
    } else if (data.type === 'batch-complete') {
      setTransferState('complete');
      import('canvas-confetti').then(({ default: confetti }) => confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      }));
      showToast('Transfer completed!', 'success');
      addHistoryEntry({
        direction: 'received',
        kind: receivedFilesRef.current.some((f) => f.isText) ? 'text' : 'file',
        files: receivedFilesRef.current.map((f) => ({ name: f.name, size: f.size })),
        peerLabel: targetPeerId,
        roomCode: targetPeerId,
        status: 'complete'
      });
      setHistoryVersion((v) => v + 1);
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
    setTimeout(() => connectToSender(code, true, mode, groupInfo), reconnectAttemptRef.current * 1000);
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
    receiverTransportRef.current = { mode: transportMode, groupInfo };

    if (transportMode === 'local') {
      peerRef.current = { destroy: () => { wifiDirectRemoveGroup(); } };
      if (!isResume) showToast('Connecting over Wi-Fi Direct...', 'info');

      return establishLocalConnection({
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
      // the user wait out the full 30s establishLocalConnection budget.
      establishLocalConnection({
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

    peer.on('open', () => {
      if (!isResume) showToast('Connecting to room ' + code + '...', 'info');

      computeSecurityCode(code, peer.id).then(setMySecurityCode);

      const conn = peer.connect(code, { reliable: true });
      wireReceiverConnection(conn, code, isResume);
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

      {/* TOAST POPUP */}
      {toast && (
        <div className="fixed bottom-[max(2rem,calc(env(safe-area-inset-bottom)+1.5rem))] right-8 max-[640px]:left-4 max-[640px]:right-4 bg-[rgba(15,23,42,0.9)] backdrop-blur-md border border-accent-purple rounded-[14px] px-6 py-4 flex items-center gap-3 text-text-primary shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_15px_rgba(125,211,255,0.2)] z-[9999] animate-[slideIn_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          {toast.type === 'success' && <ShieldCheck size={20} className="text-accent-green" />}
          {toast.type === 'error' && <AlertCircle size={20} className="text-accent-pink" />}
          {toast.type === 'info' && <Info size={20} className="text-accent-cyan" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MAIN LAYOUT CONTAINER */}
      <main className="flex-1 min-h-0 flex flex-col items-center justify-start py-2">
        <div className={`w-full ${Capacitor.isNativePlatform() ? 'max-w-[490px]' : 'max-w-[490px] md:max-w-[640px] lg:max-w-[760px]'} flex-1 flex flex-col justify-start p-6 max-[640px]:px-4 max-[640px]:py-5 max-[640px]:rounded-2xl max-[640px]:m-0 max-[380px]:px-3 max-[380px]:py-4 md:p-8 lg:p-10 bg-[rgba(15,23,42,0.45)] backdrop-blur-2xl border border-white/[0.08] rounded-[20px] shadow-[0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.07),0_0_40px_rgba(125,211,255,0.04)] transition-[border-color,box-shadow,max-width] duration-300 hover:border-[rgba(125,211,255,0.25)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.12),0_0_50px_rgba(125,211,255,0.08)]`}>

          {/* ==================================================== */}
          {/* VIEW: HOME VIEW                                      */}
          {/* ==================================================== */}
          {mode === 'home' && (
            <div className="flex-1 flex flex-col w-full">
              <div className="text-center mb-6 max-[640px]:mb-4 flex-shrink-0">
                <h2 className="text-[1.85rem] max-[640px]:text-2xl max-[380px]:text-[1.3rem] leading-[1.2] mb-2 font-bold glow-text">Secure P2P File Sharing</h2>
                <p className="text-text-secondary text-[0.925rem] max-[380px]:text-[0.85rem]">Transfer files directly browser-to-browser. Encrypted, private, with zero size limits.</p>
              </div>

              {/* TOP TAB SWITCHER: Home / Apps (hidden once a file is queued) */}
              {selectedFiles.length === 0 && (
                <div className="flex flex-shrink-0 gap-[0.4rem] bg-[rgba(8,12,20,0.5)] border border-border rounded-xl p-[0.3rem] mb-6 max-[640px]:mb-4">
                  <button
                    type="button"
                    className={`flex-1 border-0 font-heading text-[0.85rem] font-semibold py-[0.55rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 ${homeTab === 'home' ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_10px_rgba(125,211,255,0.3)]' : 'bg-transparent text-text-muted hover:text-text-primary'}`}
                    onClick={() => setHomeTab('home')}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={`flex-1 border-0 font-heading text-[0.85rem] font-semibold py-[0.55rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 ${homeTab === 'apps' ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_10px_rgba(125,211,255,0.3)]' : 'bg-transparent text-text-muted hover:text-text-primary'}`}
                    onClick={() => setHomeTab('apps')}
                  >
                    Apps
                  </button>
                  <button
                    type="button"
                    className={`flex-1 border-0 font-heading text-[0.85rem] font-semibold py-[0.55rem] px-3 rounded-[9px] cursor-pointer transition-all duration-200 flex items-center justify-center gap-1 ${homeTab === 'history' ? 'bg-accent-purple text-[#06222c] shadow-[0_2px_10px_rgba(125,211,255,0.3)]' : 'bg-transparent text-text-muted hover:text-text-primary'}`}
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
                  className={`group flex-shrink-0 border-2 border-dashed rounded-[18px] px-6 py-10 max-[640px]:py-6 max-[640px]:px-4 max-[380px]:py-6 max-[380px]:px-3 text-center cursor-pointer bg-[rgba(15,23,42,0.25)] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] relative overflow-hidden ${dragActive ? 'border-accent-cyan bg-[rgba(125,211,255,0.04)] shadow-[0_0_25px_rgba(125,211,255,0.12)]' : 'border-[rgba(125,211,255,0.25)] hover:border-accent-cyan hover:bg-[rgba(125,211,255,0.04)] hover:shadow-[0_0_25px_rgba(125,211,255,0.12)]'}`}
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
                    <div className={`w-14 h-14 rounded-[14px] flex items-center justify-center transition-all duration-300 ${dragActive ? 'bg-[rgba(125,211,255,0.15)] text-accent-cyan -translate-y-1' : 'bg-[rgba(125,211,255,0.08)] text-accent-purple group-hover:bg-[rgba(125,211,255,0.15)] group-hover:text-accent-cyan group-hover:-translate-y-1'}`}>
                      <UploadCloud size={32} />
                    </div>
                    <div>
                      <h3 className="text-[1.15rem] max-[380px]:text-base font-medium text-text-primary">Drag & drop your files here</h3>
                      <p className="text-[0.85rem] text-text-muted">or click to browse files from your device</p>
                    </div>
                    <span className="bg-bg-tertiary border border-[rgba(125,211,255,0.3)] text-accent-purple px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase max-[640px]:px-2 max-[640px]:py-[0.15rem] max-[640px]:text-[0.65rem]">
                      No File Size Limits
                    </span>
                  </div>
                </div>
              ) : null}

              {selectedFiles.length === 0 && (
                <div className="flex items-center justify-center gap-4 mt-3 flex-shrink-0">
                  <button
                    type="button"
                    className="relative overflow-hidden flex items-center gap-1.5 bg-[rgba(30,41,59,0.4)] border border-border text-text-secondary text-[0.8rem] cursor-pointer py-[0.4rem] px-3 rounded-full transition-all duration-200 hover:bg-[rgba(125,211,255,0.1)] hover:border-[rgba(125,211,255,0.3)] hover:text-accent-cyan"
                    onClick={(e) => rippleTap(e, triggerFolderInput)}
                  >
                    <FolderUp size={14} /> Send a folder
                  </button>
                  <button
                    type="button"
                    className="relative overflow-hidden flex items-center gap-1.5 bg-[rgba(30,41,59,0.4)] border border-border text-text-secondary text-[0.8rem] cursor-pointer py-[0.4rem] px-3 rounded-full transition-all duration-200 hover:bg-[rgba(125,211,255,0.1)] hover:border-[rgba(125,211,255,0.3)] hover:text-accent-cyan"
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
                      {renderFileIconComponent(selectedFiles[0].name)}
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

              {/* NEARBY DEVICES (feature #2): same-Wi-Fi senders discovered via NSD — tap to connect with no code entry */}
              {selectedFiles.length === 0 && nearbyPeers.length > 0 && (
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

                  {wifiDirectBrowsing && wifiDirectPeers.length === 0 && (
                    <div className="text-[0.78rem] text-text-muted py-1">Searching nearby devices…</div>
                  )}

                  {wifiDirectPeers.length > 0 && (
                    <div className="flex flex-col gap-2 max-h-[16vh] overflow-y-auto pr-[0.2rem]">
                      {wifiDirectPeers.map((peer) => (
                        <button
                          key={peer.deviceAddress}
                          type="button"
                          disabled={wifiDirectConnecting === peer.deviceAddress}
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
                </div>
              )}

              {/* RECEIVE AREA (ONLY SHOW IF NO FILE CURRENTLY BEING SENT) */}
              {selectedFiles.length === 0 && (
                <div>
                  <div className="flex items-center text-center my-3 text-text-muted text-[0.8rem] before:content-[''] before:flex-1 before:border-b before:border-border before:mr-3 after:content-[''] after:flex-1 after:border-b after:border-border after:ml-3">or receive a file</div>
                  <div className="flex flex-col gap-3">
                    <div className="relative flex items-center gap-[0.4rem] flex-shrink-0">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex items-center">
                        <Download size={20} />
                      </div>
                      <input
                        type="text"
                        placeholder="Enter Room Code (e.g. 4D8G2X)"
                        className="w-auto flex-1 bg-[rgba(8,12,20,0.5)] border border-border rounded-xl py-[0.8rem] pr-4 pl-10 font-heading text-[0.95rem] text-text-primary outline-none transition-all duration-300 focus:border-accent-purple focus:shadow-[0_0_10px_rgba(125,211,255,0.12)]"
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
                      className={`${targetPeerId.trim() ? `${BTN_PRIMARY} shadow-[0_2px_14px_rgba(125,211,255,0.35)]` : BTN_SECONDARY} justify-center`}
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
                          className="w-full h-full object-cover"
                          style={{ visibility: cameraReady ? 'visible' : 'hidden' }}
                          playsInline
                          muted
                        />
                        {cameraReady && <div className="absolute inset-[12%] border-2 border-accent-purple rounded-xl shadow-[0_0_20px_rgba(125,211,255,0.4)] pointer-events-none" />}
                      </div>
                    )}
                    <canvas ref={scanCanvasRef} style={{ display: 'none' }} />
                  </div>
                </div>
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

              </>
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
                          value={roomCode}
                          size={92}
                          bgColor={"#ffffff"}
                          fgColor={"#0b0e1c"}
                          level={"H"}
                          includeMargin={false}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1 text-center max-w-[240px]">
                        <b className="text-text-primary text-[0.8rem]">Scan to connect</b>
                        <p className="text-[0.72rem] text-text-secondary leading-[1.5]">
                          Keep this tab open &mdash; the file streams directly, peer to peer. Tap the QR code to enlarge.
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
                        Capacitor.isNativePlatform() ? (
                          <div
                            key={i}
                            className="bg-gradient-to-br from-accent-green to-[#059669] text-[#080c14] border-0 font-heading font-bold text-[0.85rem] py-[1.2rem] px-8 rounded-2xl flex items-center justify-center gap-3 shadow-[0_4px_20px_rgba(52,211,153,0.4)] w-full mt-4"
                          >
                            <Download size={16} /> {f.relPath ? `${f.relPath}/${f.name}` : f.name}
                          </div>
                        ) : (
                          <a
                            key={i}
                            href={f.url}
                            download={f.name}
                            className="bg-gradient-to-br from-accent-green to-[#059669] text-[#080c14] border-0 font-heading font-bold text-[0.85rem] py-[1.2rem] px-8 rounded-2xl cursor-pointer flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_4px_20px_rgba(52,211,153,0.4)] no-underline w-full mt-4 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(52,211,153,0.6)] hover:from-[#34d399] hover:to-[#047857]"
                          >
                            <Download size={16} /> {f.name}
                          </a>
                        )
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
                value={roomCode}
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
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default App;
