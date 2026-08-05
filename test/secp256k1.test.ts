// SPDX-License-Identifier: Apache-2.0

import { secp256k1 } from '@noble/curves/secp256k1';
import { describe, expect, it } from 'vitest';
import {
  validateSignatureCompact,
  validateSignatureRecoverable,
} from '../src/internal/secp256k1.js';
import { bigIntToBytes32BE } from './utils.js';

function validCompactSignature(): Uint8Array {
  const signature = new Uint8Array(64);
  signature.set(bigIntToBytes32BE(1n), 0);
  signature.set(bigIntToBytes32BE(1n), 32);
  return signature;
}

describe('validateSignatureCompact', () => {
  it('accepts a low-S signature', () => {
    expect(() => validateSignatureCompact(validCompactSignature())).not.toThrow();
  });

  it.each([63, 65])('rejects a %i-byte signature', (length) => {
    expect(() => validateSignatureCompact(new Uint8Array(length)))
      .toThrow('compact signature must be 64 bytes');
  });

  it.each([
    ['zero R', 0, 0n],
    ['out-of-range R', 0, secp256k1.CURVE.n],
    ['zero S', 32, 0n],
    ['out-of-range S', 32, secp256k1.CURVE.n],
  ])('rejects %s', (_name, offset, scalar) => {
    const signature = validCompactSignature();
    signature.set(bigIntToBytes32BE(scalar), offset);
    expect(() => validateSignatureCompact(signature))
      .toThrow('signature contains invalid ECDSA scalars');
  });

  it('rejects high-S signatures', () => {
    const signature = validCompactSignature();
    signature.set(bigIntToBytes32BE(secp256k1.CURVE.n - 1n), 32);
    expect(() => validateSignatureCompact(signature)).toThrow('signature S must be low');
  });
});

describe('validateSignatureRecoverable', () => {
  function validSignature(): Uint8Array {
    const signature = new Uint8Array(65);
    signature.set(validCompactSignature());
    return signature;
  }

  it('accepts a low-S signature with an in-range recovery ID', () => {
    expect(() => validateSignatureRecoverable(validSignature())).not.toThrow();
  });

  it.each([64, 66])('rejects a %i-byte signature', (length) => {
    expect(() => validateSignatureRecoverable(new Uint8Array(length)))
      .toThrow('recoverable signature must be 65 bytes');
  });

  it('accepts recovery IDs up to 3', () => {
    const signature = validSignature();
    signature[64] = 3;
    expect(() => validateSignatureRecoverable(signature)).not.toThrow();

    signature[64] = 4;
    expect(() => validateSignatureRecoverable(signature))
      .toThrow('signature recovery ID must be between 0 and 3');
  });
});
