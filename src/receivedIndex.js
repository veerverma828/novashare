// Records the SHA-256 + size of every file this device has successfully
// received, so a re-send of identical content (a whole file, or one file
// inside a re-sent folder) can be skipped instead of re-transferred — see
// the 'skip-duplicate' wire message in App.jsx. Same localStorage JSON-blob
// pattern as history.js/transferState.js; metadata only, matching those.
const STORAGE_KEY = 'novashare_received_index';
const MAX_ENTRIES = 500;

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
    // Storage full/unavailable — duplicate-skip just won't kick in this run.
  }
}

// A hash alone isn't quite enough to trust a match (belt-and-suspenders
// against an unlikely hash collision) — require the size to match too.
export function hasReceived(hash, size) {
  if (!hash) return false;
  return readAll().some((e) => e.hash === hash && e.size === size);
}

export function recordReceived({ hash, size, name }) {
  if (!hash) return;
  const entries = readAll();
  if (entries.some((e) => e.hash === hash && e.size === size)) return;
  entries.unshift({ hash, size, name, receivedAt: Date.now() });
  writeAll(entries);
}

export function clearReceivedIndex() {
  writeAll([]);
}
