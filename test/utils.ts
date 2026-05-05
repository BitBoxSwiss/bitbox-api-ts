// SPDX-License-Identifier: Apache-2.0

const EMPTY = new Uint8Array(0);
const HWW_RESPONSE_SUCCESS = 0x00;
const HWW_RESPONSE_FAILURE = 0x01;

export function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

export function hwwSuccess(payload: Uint8Array = EMPTY): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = HWW_RESPONSE_SUCCESS;
  out.set(payload, 1);
  return out;
}

export function hwwFailure(): Uint8Array {
  return bytes(HWW_RESPONSE_FAILURE);
}

export function pinned32(seed: number): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = (seed + i) & 0xff;
  }
  return out;
}

export function bigIntToBytes32BE(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
