import { describe, it, expect, beforeEach } from 'vitest';
import { hasReceived, recordReceived, clearReceivedIndex } from './receivedIndex';

beforeEach(() => {
  localStorage.clear();
});

describe('receivedIndex', () => {
  it('reports no match before anything has been recorded', () => {
    expect(hasReceived('some-hash', 100)).toBe(false);
  });

  it('reports a match after recording the same hash and size', () => {
    recordReceived({ hash: 'abc', size: 100, name: 'file.txt' });
    expect(hasReceived('abc', 100)).toBe(true);
  });

  it('requires both hash and size to match, not just the hash', () => {
    recordReceived({ hash: 'abc', size: 100, name: 'file.txt' });
    expect(hasReceived('abc', 200)).toBe(false);
  });

  it('treats a null/undefined hash as never a match', () => {
    recordReceived({ hash: 'abc', size: 100, name: 'file.txt' });
    expect(hasReceived(null, 100)).toBe(false);
    expect(hasReceived(undefined, 100)).toBe(false);
  });

  it('does not record a duplicate entry for the same hash+size twice', () => {
    recordReceived({ hash: 'abc', size: 100, name: 'first-name.txt' });
    recordReceived({ hash: 'abc', size: 100, name: 'second-name.txt' });
    // Still just a single match — no crash/duplication from recording twice.
    expect(hasReceived('abc', 100)).toBe(true);
  });

  it('clearReceivedIndex removes all recorded entries', () => {
    recordReceived({ hash: 'abc', size: 100, name: 'file.txt' });
    clearReceivedIndex();
    expect(hasReceived('abc', 100)).toBe(false);
  });
});
