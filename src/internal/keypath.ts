// SPDX-License-Identifier: Apache-2.0

import type { Keypath } from '../index.js';
import { keypathParseError } from './errors.js';

export const HARDENED = 0x80000000;

const MAX_UINT32 = 0xffffffff;

function parseString(input: string): number[] {
  if (!input.startsWith('m/')) {
    throw keypathParseError(input);
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
      throw keypathParseError(input);
    }
    const n = Number(body);
    if (!Number.isInteger(n) || n < 0 || n >= HARDENED) {
      throw keypathParseError(input);
    }
    out.push(n + addPrime);
  }
  return out;
}

function validateArray(input: number[]): number[] {
  for (const n of input) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_UINT32) {
      throw keypathParseError(String(n));
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
