const STORAGE_KEY = 'novashare_crash_log';
const MAX_ENTRIES = 20;

function readEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // storage full or unavailable — nothing more we can do here
  }
}

// Appends one crash/error entry to the on-device log (capped at MAX_ENTRIES,
// oldest dropped first). `source` identifies which handler caught it, e.g.
// 'ErrorBoundary', 'window.onerror', 'unhandledrejection'.
export function recordError(source, error) {
  const entries = readEntries();
  entries.push({
    time: new Date().toISOString(),
    source,
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
  writeEntries(entries);
}

export function getCrashLog() {
  return readEntries();
}

export function clearCrashLog() {
  writeEntries([]);
}

// Plain-text report meant for the native share sheet — a user forwards this
// to us (WhatsApp, email, etc.) when something breaks on their device.
export function formatCrashLogForShare() {
  const entries = readEntries();
  if (entries.length === 0) return 'NovaShare error report: no errors recorded.';
  const header = `NovaShare error report\nDevice: ${navigator.userAgent}\n`;
  const body = entries
    .map((e, i) => `#${i + 1} [${e.time}] (${e.source})\n${e.message}${e.stack ? `\n${e.stack}` : ''}`)
    .join('\n\n---\n\n');
  return `${header}\n${body}`;
}

// Catches crashes the ErrorBoundary can't: errors thrown outside React's
// render/commit cycle (event handlers, timers, async callbacks) and rejected
// promises nobody awaited.
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    recordError('window.onerror', event.error || new Error(event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    recordError('unhandledrejection', event.reason);
  });
}
