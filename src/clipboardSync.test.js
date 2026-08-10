import { describe, it, expect, beforeEach } from 'vitest';
import { addClip, getClips, clearClips } from './clipboardSync';

beforeEach(() => {
  localStorage.clear();
});

describe('clipboardSync', () => {
  it('starts empty', () => {
    expect(getClips()).toEqual([]);
  });

  it('records a clip with a generated id and timestamp', () => {
    const record = addClip({ text: 'hello', direction: 'sent', peerLabel: 'ABC123' });
    expect(record.text).toBe('hello');
    expect(record.direction).toBe('sent');
    expect(record.id).toBeTruthy();
    expect(typeof record.timestamp).toBe('number');
  });

  it('newest clip appears first', () => {
    addClip({ text: 'first', direction: 'sent', peerLabel: 'ABC123' });
    addClip({ text: 'second', direction: 'received', peerLabel: 'ABC123' });
    const clips = getClips();
    expect(clips[0].text).toBe('second');
    expect(clips[1].text).toBe('first');
  });

  it('clearClips empties the log', () => {
    addClip({ text: 'hello', direction: 'sent', peerLabel: 'ABC123' });
    clearClips();
    expect(getClips()).toEqual([]);
  });
});
