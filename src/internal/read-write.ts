// SPDX-License-Identifier: Apache-2.0

/** @internal */
export interface ReadWrite {
  write(msg: Uint8Array): void;
  read(): Promise<Uint8Array>;
}

/** @internal */
export interface LowerTransport extends ReadWrite {
  close(): void;
}

/** @internal */
export type TransportErrorCode =
  | 'write'
  | 'read'
  | 'u2f-decode'
  | 'info'
  | 'version'
  | 'bridge'
  | 'simulator'
  | 'webhid'
  | 'webhid-cancel';

/**
 * Transport-layer errors. The shape `{ code, message }` is compatible with the
 * public `Error` type in `src/index.ts`, so `ensureError` returns these as-is.
 * @internal
 */
export class TransportError extends Error {
  code: TransportErrorCode;

  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'TransportError';
  }
}

/** @internal */
export async function query(rw: ReadWrite, msg: Uint8Array): Promise<Uint8Array> {
  rw.write(msg);
  return rw.read();
}

/**
 * Wraps a close callback so it fires exactly once. Clearing the reference
 * after invocation prevents retained callbacks after teardown.
 * @internal
 */
export function makeCloseGuard(cb?: () => void): () => void {
  let fired = false;
  let stored = cb;
  return () => {
    if (fired) {
      return;
    }
    fired = true;
    const f = stored;
    stored = undefined;
    if (f !== undefined) {
      f();
    }
  };
}
