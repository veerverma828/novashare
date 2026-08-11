import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRecentConnections,
  recordConnection,
  removeRecentConnection,
  clearRecentConnections
} from './recentConnections';

describe('recentConnections', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(getRecentConnections()).toEqual([]);
  });

  it('records a connection and unshifts it to front', () => {
    const rec = recordConnection({ deviceName: 'Galaxy S23', roomCode: '9X2K7A' });
    expect(rec).toBeTruthy();
    expect(rec.deviceName).toBe('Galaxy S23');
    expect(rec.roomCode).toBe('9X2K7A');

    const all = getRecentConnections();
    expect(all).toHaveLength(1);
    expect(all[0].roomCode).toBe('9X2K7A');
  });

  it('deduplicates existing connection by roomCode or deviceName', () => {
    recordConnection({ deviceName: 'Pixel 7', roomCode: 'ROOM1' });
    recordConnection({ deviceName: 'Pixel 7', roomCode: 'ROOM2' });

    const all = getRecentConnections();
    expect(all).toHaveLength(1);
    expect(all[0].roomCode).toBe('ROOM2');
  });

  it('removes matching connection by id', () => {
    const a = recordConnection({ deviceName: 'Phone A', roomCode: 'AAA' });
    const b = recordConnection({ deviceName: 'Phone B', roomCode: 'BBB' });

    removeRecentConnection(a.id);
    const all = getRecentConnections();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(b.id);
  });

  it('clearRecentConnections empties the store', () => {
    recordConnection({ deviceName: 'Phone A', roomCode: 'AAA' });
    clearRecentConnections();
    expect(getRecentConnections()).toEqual([]);
  });
});
