import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  RATE_PRESETS,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  computeFileHash,
  mapWithConcurrency,
  formatBytes,
  formatSpeed,
  formatTime,
  getFileType,
  generateRoomCode,
  extractRoomCode,
  extractHotspotCredentials
} from './transferUtils';

describe('RATE_PRESETS', () => {
  it('includes an unlimited (0 kbps) option', () => {
    expect(RATE_PRESETS.some((p) => p.kbps === 0)).toBe(true);
  });

  it('is sorted ascending by kbps, unlimited first', () => {
    const kbps = RATE_PRESETS.map((p) => p.kbps);
    expect(kbps[0]).toBe(0);
    const rest = kbps.slice(1);
    expect([...rest].sort((a, b) => a - b)).toEqual(rest);
  });
});

describe('arrayBufferToBase64', () => {
  it('round-trips through atob to the original bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const b64 = arrayBufferToBase64(bytes.buffer);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('handles an empty buffer', () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('');
  });

  it('handles buffers larger than the internal 32KB chunking window', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 137).map((_, i) => i % 256);
    const b64 = arrayBufferToBase64(bytes.buffer);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});

describe('base64ToArrayBuffer', () => {
  it('round-trips arrayBufferToBase64 output back to the original bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const roundTripped = new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes.buffer)));
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });

  it('handles an empty string', () => {
    expect(base64ToArrayBuffer('').byteLength).toBe(0);
  });
});

describe('computeFileHash', () => {
  it('produces the known SHA-256 hex digest for a given file', async () => {
    // SHA-256("hello world") — verified against a reference implementation.
    const file = new File(['hello world'], 'greeting.txt', { type: 'text/plain' });
    const hash = await computeFileHash(file);
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('produces different hashes for different content', async () => {
    const a = await computeFileHash(new File(['content-a'], 'a.txt'));
    const b = await computeFileHash(new File(['content-b'], 'b.txt'));
    expect(a).not.toBe(b);
  });

  it('produces the same hash for the same content regardless of file name', async () => {
    const a = await computeFileHash(new File(['same bytes'], 'a.txt'));
    const b = await computeFileHash(new File(['same bytes'], 'b.txt'));
    expect(a).toBe(b);
  });

  it('returns null when SubtleCrypto is unavailable', async () => {
    // window.crypto.subtle is a getter-only property (jsdom), so stub the
    // getter itself rather than assigning over it.
    const spy = vi.spyOn(window.crypto, 'subtle', 'get').mockReturnValue(undefined);
    try {
      const hash = await computeFileHash(new File(['x'], 'x.txt'));
      expect(hash).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const delays = [30, 10, 20, 0];
    const results = await mapWithConcurrency(delays, 4, (ms, i) => new Promise((resolve) => {
      setTimeout(() => resolve(i), ms);
    }));
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than `limit` workers concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('caps concurrency at the item count when limit exceeds it', async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (x) => x + 1);
    expect(results).toEqual([2, 3]);
  });

  it('handles an empty item list', async () => {
    const results = await mapWithConcurrency([], 3, async (x) => x);
    expect(results).toEqual([]);
  });

  it('propagates a worker rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      })
    ).rejects.toThrow('boom');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 Bytes'],
    [500, '500 Bytes'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1 MB'],
    [1024 * 1024 * 1024, '1 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatSpeed', () => {
  it('formats 0 as "0 B/s"', () => {
    expect(formatSpeed(0)).toBe('0 B/s');
  });

  it('formats sub-KB speeds in B/s', () => {
    expect(formatSpeed(500)).toBe('500 B/s');
  });

  it('formats KB/s and MB/s ranges', () => {
    expect(formatSpeed(2048)).toBe('2 KB/s');
    expect(formatSpeed(1024 * 1024 * 3)).toBe('3 MB/s');
  });
});

describe('formatTime', () => {
  it('shows "--" for NaN or Infinity', () => {
    expect(formatTime(NaN)).toBe('--');
    expect(formatTime(Infinity)).toBe('--');
  });

  it('shows whole seconds under a minute', () => {
    expect(formatTime(45)).toBe('45s');
    expect(formatTime(0)).toBe('0s');
  });

  it('shows minutes and seconds at/above a minute', () => {
    expect(formatTime(90)).toBe('1m 30s');
    expect(formatTime(60)).toBe('1m 0s');
    expect(formatTime(3661)).toBe('61m 1s');
  });
});

describe('getFileType', () => {
  it('returns "file" for missing/empty names', () => {
    expect(getFileType('')).toBe('file');
    expect(getFileType(undefined)).toBe('file');
  });

  it.each([
    ['photo.PNG', 'image'],
    ['clip.mp4', 'video'],
    ['song.mp3', 'audio'],
    ['doc.pdf', 'pdf'],
    ['bundle.zip', 'archive'],
    ['notes.md', 'code'],
    ['data.bin', 'file'],
  ])('categorizes %s as %s', (name, expected) => {
    expect(getFileType(name)).toBe(expected);
  });

  it('is case-insensitive on extension', () => {
    expect(getFileType('IMAGE.JPG')).toBe('image');
  });

  it('uses the last extension for multi-dot filenames', () => {
    expect(getFileType('archive.tar.gz')).toBe('archive');
  });
});

describe('generateRoomCode', () => {
  it('produces a 6-character uppercase alphanumeric code', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^[0-9A-Z]{6}$/);
  });

  it('produces different codes across calls (statistically)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('extractRoomCode', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uppercases and trims a bare code', () => {
    expect(extractRoomCode('  abc123  ')).toBe('ABC123');
  });

  it('pulls the room param out of a share URL', () => {
    expect(extractRoomCode('https://novashare.app/?room=xyz789')).toBe('XYZ789');
  });

  it('falls back to the trimmed/uppercased text when the URL has no room param', () => {
    expect(extractRoomCode('https://novashare.app/')).toBe('HTTPS://NOVASHARE.APP/');
  });
});

describe('extractHotspotCredentials', () => {
  it('extracts ssid/pass from a hotspot-fallback QR URL', () => {
    const url = 'https://novashare.app/?room=ABC123&ssid=NovaShare-1234&pass=s3cr3tpass';
    expect(extractHotspotCredentials(url)).toEqual({ ssid: 'NovaShare-1234', passphrase: 's3cr3tpass' });
  });

  it('returns null for a plain room-code URL with no ssid/pass', () => {
    expect(extractHotspotCredentials('https://novashare.app/?room=ABC123')).toBeNull();
  });

  it('returns null for a bare room code (not a URL)', () => {
    expect(extractHotspotCredentials('ABC123')).toBeNull();
  });

  it('decodes URL-encoded special characters in the passphrase', () => {
    const url = 'https://novashare.app/?room=ABC123&ssid=NovaShare&pass=' + encodeURIComponent('a&b c');
    expect(extractHotspotCredentials(url)).toEqual({ ssid: 'NovaShare', passphrase: 'a&b c' });
  });
});
