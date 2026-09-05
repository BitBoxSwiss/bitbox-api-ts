// SPDX-License-Identifier: Apache-2.0

import {
  address,
  initEccLib,
  opcodes,
  script as bitcoinScript,
} from 'bitcoinjs-lib';
import { hexToBytes } from '@noble/hashes/utils';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';
import {
  parsePsbt,
  payloadFromPkscript,
} from '../src/internal/btc/psbt.js';
import { BTCOutputType } from '../src/proto/gen/btc_pb.js';

initEccLib(ecc);

describe('Bitcoin output scripts', () => {
  it.each([
    [
      '1AMZK8xzHJWsuRErpGZTiW4jKz8fdfLUGE',
      BTCOutputType.P2PKH,
      20,
    ],
    [
      '3JFL8CgtV4ZtMFYeP5LgV4JppLkHw5Gw9T',
      BTCOutputType.P2SH,
      20,
    ],
    [
      'bc1qkl8ms75cq6ajxtny7e88z3u9hkpkvktt5jwh6u',
      BTCOutputType.P2WPKH,
      20,
    ],
    [
      'bc1q2fhgukymf0caaqrhfxrdju4wm94wwrch2ukntl5fuc0faz8zm49q0h6ss8',
      BTCOutputType.P2WSH,
      32,
    ],
    [
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
      BTCOutputType.P2TR,
      32,
    ],
  ] as const)('parses %s', (encodedAddress, outputType, payloadLength) => {
    const payload = payloadFromPkscript(address.toOutputScript(encodedAddress));
    expect(payload.outputType).toBe(outputType);
    expect(payload.data).toHaveLength(payloadLength);
  });

  it('parses empty, direct-push, and PUSHDATA1 OP_RETURN outputs', () => {
    expect(payloadFromPkscript(hexToBytes('6a00'))).toEqual({
      data: new Uint8Array(),
      outputType: BTCOutputType.OP_RETURN,
    });
    expect(payloadFromPkscript(hexToBytes('6a03aabbcc'))).toEqual({
      data: hexToBytes('aabbcc'),
      outputType: BTCOutputType.OP_RETURN,
    });
    const eightyBytes = new Uint8Array(80).fill(0xaa);
    expect(payloadFromPkscript(bitcoinScript.compile([
      opcodes.OP_RETURN,
      eightyBytes,
    ]))).toEqual({
      data: eightyBytes,
      outputType: BTCOutputType.OP_RETURN,
    });
  });

  it.each([
    ['6a', 'naked OP_RETURN'],
    ['6a6a', 'no data push'],
    ['6a0000', 'only one data push'],
    ['6a4c03aabbcc', 'failed to parse'],
  ])('rejects invalid OP_RETURN script %s', (script, message) => {
    try {
      payloadFromPkscript(hexToBytes(script));
      throw new Error('expected payload parsing to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'psbt-invalid-op-return',
      });
      expect((error as Error).message).toContain(message);
    }
  });

  it('rejects unknown output scripts', () => {
    expect(() => payloadFromPkscript(hexToBytes('51'))).toThrowError();
    try {
      payloadFromPkscript(hexToBytes('51'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'psbt-unknown-output-type' });
    }

    const nonMinimalP2tr = `514c20${'00'.repeat(32)}`;
    expect(() => payloadFromPkscript(hexToBytes(nonMinimalP2tr))).toThrowError();
  });
});

describe('parsePsbt', () => {
  it('maps bitcoinjs-lib parser failures to psbt-parse', () => {
    try {
      parsePsbt('not a PSBT');
      throw new Error('expected PSBT parsing to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'psbt-parse' });
    }
  });
});
