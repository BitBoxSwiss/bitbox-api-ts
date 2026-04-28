// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { HARDENED, parseKeypath } from '../src/internal/eth/keypath.js';

describe('parseKeypath', () => {
  it('parses unhardened path', () => {
    expect(parseKeypath('m/44/0/0/0')).toEqual([44, 0, 0, 0]);
  });

  it('parses hardened path', () => {
    expect(parseKeypath('m/44\'/0\'/0\'/0\'')).toEqual([
      HARDENED + 44,
      HARDENED,
      HARDENED,
      HARDENED,
    ]);
  });

  it('parses mixed hardened/unhardened path', () => {
    expect(parseKeypath('m/44\'/60\'/0\'/0/0')).toEqual([
      HARDENED + 44,
      HARDENED + 60,
      HARDENED,
      0,
      0,
    ]);
  });

  it('returns empty for m/', () => {
    expect(parseKeypath('m/')).toEqual([]);
  });

  it('parses max hardened indices', () => {
    expect(parseKeypath('m/2147483647\'/2147483647\'/2147483647\'')).toEqual([
      HARDENED + 2147483647,
      HARDENED + 2147483647,
      HARDENED + 2147483647,
    ]);
  });

  it('rejects unhardened value at or above HARDENED boundary', () => {
    expect(() => parseKeypath('m/2147483648/0/0')).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
  });

  it('rejects empty path segment', () => {
    expect(() => parseKeypath('m//0/0')).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
  });

  it('rejects missing m/ prefix', () => {
    expect(() => parseKeypath('44/0/0/0')).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
  });

  it('rejects non-numeric segment', () => {
    expect(() => parseKeypath('m/foo/0')).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
  });

  it('passes through valid number arrays as a fresh copy', () => {
    const input = [HARDENED + 44, HARDENED + 60, HARDENED, 0, 0];
    const out = parseKeypath(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('rejects out-of-range numbers in array form', () => {
    expect(() => parseKeypath([0x100000000])).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
    expect(() => parseKeypath([-1])).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
    expect(() => parseKeypath([1.5])).toThrow(
      expect.objectContaining({ code: 'keypath-parse' }),
    );
  });
});
