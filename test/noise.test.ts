// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  CipherState,
  NoiseXX,
  generateStaticPrivateKey,
  publicKeyFromPrivateKey,
} from '../src/internal/noise.js';

const EMPTY = new Uint8Array(0);

function pinned32(seed: number): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = (seed + i) & 0xff;
  }
  return out;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

const RUST_VECTOR = {
  initPublic: '07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c',
  respPublic: 'ab9f2628c325c141e9fb2430f106850f62930bc3f0b12df39a9b84a49c7c1d12',
  m1: '909705b0e7d1817db56cdcb89ba2fabad3e9a01b2c23bc73e3ec9d9a2ff9b827',
  m2: '66b76a4535f74c6f464c8f2395cb051864d00279ac88c3fc793fa00352e2ea5ae7550b01c9d07ecb38a558612fbf50090c6b7a691ae5ab5efa1aa477827a9212ebfa78a710281277cade0e21824e94b290841f1a0f21dcca8e9a0129930f118c',
  m3: '53598f877ef0c1da1a52167e6f4688319054686929f9eb86c614bbcd43a6716fcdef48f606d84a24b0343c3959a19d0091eef9199571a72969177c2cc4068b05',
  hash: '51abd3020a6a628a57e58fc28f060428094dc18270c1d3c1f924ddbbd4255a28',
  initSendCiphertext: 'c82c1e7a316c6bb173b8b0c494c4d31a51903400',
};

describe('NoiseXX handshake', () => {
  it('initiator and responder agree on the handshake hash and remote keys', () => {
    const initSk = generateStaticPrivateKey();
    const respSk = generateStaticPrivateKey();

    const init = new NoiseXX(true, initSk);
    const resp = new NoiseXX(false, respSk);

    const m1 = init.writeMessage();
    expect(m1.length).toBe(32);
    resp.readMessage(m1);

    const m2 = resp.writeMessage();
    expect(m2.length).toBe(96);
    init.readMessage(m2);

    const m3 = init.writeMessage();
    expect(m3.length).toBe(64);
    resp.readMessage(m3);

    expect(init.isComplete()).toBe(true);
    expect(resp.isComplete()).toBe(true);

    const a = init.finalize();
    const b = resp.finalize();

    expect(bytesEq(a.hash, b.hash)).toBe(true);
    expect(bytesEq(a.remoteStaticPubkey, publicKeyFromPrivateKey(respSk))).toBe(true);
    expect(bytesEq(b.remoteStaticPubkey, publicKeyFromPrivateKey(initSk))).toBe(true);
  });

  it('post-handshake AEAD round-trips bidirectionally', () => {
    const initSk = generateStaticPrivateKey();
    const respSk = generateStaticPrivateKey();

    const init = new NoiseXX(true, initSk);
    const resp = new NoiseXX(false, respSk);
    resp.readMessage(init.writeMessage());
    init.readMessage(resp.writeMessage());
    resp.readMessage(init.writeMessage());

    const a = init.finalize();
    const b = resp.finalize();

    const ct1 = a.send.encryptWithAd(EMPTY, new TextEncoder().encode('hello bb02'));
    expect(new TextDecoder().decode(b.recv.decryptWithAd(EMPTY, ct1))).toBe('hello bb02');

    const ct2 = b.send.encryptWithAd(EMPTY, new TextEncoder().encode('hello host'));
    expect(new TextDecoder().decode(a.recv.decryptWithAd(EMPTY, ct2))).toBe('hello host');
  });

  it('matches the Rust Noise_XX_25519_ChaChaPoly_SHA256 transcript', () => {
    const initSk = pinned32(1);
    const respSk = pinned32(2);
    const initEph = pinned32(3);
    const respEph = pinned32(4);

    expect(hex(publicKeyFromPrivateKey(initSk))).toBe(RUST_VECTOR.initPublic);
    expect(hex(publicKeyFromPrivateKey(respSk))).toBe(RUST_VECTOR.respPublic);

    const init = new NoiseXX(true, initSk, { fixedEphemeralPrivateKey: initEph });
    const resp = new NoiseXX(false, respSk, { fixedEphemeralPrivateKey: respEph });

    const m1 = init.writeMessage();
    expect(hex(m1)).toBe(RUST_VECTOR.m1);
    resp.readMessage(m1);
    const m2 = resp.writeMessage();
    expect(hex(m2)).toBe(RUST_VECTOR.m2);
    init.readMessage(m2);
    const m3 = init.writeMessage();
    expect(hex(m3)).toBe(RUST_VECTOR.m3);
    resp.readMessage(m3);

    const a = init.finalize();
    const b = resp.finalize();

    expect(bytesEq(a.hash, b.hash)).toBe(true);
    expect(hex(a.hash)).toBe(RUST_VECTOR.hash);
    expect(hex(a.remoteStaticPubkey)).toBe(RUST_VECTOR.respPublic);

    // Initiator's send cipher decrypts on the responder's recv cipher.
    const ct = a.send.encryptWithAd(EMPTY, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(hex(ct)).toBe(RUST_VECTOR.initSendCiphertext);
    expect(hex(b.recv.decryptWithAd(EMPTY, ct))).toBe('deadbeef');
  });

  it('rejects writeMessage when called after the handshake completes', () => {
    const init = new NoiseXX(true, pinned32(5));
    const resp = new NoiseXX(false, pinned32(6));
    resp.readMessage(init.writeMessage());
    init.readMessage(resp.writeMessage());
    resp.readMessage(init.writeMessage());
    expect(init.isComplete()).toBe(true);
    expect(() => init.writeMessage()).toThrow(/handshake already complete/);
  });

  it('rejects writeMessage when it is not the local peer turn', () => {
    const init = new NoiseXX(true, pinned32(7));
    init.writeMessage(); // turn 0 (init writes) ok
    expect(() => init.writeMessage()).toThrow(/turn to write/);
  });

  it('rejects readMessage with truncated remote ephemeral key', () => {
    const init = new NoiseXX(true, pinned32(8));
    init.writeMessage();
    expect(() => init.readMessage(new Uint8Array(10))).toThrow(/truncated/);
  });
});

describe('CipherState', () => {
  it('returns plaintext when no key has been mixed yet', () => {
    const c = new CipherState();
    const pt = new Uint8Array([1, 2, 3, 4]);
    expect(bytesEq(c.encryptWithAd(EMPTY, pt), pt)).toBe(true);
    expect(bytesEq(c.decryptWithAd(EMPTY, pt), pt)).toBe(true);
  });

  it('round-trips with associated data and increments nonce', () => {
    const k = pinned32(9);
    const enc = new CipherState(k);
    const dec = new CipherState(k);

    const ad = new TextEncoder().encode('header');
    const ct1 = enc.encryptWithAd(ad, new TextEncoder().encode('first'));
    const ct2 = enc.encryptWithAd(ad, new TextEncoder().encode('second'));

    // Different ciphertexts because nonce has advanced.
    expect(bytesEq(ct1, ct2)).toBe(false);
    expect(new TextDecoder().decode(dec.decryptWithAd(ad, ct1))).toBe('first');
    expect(new TextDecoder().decode(dec.decryptWithAd(ad, ct2))).toBe('second');
  });

  it('rejects ciphertext when the associated data does not match', () => {
    const k = pinned32(10);
    const enc = new CipherState(k);
    const dec = new CipherState(k);
    const ct = enc.encryptWithAd(new TextEncoder().encode('right'), new Uint8Array([1, 2, 3]));
    expect(() => dec.decryptWithAd(new TextEncoder().encode('wrong'), ct)).toThrow();
  });
});
