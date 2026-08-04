import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getHistory, addHistoryEntry, clearHistory, removeHistoryEntry } from './history';

describe('history', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(getHistory()).toEqual([]);
  });

  it('adds an entry to the front, filling in id and timestamp', () => {
    const record = addHistoryEntry({ direction: 'sent', kind: 'file', files: [{ name: 'a.txt', size: 10 }], status: 'complete' });
    expect(record.id).toBeTruthy();
    expect(record.timestamp).toBeTypeOf('number');

    const all = getHistory();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ direction: 'sent', kind: 'file', status: 'complete' });
  });

  it('newest entries come first', () => {
    addHistoryEntry({ direction: 'sent', kind: 'file', files: [], status: 'complete' });
    addHistoryEntry({ direction: 'received', kind: 'text', files: [], status: 'complete' });

    const all = getHistory();
    expect(all).toHaveLength(2);
    expect(all[0].direction).toBe('received');
    expect(all[1].direction).toBe('sent');
  });

  it('caps stored history at 200 entries', () => {
    for (let i = 0; i < 205; i++) {
      addHistoryEntry({ direction: 'sent', kind: 'file', files: [], status: 'complete' });
    }
    expect(getHistory()).toHaveLength(200);
  });

  it('clearHistory empties the store', () => {
    addHistoryEntry({ direction: 'sent', kind: 'file', files: [], status: 'complete' });
    clearHistory();
    expect(getHistory()).toEqual([]);
  });

  it('removeHistoryEntry removes only the matching id', () => {
    const a = addHistoryEntry({ direction: 'sent', kind: 'file', files: [], status: 'complete' });
    const b = addHistoryEntry({ direction: 'received', kind: 'text', files: [], status: 'complete' });

    removeHistoryEntry(a.id);

    const all = getHistory();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(b.id);
  });

  it('tolerates corrupted localStorage instead of throwing', () => {
    localStorage.setItem('novashare_transfer_history', '{not valid json');
    expect(getHistory()).toEqual([]);
  });

  it('tolerates a non-array value under the storage key', () => {
    localStorage.setItem('novashare_transfer_history', JSON.stringify({ oops: true }));
    expect(getHistory()).toEqual([]);
  });

  it('swallows storage write failures (e.g. quota exceeded) without throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => addHistoryEntry({ direction: 'sent', kind: 'file', files: [], status: 'complete' })).not.toThrow();
    spy.mockRestore();
  });
});
