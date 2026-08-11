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
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === 'object')
      .map((e) => {
        const filesList = Array.isArray(e.files) ? e.files : [];
        return {
          ...e,
          files: filesList.map((f, i) => ({
            ...f,
            name: f?.name || (e.kind === 'text' ? `Text snippet ${i + 1}` : `Shared item ${i + 1}`)
          }))
        };
      });
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
  const rawFiles = Array.isArray(entry.files) ? entry.files : [];
  const sanitizedFiles = rawFiles.map((f, i) => ({
    name: f?.name || (entry.kind === 'text' ? `Text snippet ${i + 1}` : `Shared item ${i + 1}`),
    size: f?.size || 0,
    verified: f?.verified,
    skipped: f?.skipped
  }));

  const record = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    direction: entry.direction || 'sent',
    kind: entry.kind || 'file',
    files: sanitizedFiles,
    peerLabel: entry.peerLabel || '',
    roomCode: entry.roomCode || '',
    status: entry.status || 'complete'
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
