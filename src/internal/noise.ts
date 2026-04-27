// SPDX-License-Identifier: Apache-2.0

import { x25519 } from '@noble/curves/ed25519';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';

const PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_SHA256';
const PROTOCOL_NAME_BYTES = new TextEncoder().encode(PROTOCOL_NAME);

const DHLEN = 32;
const HASHLEN = 32;
const TAGLEN = 16;
const EMPTY = new Uint8Array(0);

const XX_PATTERNS: ReadonlyArray<ReadonlyArray<string>> = [
  ['e'],
  ['e', 'ee', 's', 'es'],
  ['s', 'se'],
];

interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

function keyPairFromPrivateKey(privateKey: Uint8Array): KeyPair {
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

function dh(local: KeyPair, remotePub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(local.privateKey, remotePub);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function nonce96(n: bigint): Uint8Array {
  const buf = new Uint8Array(12);
  new DataView(buf.buffer).setBigUint64(4, n, true);
  return buf;
}

function noiseHkdf2(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf(sha256, ikm, ck, EMPTY, HASHLEN * 2);
  return [out.slice(0, HASHLEN), out.slice(HASHLEN, HASHLEN * 2)];
}

/**
 * Post-handshake AEAD state. Tracks a 64-bit nonce counter per direction;
 * empty `k` means the cipher is uninitialized (early-handshake state, before
 * the first `MixKey`).
 * @internal
 */
export class CipherState {
  private k: Uint8Array | undefined;
  private n: bigint = 0n;

  constructor(k?: Uint8Array) {
    if (k !== undefined) {
      this.k = k;
    }
  }

  hasKey(): boolean {
    return this.k !== undefined;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (this.k === undefined) {
      return plaintext;
    }
    const ct = chacha20poly1305(this.k, nonce96(this.n), ad).encrypt(plaintext);
    this.n += 1n;
    return ct;
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (this.k === undefined) {
      return ciphertext;
    }
    const pt = chacha20poly1305(this.k, nonce96(this.n), ad).decrypt(ciphertext);
    this.n += 1n;
    return pt;
  }
}

class SymmetricState {
  ck: Uint8Array;
  h: Uint8Array;
  cipher: CipherState;

  constructor() {
    this.h = new Uint8Array(HASHLEN);
    this.h.set(PROTOCOL_NAME_BYTES);
    this.ck = new Uint8Array(this.h);
    this.cipher = new CipherState();
  }

  hasCipherKey(): boolean {
    return this.cipher.hasKey();
  }

  mixHash(data: Uint8Array): void {
    this.h = sha256(concat(this.h, data));
  }

  mixKey(ikm: Uint8Array): void {
    const [newCk, newK] = noiseHkdf2(this.ck, ikm);
    this.ck = newCk;
    this.cipher = new CipherState(newK);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ct = this.cipher.encryptWithAd(this.h, plaintext);
    this.mixHash(ct);
    return ct;
  }

  decryptAndHash(ct: Uint8Array): Uint8Array {
    const pt = this.cipher.decryptWithAd(this.h, ct);
    this.mixHash(ct);
    return pt;
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = noiseHkdf2(this.ck, EMPTY);
    return [new CipherState(k1), new CipherState(k2)];
  }
}

/** @internal */
export interface HandshakeFinalState {
  hash: Uint8Array;
  remoteStaticPubkey: Uint8Array;
  send: CipherState;
  recv: CipherState;
}

/** @internal */
export interface NoiseXXOptions {
  /** Test-only: pin the ephemeral private key so message bytes are deterministic. */
  fixedEphemeralPrivateKey?: Uint8Array;
}

/**
 * `Noise_XX_25519_ChaChaPoly_SHA256` handshake state. The class supports both
 * initiator and responder roles so the same code can drive production
 * handshakes (initiator) and unit-test peer simulation (responder).
 * @internal
 */
export class NoiseXX {
  private readonly initiator: boolean;
  private readonly s: KeyPair;
  private e: KeyPair | undefined;
  private re: Uint8Array | undefined;
  private rs: Uint8Array | undefined;
  private readonly symmetric = new SymmetricState();
  private patternIndex = 0;
  private readonly fixedEphemeralPrivateKey?: Uint8Array;

  constructor(initiator: boolean, staticPrivateKey: Uint8Array, options?: NoiseXXOptions) {
    this.initiator = initiator;
    this.s = keyPairFromPrivateKey(staticPrivateKey);
    this.symmetric.mixHash(PROTOCOL_NAME_BYTES);
    if (options?.fixedEphemeralPrivateKey !== undefined) {
      this.fixedEphemeralPrivateKey = options.fixedEphemeralPrivateKey;
    }
  }

  /** Compose the next outgoing handshake message; payload is empty. */
  writeMessage(): Uint8Array {
    const tokens = XX_PATTERNS[this.patternIndex];
    if (tokens === undefined) {
      throw new Error('handshake already complete');
    }
    const isOurTurn = (this.patternIndex % 2 === 0) === this.initiator;
    if (!isOurTurn) {
      throw new Error('not the local peer turn to write');
    }

    let buf: Uint8Array = EMPTY;
    for (const tok of tokens) {
      if (tok === 'e') {
        const sk = this.fixedEphemeralPrivateKey ?? x25519.utils.randomPrivateKey();
        this.e = keyPairFromPrivateKey(sk);
        buf = concat(buf, this.e.publicKey);
        this.symmetric.mixHash(this.e.publicKey);
      } else if (tok === 's') {
        buf = concat(buf, this.symmetric.encryptAndHash(this.s.publicKey));
      } else {
        this.symmetric.mixKey(this.tokenDh(tok));
      }
    }
    buf = concat(buf, this.symmetric.encryptAndHash(EMPTY));
    this.patternIndex += 1;
    return buf;
  }

  /** Process an incoming handshake message; payload is expected empty. */
  readMessage(message: Uint8Array): void {
    const tokens = XX_PATTERNS[this.patternIndex];
    if (tokens === undefined) {
      throw new Error('handshake already complete');
    }
    const isOurTurn = (this.patternIndex % 2 === 0) === this.initiator;
    if (isOurTurn) {
      throw new Error('not the local peer turn to read');
    }

    let cursor = 0;
    for (const tok of tokens) {
      if (tok === 'e') {
        if (message.length - cursor < DHLEN) {
          throw new Error('handshake message truncated at remote ephemeral key');
        }
        this.re = message.slice(cursor, cursor + DHLEN);
        cursor += DHLEN;
        this.symmetric.mixHash(this.re);
      } else if (tok === 's') {
        const len = this.symmetric.hasCipherKey() ? DHLEN + TAGLEN : DHLEN;
        if (message.length - cursor < len) {
          throw new Error('handshake message truncated at remote static key');
        }
        const slice = message.slice(cursor, cursor + len);
        cursor += len;
        this.rs = this.symmetric.decryptAndHash(slice);
      } else {
        this.symmetric.mixKey(this.tokenDh(tok));
      }
    }
    this.symmetric.decryptAndHash(message.slice(cursor));
    this.patternIndex += 1;
  }

  isComplete(): boolean {
    return this.patternIndex >= XX_PATTERNS.length;
  }

  finalize(): HandshakeFinalState {
    if (!this.isComplete()) {
      throw new Error('handshake not complete');
    }
    if (this.rs === undefined) {
      throw new Error('remote static key was not received');
    }
    const [c1, c2] = this.symmetric.split();
    return {
      hash: this.symmetric.h,
      remoteStaticPubkey: this.rs,
      send: this.initiator ? c1 : c2,
      recv: this.initiator ? c2 : c1,
    };
  }

  private tokenDh(token: string): Uint8Array {
    if (token === 'ee') {
      return dh(this.e!, this.re!);
    }
    if (token === 'ss') {
      return dh(this.s, this.rs!);
    }
    if (token === 'es') {
      return this.initiator ? dh(this.e!, this.rs!) : dh(this.s, this.re!);
    }
    if (token === 'se') {
      return this.initiator ? dh(this.s, this.re!) : dh(this.e!, this.rs!);
    }
    throw new Error(`unsupported handshake token: ${token}`);
  }
}

/** Generate a new x25519 static keypair private key (32 bytes). @internal */
export function generateStaticPrivateKey(): Uint8Array {
  return x25519.utils.randomPrivateKey();
}

/** Derive the public key for an x25519 private key. @internal */
export function publicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}
