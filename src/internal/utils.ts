// SPDX-License-Identifier: Apache-2.0

import { invalidTypeError } from './errors.js';

export { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

/** @internal */
export const UINT32_MAX = 0xffffffff;
/** @internal */
export const UINT64_MAX = (1n << 64n) - 1n;

/** @internal */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** @internal */
export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

/**
 * Big-endian minimal-bytes encoding of a non-negative integer. `0n` returns
 * an empty byte array.
 * @internal
 */
export function bigUintToBytesBE(n: bigint): Uint8Array {
  if (n < 0n) {
    throw new RangeError('bigUintToBytesBE: expected non-negative bigint');
  }
  if (n === 0n) {
    return new Uint8Array(0);
  }
  const bytes: number[] = [];
  let v = n;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return new Uint8Array(bytes);
}

/**
 * Two's-complement signed minimal-bytes encoding. `0n` returns `[0x00]`.
 * @internal
 */
export function bigIntToSignedBytesBE(n: bigint): Uint8Array {
  if (n === 0n) {
    return new Uint8Array([0]);
  }
  if (n > 0n) {
    const bytes: number[] = [];
    let v = n;
    while (v > 0n) {
      bytes.unshift(Number(v & 0xffn));
      v >>= 8n;
    }
    if ((bytes[0]! & 0x80) !== 0) {
      bytes.unshift(0);
    }
    return new Uint8Array(bytes);
  }
  let v = n;
  const bytes: number[] = [];
  while (v !== -1n || bytes.length === 0 || (bytes[0]! & 0x80) === 0) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return new Uint8Array(bytes);
}

/** @internal */
export function stripLeadingZeroes(input: Uint8Array): Uint8Array {
  let i = 0;
  while (i < input.length && input[i] === 0) {
    i += 1;
  }
  return input.subarray(i);
}

/** @internal */
export function validateUint32(value: number, detail: string): number {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw invalidTypeError(detail);
  }
  return value;
}

/** @internal */
export function validateUint64(value: unknown, detail: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > UINT64_MAX) {
    throw invalidTypeError(detail);
  }
  return value;
}
