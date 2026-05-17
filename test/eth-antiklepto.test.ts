// SPDX-License-Identifier: Apache-2.0

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes, utf8ToBytes as utf8 } from '@noble/hashes/utils';
import { describe, expect, it, vi } from 'vitest';
import {
  genHostNonce,
  hostCommit,
  taggedSha256,
  verifyEcdsa,
} from '../src/internal/eth/antiklepto.js';
import { bytesToBigIntBE } from '../src/internal/utils.js';
import { bigIntToBytes32BE } from './utils.js';

describe('taggedSha256', () => {
  it('matches sha256(sha256(tag) || sha256(tag) || msg)', () => {
    const tag = utf8('s2c/ecdsa/data');
    const msg = new Uint8Array([1, 2, 3, 4]);
    const tagHash = sha256(tag);
    const buf = new Uint8Array(tagHash.length * 2 + msg.length);
    buf.set(tagHash, 0);
    buf.set(tagHash, tagHash.length);
    buf.set(msg, tagHash.length * 2);
    const expected = sha256(buf);
    expect(taggedSha256(tag, msg)).toEqual(expected);
  });

  it('hostCommit uses the s2c/ecdsa/data tag', () => {
    const nonce = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      nonce[i] = i;
    }
    expect(hostCommit(nonce)).toEqual(taggedSha256(utf8('s2c/ecdsa/data'), nonce));
  });
});

describe('genHostNonce', () => {
  it('returns 32 random bytes', () => {
    const a = genHostNonce();
    const b = genHostNonce();
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(a).not.toEqual(b);
  });

  it('maps RNG failures to antiklepto errors', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues(): never {
        throw new Error('rng unavailable');
      },
    });

    try {
      expect(() => genHostNonce()).toThrow(
        expect.objectContaining({
          code: 'antiklepto',
          message: 'Antiklepto verification failed: Failed generating antiklepto host nonce',
        }),
      );
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });
});

function makeAntikleptoFixture(): {
  hostNonce: Uint8Array;
  signerCommitment: Uint8Array;
  signature: Uint8Array;
} {
  const hostNonce = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    hostNonce[i] = (i * 7 + 13) & 0xff;
  }
  // Pretend the device picked a deterministic k_device.
  const kDevice = bytesToBigIntBE(sha256(utf8('test-k-device'))) % secp256k1.CURVE.n;
  const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(kDevice);
  const signerCommitment = commitmentPoint.toRawBytes(true);
  // Compute the tweak the device would compute.
  const tagged = utf8('s2c/ecdsa/point');
  const data = new Uint8Array(signerCommitment.length + hostNonce.length);
  data.set(signerCommitment, 0);
  data.set(hostNonce, signerCommitment.length);
  const tweak = bytesToBigIntBE(taggedSha256(tagged, data));
  const finalPoint = commitmentPoint.add(secp256k1.ProjectivePoint.BASE.multiply(tweak));
  const finalUncompressed = finalPoint.toRawBytes(false);
  const r = finalUncompressed.slice(1, 33);
  const sig = new Uint8Array(65);
  sig.set(r, 0);
  // s and recid don't matter for antiklepto verification.
  sig.set(bigIntToBytes32BE(0x01n), 32);
  sig[64] = 0;
  return { hostNonce, signerCommitment, signature: sig };
}

describe('verifyEcdsa', () => {
  it('accepts a valid commitment + signature pair', () => {
    const { hostNonce, signerCommitment, signature } = makeAntikleptoFixture();
    expect(() => verifyEcdsa(hostNonce, signerCommitment, signature)).not.toThrow();
  });

  it('accepts the Rust implementation test vectors', () => {
    const cases = [
      {
        hostNonce: '8b4c26aa2695a34bdbc34235f6c91be14b93037a063b13f7c814101359561092',
        signerCommitment: '0236ff92fe02c08d0d04851e0ce1516104085215f05a178307de60ea53e207f971',
        signature:
          '7fd66b48ffea2fe048869880bbb3a1819e262af14980e8885df1e5765750cb8f47e01eca356377870356d54853573a955076228e5044cd3dd3a049abe70d5585',
      },
      {
        hostNonce: '9c9471aa529fbad96396b9379938e56195c5aa8e1e22b6e87d226e49d8b1f581',
        signerCommitment: '034e2979d398ce029996ffe99dc310a0f2cf9a5411b166f57a85fc3a24985f16be',
        signature:
          '48cb61d08c730e36b0285dfd9ece91e88a5ec0898d1c80b93e85b967e0ddcd195ab807640347e8f96e3fad67a971fc52eb4f15b4fa65577bcf4a053e598d057d',
      },
    ];

    for (const testCase of cases) {
      const signature = new Uint8Array(65);
      signature.set(hexToBytes(testCase.signature), 0);
      expect(() =>
        verifyEcdsa(
          hexToBytes(testCase.hostNonce),
          hexToBytes(testCase.signerCommitment),
          signature,
        ),
      ).not.toThrow();
    }
  });

  it('rejects when the signature R is wrong', () => {
    const { hostNonce, signerCommitment, signature } = makeAntikleptoFixture();
    const corrupted = new Uint8Array(signature);
    corrupted[5] = (corrupted[5]! ^ 0x01) & 0xff;
    expect(() => verifyEcdsa(hostNonce, signerCommitment, corrupted)).toThrow(
      expect.objectContaining({ code: 'antiklepto' }),
    );
  });

  it('rejects when the host nonce was tampered', () => {
    const { hostNonce, signerCommitment, signature } = makeAntikleptoFixture();
    const tampered = new Uint8Array(hostNonce);
    tampered[0] = (tampered[0]! ^ 0x80) & 0xff;
    expect(() => verifyEcdsa(tampered, signerCommitment, signature)).toThrow(
      expect.objectContaining({ code: 'antiklepto' }),
    );
  });

  it('rejects an invalid signer commitment encoding', () => {
    const bad = new Uint8Array(33);
    bad[0] = 0x05;
    const { hostNonce, signature } = makeAntikleptoFixture();
    expect(() => verifyEcdsa(hostNonce, bad, signature)).toThrow(
      expect.objectContaining({ code: 'antiklepto' }),
    );
  });

  it('rejects a wrong-length signature', () => {
    const { hostNonce, signerCommitment } = makeAntikleptoFixture();
    expect(() => verifyEcdsa(hostNonce, signerCommitment, new Uint8Array(64))).toThrow(
      expect.objectContaining({ code: 'antiklepto' }),
    );
  });
});
