// SPDX-License-Identifier: Apache-2.0

import type { Keypath } from '../../index.js';

export const HARDENED = 0x80000000;

const MAX_UINT32 = 0xffffffff;

class KeypathParseError extends Error {
  readonly code = 'keypath-parse';
  constructor(message: string) {
    super(message);
  }
}

function parseString(input: string): number[] {
  if (!input.startsWith('m/')) {
    throw new KeypathParseError(`failed parsing keypath: ${input}`);
  }
  const rest = input.slice(2);
  if (rest === '') {
    return [];
  }
  const parts = rest.split('/');
  const out: number[] = [];
  for (const part of parts) {
    let body = part;
    let addPrime = 0;
    if (body.endsWith('\'')) {
      addPrime = HARDENED;
      body = body.slice(0, -1);
    }
    if (body === '' || !/^\d+$/.test(body)) {
      throw new KeypathParseError(`failed parsing keypath: ${input}`);
    }
    const n = Number(body);
    if (!Number.isInteger(n) || n < 0 || n >= HARDENED) {
      throw new KeypathParseError(`failed parsing keypath: ${input}`);
    }
    out.push(n + addPrime);
  }
  return out;
}

function validateArray(input: number[]): number[] {
  for (const n of input) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_UINT32) {
      throw new KeypathParseError(`failed parsing keypath: ${n}`);
    }
  }
  return [...input];
}

export function parseKeypath(input: Keypath): number[] {
  if (Array.isArray(input)) {
    return validateArray(input);
  }
  return parseString(input);
}
