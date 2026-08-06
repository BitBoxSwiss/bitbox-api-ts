// SPDX-License-Identifier: Apache-2.0

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { antikleptoError } from './errors.js';
import { bytesToBigIntBE, concatBytes, utf8ToBytes } from './utils.js';

const HOST_COMMIT_TAG = utf8ToBytes('s2c/ecdsa/data');
const POINT_TWEAK_TAG = utf8ToBytes('s2c/ecdsa/point');
const VERIFICATION_FAILED_MESSAGE =
  'Could not verify that the host nonce was contributed to the signature. If this happens repeatedly, the device might be attempting to leak the seed through the signature.';

export function genHostNonce(): Uint8Array {
  const out = new Uint8Array(32);
  try {
    globalThis.crypto.getRandomValues(out);
  } catch {
    throw antikleptoError('Failed generating antiklepto host nonce');
  }
  return out;
}

export function taggedSha256(tag: Uint8Array, msg: Uint8Array): Uint8Array {
  const tagHash = sha256(tag);
  return sha256(concatBytes(tagHash, tagHash, msg));
}

export function hostCommit(hostNonce: Uint8Array): Uint8Array {
  return taggedSha256(HOST_COMMIT_TAG, hostNonce);
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
  const tweak = taggedSha256(POINT_TWEAK_TAG, concatBytes(compressed, hostNonce));
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
      throw antikleptoError(VERIFICATION_FAILED_MESSAGE);
    }
  }
}
