// SPDX-License-Identifier: Apache-2.0

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { antikleptoError } from '../errors.js';

const HOST_COMMIT_TAG = new TextEncoder().encode('s2c/ecdsa/data');
const POINT_TWEAK_TAG = new TextEncoder().encode('s2c/ecdsa/point');

export function genHostNonce(): Uint8Array {
  const out = new Uint8Array(32);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function taggedSha256(tag: Uint8Array, msg: Uint8Array): Uint8Array {
  const tagHash = sha256(tag);
  const buf = new Uint8Array(tagHash.length * 2 + msg.length);
  buf.set(tagHash, 0);
  buf.set(tagHash, tagHash.length);
  buf.set(msg, tagHash.length * 2);
  return sha256(buf);
}

export function hostCommit(hostNonce: Uint8Array): Uint8Array {
  return taggedSha256(HOST_COMMIT_TAG, hostNonce);
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

export function verifyEcdsa(
  hostNonce: Uint8Array,
  signerCommitment: Uint8Array,
  signature: Uint8Array,
): void {
  if (signature.length !== 65) {
    throw antikleptoError('signature must be 65 bytes');
  }
  let point;
  try {
    point = secp256k1.ProjectivePoint.fromHex(signerCommitment);
  } catch {
    throw antikleptoError('failed to parse signer commitment');
  }
  const compressed = point.toRawBytes(true);
  const data = new Uint8Array(compressed.length + hostNonce.length);
  data.set(compressed, 0);
  data.set(hostNonce, compressed.length);
  const tweak = taggedSha256(POINT_TWEAK_TAG, data);
  const tweakBig = bytesToBigIntBE(tweak);
  if (tweakBig === 0n || tweakBig >= secp256k1.CURVE.n) {
    throw antikleptoError('tweak is an invalid scalar');
  }
  let tweaked;
  try {
    tweaked = point.add(secp256k1.ProjectivePoint.BASE.multiply(tweakBig));
  } catch {
    throw antikleptoError('failed to apply tweak');
  }
  const uncompressed = tweaked.toRawBytes(false);
  const xCoord = uncompressed.subarray(1, 33);
  const sigR = signature.subarray(0, 32);
  for (let i = 0; i < 32; i += 1) {
    if (xCoord[i] !== sigR[i]) {
      throw antikleptoError('antiklepto verification failed');
    }
  }
}
