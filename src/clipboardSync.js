// Log of text snippets exchanged over the "quick clipboard" channel — the
// 'clip' wire message reuses whatever DataConnection is still open after a
// transfer completes (see App.jsx's Complete-state UI) instead of a one-shot
// send. Session-scoped by design (App.jsx only shows the panel while the
// connection is still live): this store just keeps a short local history of
// what went across, same localStorage JSON-blob pattern as history.js.
const STORAGE_KEY = 'novashare_clipboard_log';
const MAX_ENTRIES = 100;

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
    // Storage full/unavailable — the log just won't persist this run.
  }
}

// entry: { text, direction: 'sent'|'received', peerLabel }
export function addClip(entry) {
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

export function getClips() {
  return readAll();
}

export function clearClips() {
  writeAll([]);
}
