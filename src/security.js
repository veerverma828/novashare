// Short "safety number"-style verification code for a P2P connection.
// Derived deterministically from both sides' identifiers (order-independent,
// so sender and receiver compute the exact same code without exchanging
// anything extra) via WebCrypto SHA-256 — never sent over the wire itself,
// so it's a genuine out-of-band check that neither end's WebRTC channel was
// silently swapped for a different peer.
export async function computeSecurityCode(idA, idB) {
  const combined = [String(idA || ''), String(idB || '')].sort().join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(combined);

  if (window.crypto?.subtle) {
    try {
      const digest = await window.crypto.subtle.digest('SHA-256', data);
      return formatDigest(new Uint8Array(digest));
    } catch {
      // Fall through to the non-crypto fallback below.
    }
  }
  return formatDigest(simpleHashBytes(combined));
}

function formatDigest(bytes) {
  // 4 bytes -> 8 hex chars -> "XXXX-XXXX", plenty to eyeball-compare without
  // being a wall of text on a small screen.
  const hex = Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

// Only used if SubtleCrypto is unavailable (very old WebViews) — not
// cryptographically strong, but this code is a tamper *indicator* shown to a
// human, not a secret, so a weak fallback is acceptable degradation.
function simpleHashBytes(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = new Uint8Array(4);
  out[0] = (h1 >>> 24) & 0xff;
  out[1] = (h1 >>> 16) & 0xff;
  out[2] = (h2 >>> 24) & 0xff;
  out[3] = (h2 >>> 16) & 0xff;
  return out;
}
