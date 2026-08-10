import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOnline,
  subscribeConnectivity,
  resetConnectivityCache,
  CACHE_TTL_MS,
  DEFAULT_PROBE_URL
} from './connectivity';

// navigator.onLine is a getter in jsdom — redefine it per test.
const setNavigatorOnLine = (value) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
};

describe('isOnline', () => {
  beforeEach(() => {
    resetConnectivityCache();
    setNavigatorOnLine(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setNavigatorOnLine(true);
  });

  it('reports offline without probing when navigator.onLine is false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setNavigatorOnLine(false);

    expect(await isOnline()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes the broker and reports online when the request completes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);

    expect(await isOnline()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_PROBE_URL, expect.objectContaining({ method: 'HEAD' }));
  });

  // The case navigator.onLine gets wrong: joined to a hotspot / Wi-Fi Direct
  // group, so an interface is up but nothing routes to the broker.
  it('reports offline when an interface is up but the broker is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    setNavigatorOnLine(true);

    expect(await isOnline()).toBe(false);
  });

  it('reports offline when the probe times out', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));

    expect(await isOnline({ timeoutMs: 5 })).toBe(false);
  });

  it('caches a result within the TTL instead of re-probing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    let clock = 1000;
    const now = () => clock;

    expect(await isOnline({ now })).toBe(true);
    clock += CACHE_TTL_MS - 1;
    expect(await isOnline({ now })).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-probes once the TTL has elapsed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    let clock = 1000;
    const now = () => clock;

    await isOnline({ now });
    clock += CACHE_TTL_MS + 1;
    await isOnline({ now });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-probes when force is set, even inside the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    const now = () => 1000;

    await isOnline({ now });
    await isOnline({ now, force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports offline rather than throwing when fetch is unavailable', async () => {
    vi.stubGlobal('fetch', undefined);
    expect(await isOnline()).toBe(false);
  });
});

describe('subscribeConnectivity', () => {
  beforeEach(() => {
    resetConnectivityCache();
    setNavigatorOnLine(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies on both online and offline events', () => {
    const callback = vi.fn();
    const off = subscribeConnectivity(callback);

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));

    expect(callback).toHaveBeenCalledTimes(2);
    off();
  });

  it('stops notifying after unsubscribe', () => {
    const callback = vi.fn();
    const off = subscribeConnectivity(callback);
    off();

    window.dispatchEvent(new Event('online'));

    expect(callback).not.toHaveBeenCalled();
  });

  // The OS event means "an interface changed", not "the internet is now
  // reachable" — so the stale verdict must be dropped and re-probed.
  it('clears the cached verdict so the next isOnline() re-probes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    const now = () => 1000;

    await isOnline({ now });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const off = subscribeConnectivity(() => {});
    window.dispatchEvent(new Event('online'));

    await isOnline({ now });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    off();
  });
});
