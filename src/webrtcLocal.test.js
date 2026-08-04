import { describe, it, expect, vi } from 'vitest';
import { PeerJsCompatDataConnection } from './webrtcLocal';

// Minimal fake RTCDataChannel: just enough surface for
// PeerJsCompatDataConnection to attach handlers and record sends.
function makeFakeChannel(readyState = 'open') {
  return {
    readyState,
    binaryType: null,
    sent: [],
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send(data) { this.sent.push(data); },
    close() { this.readyState = 'closed'; this.onclose?.(); }
  };
}

describe('PeerJsCompatDataConnection', () => {
  it('replays "open" to a late subscriber if the channel was already open', () => {
    const channel = makeFakeChannel('open');
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const cb = vi.fn();
    conn.on('open', cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires "open" handlers when the channel opens later', () => {
    const channel = makeFakeChannel('connecting');
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const cb = vi.fn();
    conn.on('open', cb);
    expect(cb).not.toHaveBeenCalled();

    channel.onopen();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('sends plain objects as JSON', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    conn.send({ type: 'meta', name: 'a.txt' });
    expect(channel.sent).toEqual([JSON.stringify({ type: 'meta', name: 'a.txt' })]);
  });

  it('splits a chunk message into a JSON header followed by the raw binary payload', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const buf = new ArrayBuffer(4);
    conn.send({ type: 'chunk', fileId: 'f1', index: 0, chunk: buf });

    expect(channel.sent).toHaveLength(2);
    const header = JSON.parse(channel.sent[0]);
    expect(header).toMatchObject({ __binaryFollows: true, type: 'chunk', fileId: 'f1', index: 0 });
    expect(channel.sent[1]).toBe(buf);
  });

  it('pairs a binary follow-up frame back with its preceding JSON header on receive', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const dataCb = vi.fn();
    conn.on('data', dataCb);

    channel.onmessage({ data: JSON.stringify({ __binaryFollows: true, type: 'chunk', fileId: 'f1', index: 2 }) });
    expect(dataCb).not.toHaveBeenCalled();

    const buf = new ArrayBuffer(8);
    channel.onmessage({ data: buf });

    expect(dataCb).toHaveBeenCalledTimes(1);
    expect(dataCb).toHaveBeenCalledWith({ type: 'chunk', fileId: 'f1', index: 2, chunk: buf });
  });

  it('drops a stray binary frame with no preceding header', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const dataCb = vi.fn();
    conn.on('data', dataCb);

    channel.onmessage({ data: new ArrayBuffer(4) });
    expect(dataCb).not.toHaveBeenCalled();
  });

  it('passes plain JSON messages straight through as "data" events', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const dataCb = vi.fn();
    conn.on('data', dataCb);

    channel.onmessage({ data: JSON.stringify({ type: 'done' }) });
    expect(dataCb).toHaveBeenCalledWith({ type: 'done' });
  });

  it('emits "close" when the channel closes', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const closeCb = vi.fn();
    conn.on('close', closeCb);

    conn.close();
    expect(closeCb).toHaveBeenCalledTimes(1);
  });

  it('emits "error" with the underlying error object', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, 'peer-1');
    const errorCb = vi.fn();
    conn.on('error', errorCb);

    const err = new Error('rtc failure');
    channel.onerror({ error: err });
    expect(errorCb).toHaveBeenCalledWith(err);
  });

  it('exposes the dataChannel and peer id for callers that reach in directly', () => {
    const channel = makeFakeChannel();
    const conn = new PeerJsCompatDataConnection(channel, '192.168.49.1');
    expect(conn.dataChannel).toBe(channel);
    expect(conn.peer).toBe('192.168.49.1');
  });
});
