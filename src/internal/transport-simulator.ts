// SPDX-License-Identifier: Apache-2.0

import * as net from 'node:net';
import { SIMULATOR_DEFAULT_ENDPOINT } from './constants.js';
import { MessageQueue } from './message-queue.js';
import type { LowerTransport } from './read-write.js';
import { TransportError, makeCloseGuard } from './read-write.js';
import { sleep } from './utils.js';

// Rust's try_connect (simulator.rs:35-43) uses 200 * 10ms = 2s; Node + cold
// sim starts occasionally exceed that, so give ourselves a 5s window.
const CONNECT_ATTEMPTS = 500;
const CONNECT_ATTEMPT_SLEEP_MS = 10;

function attemptConnect(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port });
    const onError = (err: Error): void => {
      s.removeListener('connect', onConnect);
      s.destroy();
      reject(err);
    };
    const onConnect = (): void => {
      s.removeListener('error', onError);
      resolve(s);
    };
    s.once('error', onError);
    s.once('connect', onConnect);
  });
}

/**
 * Open a TCP connection to a BitBox02 simulator. Mirrors
 * `bitbox-api-rs/src/simulator.rs` `try_connect` with a ~2s retry window.
 *
 * The simulator speaks raw U2F HID framing over TCP (64-byte reads on the
 * Rust side). Wrap the returned transport in `U2fHidCommunication`.
 * @internal
 */
export async function openSimulator(
  endpoint: string = SIMULATOR_DEFAULT_ENDPOINT,
  onCloseCb?: () => void,
): Promise<LowerTransport> {
  const colon = endpoint.lastIndexOf(':');
  if (colon < 0) {
    throw new TransportError('simulator', `invalid endpoint ${endpoint}`);
  }
  const host = endpoint.slice(0, colon);
  const port = Number(endpoint.slice(colon + 1));
  if (!Number.isFinite(port)) {
    throw new TransportError('simulator', `invalid endpoint port in ${endpoint}`);
  }

  let socket: net.Socket | null = null;
  for (let i = 0; i < CONNECT_ATTEMPTS; i += 1) {
    try {
      socket = await attemptConnect(host, port);
      break;
    } catch {
      await sleep(CONNECT_ATTEMPT_SLEEP_MS);
    }
  }
  if (socket === null) {
    throw new TransportError('simulator', `could not connect to ${endpoint}`);
  }
  const s = socket;

  const queue = new MessageQueue();
  const guard = makeCloseGuard(onCloseCb);

  s.on('data', (chunk: Buffer) => {
    queue.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });
  s.on('close', () => { guard(); });
  s.on('end', () => { guard(); });
  s.on('error', () => { guard(); });

  return {
    write(bytes: Uint8Array): void {
      s.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    },
    read(): Promise<Uint8Array> {
      return queue.next();
    },
    close(): void {
      // RST close (instead of graceful FIN). Avoids leaving the simulator's
      // listening port in TIME_WAIT, which blocks the next test file from
      // rebinding 127.0.0.1:15423 back-to-back.
      s.resetAndDestroy();
      guard();
    },
  };
}
