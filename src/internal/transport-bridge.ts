// SPDX-License-Identifier: Apache-2.0

import { BRIDGE_BASE_URL, BRIDGE_WS_BASE_URL } from './constants.js';
import { MessageQueue } from './message-queue.js';
import type { LowerTransport } from './read-write.js';
import { TransportError, makeCloseGuard } from './read-write.js';

const DISCOVERY_ATTEMPTS = 10;
const DISCOVERY_SLEEP_MS = 100;

// Values of WebSocket.readyState. Mirror the DOM constants so tests don't
// need to depend on `globalThis.WebSocket`.
/** @internal */
export const WS_OPEN = 1;

/** @internal */
export interface BridgeWebSocket {
  binaryType: 'arraybuffer' | 'blob';
  readyState: number;
  onopen: ((this: BridgeWebSocket, ev: unknown) => void) | null;
  onclose: ((this: BridgeWebSocket, ev: unknown) => void) | null;
  onerror: ((this: BridgeWebSocket, ev: unknown) => void) | null;
  onmessage: ((this: BridgeWebSocket, ev: { data: ArrayBuffer }) => void) | null;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
}

/** @internal */
export interface BridgeDeps {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  WebSocket: new (url: string) => BridgeWebSocket;
}

function defaultDeps(): BridgeDeps {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  const WS = (globalThis as { WebSocket?: new (url: string) => BridgeWebSocket }).WebSocket;
  if (f === undefined || WS === undefined) {
    throw new TransportError('bridge', 'fetch or WebSocket is not available');
  }
  // Bind to globalThis: in browsers, `fetch` must be invoked with the realm's
  // global as the receiver. Calling it as a method on a captured object (e.g.
  // `deps.fetch(url)`) triggers `TypeError: Illegal invocation` before any
  // network request is sent.
  return { fetch: f.bind(globalThis), WebSocket: WS };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function discoverDevicePath(deps: BridgeDeps): Promise<string> {
  for (let i = 0; i < DISCOVERY_ATTEMPTS; i += 1) {
    let resp: Awaited<ReturnType<BridgeDeps['fetch']>>;
    try {
      resp = await deps.fetch(`${BRIDGE_BASE_URL}/devices`);
    } catch {
      throw new TransportError('bridge', 'BitBoxBridge not found.');
    }
    if (resp.status === 403) {
      throw new TransportError('bridge', 'Origin not whitelisted.');
    }
    if (!resp.ok) {
      throw new TransportError('bridge', 'Unexpected bridge connection error.');
    }
    const body = (await resp.json()) as { devices?: Array<{ path: string }> };
    const devices = body.devices ?? [];
    if (devices.length === 1) {
      return devices[0]!.path;
    }
    await sleep(DISCOVERY_SLEEP_MS);
  }
  throw new TransportError(
    'bridge',
    'Expected exactly one BitBox02. If one is connected, it might already have an open connection another app. If so, please close the other app first.',
  );
}

/**
 * Open a BitBox02 via the BitBoxBridge service. Discovery polls
 * `http://127.0.0.1:8178/api/v1/devices` for exactly one device, then opens
 * a WebSocket at `ws://127.0.0.1:8178/api/v1/socket/{path}`. The Rust
 * reference uses `localhost` for the HTTP probe; we deviate to `127.0.0.1`
 * because the bridge only binds the IPv4 loopback, and `localhost` resolves
 * to `::1` first on systems where /etc/hosts maps both, breaking the fetch.
 * @internal
 */
export async function openBridge(
  onCloseCb?: () => void,
  deps: BridgeDeps = defaultDeps(),
): Promise<LowerTransport> {
  const devicePath = await discoverDevicePath(deps);
  const socket = new deps.WebSocket(BRIDGE_WS_BASE_URL + devicePath);
  socket.binaryType = 'arraybuffer';

  const queue = new MessageQueue();
  const guard = makeCloseGuard(onCloseCb);
  let opened = false;

  socket.onmessage = (ev): void => {
    queue.push(new Uint8Array(ev.data));
  };

  await new Promise<void>((resolve, reject) => {
    socket.onopen = (): void => {
      opened = true;
      resolve();
    };
    socket.onclose = (): void => {
      guard();
      if (!opened) {
        reject(new TransportError('bridge', 'bridge socket closed before opening'));
      }
    };
    socket.onerror = (): void => {
      reject(new TransportError('bridge', 'Your BitBox02 is busy.'));
    };
  });

  return {
    write(bytes: Uint8Array): void {
      if (socket.readyState !== WS_OPEN) {
        throw new TransportError('write', 'bridge socket is not open');
      }
      socket.send(bytes);
    },
    read(): Promise<Uint8Array> {
      return queue.next();
    },
    close(): void {
      socket.close();
      guard();
    },
  };
}
