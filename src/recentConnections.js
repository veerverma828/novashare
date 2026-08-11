// Storage-backed recent connections list for quick reconnects and fresh chats.
const RECENT_CONN_KEY = 'novashare_recent_connections';
const MAX_RECENT = 30;

export function getRecentConnections() {
  try {
    const raw = localStorage.getItem(RECENT_CONN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordConnection(conn) {
  if (!conn || !conn.roomCode) return null;
  try {
    const all = getRecentConnections();
    const existingIdx = all.findIndex(
      (c) => c.roomCode === conn.roomCode || (conn.deviceName && c.deviceName === conn.deviceName)
    );
    const record = {
      id: conn.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      deviceName: conn.deviceName || `Device ${conn.roomCode}`,
      roomCode: conn.roomCode,
      direction: conn.direction || 'connected',
      timestamp: Date.now()
    };
    if (existingIdx !== -1) {
      all.splice(existingIdx, 1);
    }
    all.unshift(record);
    localStorage.setItem(RECENT_CONN_KEY, JSON.stringify(all.slice(0, MAX_RECENT)));
    return record;
  } catch {
    return null;
  }
}

export function removeRecentConnection(id) {
  try {
    const all = getRecentConnections().filter((c) => c.id !== id);
    localStorage.setItem(RECENT_CONN_KEY, JSON.stringify(all));
  } catch {}
}

export function clearRecentConnections() {
  try {
    localStorage.setItem(RECENT_CONN_KEY, JSON.stringify([]));
  } catch {}
}
