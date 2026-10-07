// SPDX-License-Identifier: Apache-2.0

import { secp256k1 } from '@noble/curves/secp256k1';

/** Validates a low-S compact ECDSA signature encoded as r || s. */
export function validateSignatureCompact(signature: Uint8Array): void {
  if (signature.length !== 64) {
    throw new Error('compact signature must be 64 bytes');
  }
  let parsedSignature;
  try {
    parsedSignature = secp256k1.Signature.fromCompact(signature);
  } catch {
    throw new Error('signature contains invalid ECDSA scalars');
  }
  if (parsedSignature.hasHighS()) {
    throw new Error('signature S must be low');
  }
}

/** Validates a low-S recoverable ECDSA signature with a recovery ID in the range 0..3. */
export function validateSignatureRecoverable(
  signature: Uint8Array,
): void {
  if (signature.length !== 65) {
    throw new Error('recoverable signature must be 65 bytes');
  }
  validateSignatureCompact(signature.subarray(0, 64));
  if (signature[64]! > 3) {
    throw new Error('signature recovery ID must be between 0 and 3');
  }
}
