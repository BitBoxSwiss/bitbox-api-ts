// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { ensureError, isUserAbort, type Error as BitBoxError } from '../src/index.js';
import { couldNotOpenBridge } from '../src/internal/errors.js';

describe('ensureError', () => {
  it('passes through structured typed errors unchanged', () => {
    const typed: BitBoxError = { code: 'invalid-state', message: 'wrong state' };
    expect(ensureError(typed)).toBe(typed);
  });

  it('preserves the `err` pass-through field on structured errors', () => {
    const inner = new Error('underlying');
    const typed: BitBoxError = {
      code: 'unknown-js',
      message: 'Unknown Javascript error',
      err: inner,
    };
    const result = ensureError(typed);
    expect(result).toBe(typed);
    expect(result.err).toBe(inner);
  });

  it('wraps a raw JS Error as { code: "unknown-js", err: <original> }', () => {
    const raw = new Error('oops');
    const wrapped = ensureError(raw);
    expect(wrapped.code).toBe('unknown-js');
    expect(wrapped.message).toBe('Unknown Javascript error');
    expect(wrapped.err).toBe(raw);
  });

  it('wraps a non-object throwable (string, number, undefined, null)', () => {
    expect(ensureError('a string').code).toBe('unknown-js');
    expect(ensureError(42).code).toBe('unknown-js');
    expect(ensureError(undefined).code).toBe('unknown-js');
    expect(ensureError(null).code).toBe('unknown-js');
  });

  it('wraps objects missing code or message fields, or with wrong types', () => {
    expect(ensureError({ code: 'x' }).code).toBe('unknown-js');
    expect(ensureError({ message: 'y' }).code).toBe('unknown-js');
    expect(ensureError({ code: 1, message: 'x' }).code).toBe('unknown-js');
  });

  it('round-trips: wrap a raw error, re-run through ensureError, code is preserved', () => {
    const raw = new Error('boom');
    const first = ensureError(raw);
    const second = ensureError(first);
    expect(second).toBe(first);
    expect(second.code).toBe('unknown-js');
  });

  it('keeps typed Error messages enumerable for extension message passing', () => {
    const err = couldNotOpenBridge('BitBoxBridge not found.');
    const cloned = JSON.parse(JSON.stringify(err));

    expect(err).toBeInstanceOf(Error);
    expect(Object.keys(err)).toEqual(expect.arrayContaining(['code', 'message']));
    expect(cloned).toEqual({
      code: 'could-not-open',
      message: 'Could not open device. BitBoxBridge not found.',
    });
  });
});

describe('isUserAbort', () => {
  it('returns true for code "user-abort"', () => {
    expect(isUserAbort({ code: 'user-abort', message: '' })).toBe(true);
  });

  it('returns true for code "bitbox-user-abort"', () => {
    expect(isUserAbort({ code: 'bitbox-user-abort', message: '' })).toBe(true);
  });

  it('returns false for any other code', () => {
    expect(isUserAbort({ code: 'unsupported', message: '' })).toBe(false);
    expect(isUserAbort({ code: 'invalid-state', message: '' })).toBe(false);
    expect(isUserAbort({ code: '', message: '' })).toBe(false);
  });
});
