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
