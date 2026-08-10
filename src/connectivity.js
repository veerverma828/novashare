// Answers the one question the automatic transport picker runs on: can this
// device actually reach the internet right now?
//
// navigator.onLine cannot answer it. It reports whether *any* network
// interface is up, which is true in exactly the two cases this app cares
// about most — joined to a sender's LocalOnlyHotspot, or sitting in a Wi-Fi
// Direct group. Both have a live link and no route to the internet, and both
// would have navigator.onLine cheerfully return true while `new Peer()`
// hangs until it times out. So it's used here only as a fast *negative*:
// false means definitely offline and we can skip the network round trip;
// true means "maybe" and we go probe for real.
//
// The probe deliberately targets the signaling broker rather than a generic
// connectivity endpoint — reaching the broker is the actual precondition for
// the cloud transport, and a captive portal or a firewall that blocks it
// while passing other traffic should read as offline for our purposes.

export const DEFAULT_PROBE_URL = 'https://0.peerjs.com/';
export const PROBE_TIMEOUT_MS = 3000;

// Long enough that the sender's probe and a receiver's probe moments later
// don't both pay for a round trip, short enough that walking out of Wi-Fi
// range is noticed on the next transfer attempt rather than cached away.
export const CACHE_TTL_MS = 5000;

let cached = null; // { value: boolean, at: number }

export function resetConnectivityCache() {
  cached = null;
}

// mode:'no-cors' makes this a pure reachability check — the response is
// opaque and we never read it. All we need is the distinction between "the
// request completed" and "the network stack refused/timed out", which is
// exactly what the resolve/reject split gives us. HEAD keeps it to headers.
async function probe(url, timeoutMs) {
  if (typeof fetch !== 'function') return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller?.signal
    });
    return true;
  } catch {
    // Aborted, DNS failure, refused, captive portal blackhole — all of these
    // mean the cloud path isn't usable, which is the only distinction the
    // caller acts on.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Resolves true only if the broker is genuinely reachable. Never throws —
// an unusable probe is reported as offline, since falling back to a local
// transport is always safe and a wrong "online" answer strands the user on
// a broker connection that will never open.
export async function isOnline({
  probeUrl = DEFAULT_PROBE_URL,
  timeoutMs = PROBE_TIMEOUT_MS,
  now = Date.now,
  force = false
} = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // Definitive: no interface is up at all. Cache it like any other result
    // so a burst of callers doesn't re-check, and so the online/offline
    // listener below is what clears it.
    cached = { value: false, at: now() };
    return false;
  }

  if (!force && cached && now() - cached.at < CACHE_TTL_MS) return cached.value;

  const value = await probe(probeUrl, timeoutMs);
  cached = { value, at: now() };
  return value;
}

// Fires whenever the OS thinks connectivity changed. The callback receives no
// verdict — only the hint that the cached one is now stale — because the OS
// event says an interface came up, not that the internet is reachable through
// it (joining a hotspot fires 'online'). Callers re-probe via isOnline().
// Returns an unsubscribe function.
export function subscribeConnectivity(callback) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const handler = () => {
    resetConnectivityCache();
    callback();
  };
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
}
