// Pure helpers used by the P2P transfer pipeline in App.jsx. Split out so
// they're unit-testable without mounting the component tree.

// Sender-rate presets for the bandwidth throttle (feature #8). 0 = unlimited.
export const RATE_PRESETS = [
  { label: 'Unlimited', kbps: 0 },
  { label: '512 KB/s', kbps: 512 },
  { label: '1 MB/s', kbps: 1024 },
  { label: '5 MB/s', kbps: 5120 },
  { label: '10 MB/s', kbps: 10240 }
];

// One 64KB chunk at a time — cheap and GC'd immediately, unlike base64-ing
// an entire assembled file (see incomingFileIdRef / writeChainRef in App.jsx).
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Inverse of arrayBufferToBase64 — used on the receiving end of the raw
// local-socket transport (localSocketTransport.js), where a chunk frame
// crosses the Capacitor JS bridge as base64 and needs to become the
// ArrayBuffer the rest of the transfer pipeline (App.jsx, PeerJsCompatDataConnection)
// already expects.
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Full SHA-256 digest of a File/Blob, hex-encoded — used for end-to-end
// integrity verification (distinct from security.js's computeSecurityCode,
// which truncates to 4 bytes for a human-eyeballed peer-safety code, not
// file content). Falls back to null when SubtleCrypto is unavailable; callers
// treat a null hash as "skip verification" rather than failing the transfer.
export async function computeFileHash(file) {
  if (!window.crypto?.subtle) return null;
  // If the file is very large (>50MB), reading the whole file into an ArrayBuffer
  // can exhaust RAM or block the event loop on mobile WebViews, delaying transfer start.
  // We safely skip hash pre-computation for large files (receiver verifies what it can).
  if (file.size && file.size > 50 * 1024 * 1024) return null;
  try {
    const buffer = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

// Runs `worker` over `items` with at most `limit` in flight at once,
// preserving input order in the returned results array.
export async function mapWithConcurrency(items, limit, worker) {
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

export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return '--';
  if (seconds <= 0) return '0s';
  if (seconds < 60) return Math.round(seconds) + 's';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins + 'm ' + secs + 's';
}

// Dynamic file-icon-category selector.
export function getFileType(fileName) {
  if (!fileName) return 'file';
  const ext = fileName.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['txt', 'md', 'html', 'css', 'js', 'json', 'py', 'java', 'cpp'].includes(ext)) return 'code';
  return 'file';
}

export function generateRoomCode() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Accepts either a bare room code or a share URL containing ?room=CODE.
export function extractRoomCode(text) {
  try {
    const url = new URL(text);
    const room = url.searchParams.get('room');
    if (room) return room.toUpperCase();
  } catch {
    // Not a URL, fall through to treat as a bare code
  }
  return text.trim().toUpperCase();
}

// Hotspot-fallback QR codes carry ssid/pass alongside the room code (see
// buildQrPayload in App.jsx) — a plain cloud-room QR has neither, so this
// returns null for those and callers fall through to the normal cloud/local
// flow unchanged.
export function extractHotspotCredentials(text) {
  try {
    const url = new URL(text);
    const ssid = url.searchParams.get('ssid');
    const passphrase = url.searchParams.get('pass');
    if (ssid && passphrase) return { ssid, passphrase };
  } catch {
    // Not a URL — no hotspot credentials possible.
  }
  return null;
}
