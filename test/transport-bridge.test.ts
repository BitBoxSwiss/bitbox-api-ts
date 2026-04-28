// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  openBridge,
  WS_OPEN,
  type BridgeDeps,
  type BridgeWebSocket,
} from '../src/internal/transport-bridge.js';

type FetchResult = { ok: boolean; status: number; json(): Promise<unknown> };

function scriptedFetch(responses: FetchResult[]): {
  fn: BridgeDeps['fetch'];
  calls: string[];
} {
  const calls: string[] = [];
  const queue = [...responses];
  return {
    fn(url: string) {
      calls.push(url);
      const r = queue.shift();
      if (r === undefined) {
        return Promise.reject(new Error('fetch: out of scripted responses'));
      }
      return Promise.resolve(r);
    },
    calls,
  };
}

function okJson(body: unknown, status = 200): FetchResult {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

class FakeBridgeSocket implements BridgeWebSocket {
  binaryType: 'arraybuffer' | 'blob' = 'blob';
  readyState = 0;
  onopen: BridgeWebSocket['onopen'] = null;
  onclose: BridgeWebSocket['onclose'] = null;
  onerror: BridgeWebSocket['onerror'] = null;
  onmessage: BridgeWebSocket['onmessage'] = null;
  readonly sent: Uint8Array[] = [];
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => { FakeBridgeSocket.onConstruct?.(this); });
  }

  static onConstruct: ((s: FakeBridgeSocket) => void) | null = null;

  triggerOpen(): void {
    this.readyState = WS_OPEN;
    this.onopen?.call(this, {});
  }

  triggerMessage(data: ArrayBuffer): void {
    this.onmessage?.call(this, { data });
  }

  triggerClose(): void {
    this.readyState = 3;
    this.onclose?.call(this, {});
  }

  triggerError(): void {
    this.onerror?.call(this, {});
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (data instanceof ArrayBuffer) {
      this.sent.push(new Uint8Array(data));
    } else {
      this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  close(): void {
    this.closed = true;
    this.triggerClose();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('openBridge', () => {
  it('polls /devices and opens WS to the discovered path', async () => {
    const fetchMock = scriptedFetch([
      okJson({ devices: [] }),
      okJson({ devices: [{ path: '/dev/abc' }] }),
    ]);
    let constructed: FakeBridgeSocket | null = null;
    FakeBridgeSocket.onConstruct = (s) => {
      constructed = s;
      s.triggerOpen();
    };

    const pending = openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket });
    await flush();
    const transport = await pending;

    expect(fetchMock.calls).toEqual([
      'http://127.0.0.1:8178/api/v1/devices',
      'http://127.0.0.1:8178/api/v1/devices',
    ]);
    expect(constructed!.url).toBe('ws://127.0.0.1:8178/api/v1/socket//dev/abc');
    expect(constructed!.binaryType).toBe('arraybuffer');
    transport.close();
    FakeBridgeSocket.onConstruct = null;
  });

  it('delivers inbound binary frames to read()', async () => {
    const fetchMock = scriptedFetch([okJson({ devices: [{ path: 'p' }] })]);
    let constructed: FakeBridgeSocket | null = null;
    FakeBridgeSocket.onConstruct = (s) => {
      constructed = s;
      s.triggerOpen();
    };

    const transport = await openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket });
    const pending = transport.read();
    const ab = new ArrayBuffer(3);
    new Uint8Array(ab).set([1, 2, 3]);
    constructed!.triggerMessage(ab);
    expect(await pending).toEqual(new Uint8Array([1, 2, 3]));
    transport.close();
    FakeBridgeSocket.onConstruct = null;
  });

  it('close() invokes onCloseCb exactly once', async () => {
    const fetchMock = scriptedFetch([okJson({ devices: [{ path: 'p' }] })]);
    FakeBridgeSocket.onConstruct = (s) => { s.triggerOpen(); };
    let calls = 0;
    const transport = await openBridge(() => { calls += 1; }, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket });
    transport.close();
    transport.close();
    expect(calls).toBe(1);
    FakeBridgeSocket.onConstruct = null;
  });

  it('rejects with a typed bridge error on onerror', async () => {
    const fetchMock = scriptedFetch([okJson({ devices: [{ path: 'p' }] })]);
    FakeBridgeSocket.onConstruct = (s) => { s.triggerError(); };
    await expect(
      openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket }),
    ).rejects.toMatchObject({ code: 'bridge' });
    FakeBridgeSocket.onConstruct = null;
  });

  it('rejects after 10 discovery attempts with no device', async () => {
    const empty = Array.from({ length: 10 }, () => okJson({ devices: [] }));
    const fetchMock = scriptedFetch(empty);
    await expect(
      openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket }),
    ).rejects.toMatchObject({
      code: 'bridge',
      message: 'Expected exactly one BitBox02. If one is connected, it might already have an open connection another app. If so, please close the other app first.',
    });
    expect(fetchMock.calls).toHaveLength(10);
  });

  it('throws immediately on HTTP 403 (origin not whitelisted)', async () => {
    const fetchMock = scriptedFetch([
      { ok: false, status: 403, json: () => Promise.resolve({}) },
    ]);
    await expect(
      openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket }),
    ).rejects.toMatchObject({ code: 'bridge', message: 'Origin not whitelisted.' });
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('fails immediately on unexpected HTTP errors', async () => {
    const fetchMock = scriptedFetch([
      { ok: false, status: 500, json: () => Promise.resolve({}) },
      okJson({ devices: [{ path: 'should-not-be-fetched' }] }),
    ]);
    await expect(
      openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket }),
    ).rejects.toMatchObject({ code: 'bridge', message: 'Unexpected bridge connection error.' });
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('fails immediately when bridge discovery fetch throws', async () => {
    const fetchMock: BridgeDeps['fetch'] = () => Promise.reject(new Error('offline'));
    await expect(
      openBridge(undefined, { fetch: fetchMock, WebSocket: FakeBridgeSocket }),
    ).rejects.toMatchObject({ code: 'bridge', message: 'BitBoxBridge not found.' });
  });

  it('rejects if the websocket closes before opening', async () => {
    const fetchMock = scriptedFetch([okJson({ devices: [{ path: 'p' }] })]);
    let calls = 0;
    FakeBridgeSocket.onConstruct = (s) => { s.triggerClose(); };
    await expect(
      openBridge(() => { calls += 1; }, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket }),
    ).rejects.toMatchObject({ code: 'bridge', message: 'bridge socket closed before opening' });
    expect(calls).toBe(1);
    FakeBridgeSocket.onConstruct = null;
  });

  it('write throws when the socket is not open', async () => {
    const fetchMock = scriptedFetch([okJson({ devices: [{ path: 'p' }] })]);
    let constructed: FakeBridgeSocket | null = null;
    FakeBridgeSocket.onConstruct = (s) => {
      constructed = s;
      s.triggerOpen();
    };
    const transport = await openBridge(undefined, { fetch: fetchMock.fn, WebSocket: FakeBridgeSocket });
    constructed!.readyState = 2;
    expect(() => transport.write(new Uint8Array([1]))).toThrow(/open/);
    FakeBridgeSocket.onConstruct = null;
  });
});
