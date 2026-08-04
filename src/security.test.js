import { describe, it, expect } from 'vitest';
import { computeSecurityCode } from './security';

describe('computeSecurityCode', () => {
  it('produces an XXXX-XXXX formatted code', async () => {
    const code = await computeSecurityCode('room-1', 'device-a');
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('is order-independent, so sender and receiver converge without exchanging anything', async () => {
    const a = await computeSecurityCode('room-1', 'device-a');
    const b = await computeSecurityCode('device-a', 'room-1');
    expect(a).toBe(b);
  });

  it('is deterministic for the same inputs', async () => {
    const a = await computeSecurityCode('room-42', 'peer-9');
    const b = await computeSecurityCode('room-42', 'peer-9');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    const a = await computeSecurityCode('room-1', 'device-a');
    const b = await computeSecurityCode('room-2', 'device-a');
    expect(a).not.toBe(b);
  });

  it('handles missing/undefined ids without throwing', async () => {
    const code = await computeSecurityCode(undefined, null);
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('falls back to the non-crypto hash when SubtleCrypto is unavailable', async () => {
    const original = window.crypto.subtle;
    // Simulate old WebViews that lack SubtleCrypto entirely.
    Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });

    const code = await computeSecurityCode('room-1', 'device-a');
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

    Object.defineProperty(window.crypto, 'subtle', { value: original, configurable: true });
  });
});
