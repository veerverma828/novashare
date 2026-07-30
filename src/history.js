// Lightweight localStorage-backed transfer history — survives app restarts
// (unlike everything else in App.jsx's refs) but intentionally holds only
// metadata, never file bytes/blobs. Sent-file re-send only works while the
// original File objects are still alive in memory (see reattachableFiles in
// App.jsx); after a restart those are gone and re-send degrades to "please
// reselect", which callers should handle explicitly.
const STORAGE_KEY = 'novashare_transfer_history';
const MAX_ENTRIES = 200;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage full/unavailable — history just won't persist this run.
  }
}

export function getHistory() {
  return readAll();
}

// entry: { direction: 'sent'|'received', kind: 'file'|'text'|'apk', files: [{name,size}],
//          peerLabel, roomCode, status: 'complete'|'failed'|'partial' }
export function addHistoryEntry(entry) {
  const record = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...entry
  };
  const entries = readAll();
  entries.unshift(record);
  writeAll(entries);
  return record;
}

export function clearHistory() {
  writeAll([]);
}

export function removeHistoryEntry(id) {
  writeAll(readAll().filter((e) => e.id !== id));
}
