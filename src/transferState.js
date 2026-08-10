// Checkpoint for the single in-flight transfer, so a killed app process can
// offer to resume on next launch instead of silently losing progress (unlike
// the in-memory refs in App.jsx, which only survive a live WebRTC reconnect).
// Same localStorage JSON-blob pattern as history.js — deliberately holds only
// enough to re-establish the connection and re-send a 'resume' message, never
// file bytes.
const STORAGE_KEY = 'novashare_transfer_checkpoint';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function write(checkpoint) {
  try {
    if (checkpoint) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage full/unavailable — resume just won't be offered this run.
  }
}

// checkpoint: { transferId, direction: 'receive', fileIndex, offset,
//   incomingFileId, fileList: [{name,size,mime,relPath}], roomCode,
//   transportMode, groupInfo, updatedAt }
export function saveCheckpoint(checkpoint) {
  write({ ...checkpoint, updatedAt: Date.now() });
}

// Returns the checkpoint if present and not stale, else null (and clears a
// stale one so callers don't need to separately check age).
export function getCheckpoint() {
  const checkpoint = read();
  if (!checkpoint) return null;
  if (Date.now() - (checkpoint.updatedAt || 0) > MAX_AGE_MS) {
    write(null);
    return null;
  }
  return checkpoint;
}

export function clearCheckpoint() {
  write(null);
}
