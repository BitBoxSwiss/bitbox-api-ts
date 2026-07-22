// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Psbt } from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import { PairedBitBox } from '../src/index.js';
import type { Info } from '../src/internal/hww.js';
import type { EncryptedChannel } from '../src/internal/pairing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(
  path.join(__dirname, 'data/btc-transaction-test-vectors.json'),
  'utf8',
)) as { vectors: { psbt: { transaction: string } }[] };
const validPsbt = Psbt.fromHex(vectors.vectors[0]!.psbt.transaction).toBase64();

function paired(version = '9.26.0') {
  const query = vi.fn(async () => {
    throw new Error('unexpected device query');
  });
  const info: Info = {
    version,
    product: 'bitbox02-multi',
    unlocked: true,
    initialized: true,
  };
  return {
    bitbox: new PairedBitBox({
      channel: { query } as EncryptedChannel,
      info,
      close(): void {},
    }),
    query,
  };
}

describe('Bitcoin host validation', () => {
  it('uses the shared keypath parser', async () => {
    const { bitbox, query } = paired();
    await expect(bitbox.btcXpub('btc', 'not-a-keypath', 'xpub', false))
      .rejects.toMatchObject({ code: 'keypath-parse' });
    await expect(bitbox.btcAddress(
      'btc',
      'also-not-a-keypath',
      { simpleType: 'p2wpkh' },
      false,
    )).rejects.toMatchObject({ code: 'keypath-parse' });
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps invalid BTC discriminants on the invalid-type surface', async () => {
    const { bitbox, query } = paired();
    await expect(bitbox.btcXpub(
      'doge' as 'btc',
      "m/84'/0'/0'",
      'xpub',
      false,
    )).rejects.toMatchObject({ code: 'invalid-type' });
    await expect(bitbox.btcAddress(
      'btc',
      "m/84'/0'/0'/0/0",
      { simpleType: 'legacy' as 'p2wpkh' },
      false,
    )).rejects.toMatchObject({ code: 'invalid-type' });
    expect(query).not.toHaveBeenCalled();
  });

  it('validates the coin in the legacy xpubs fallback with no keypaths', async () => {
    const { bitbox, query } = paired('9.23.0');
    await expect(bitbox.btcXpubs('doge' as 'btc', [], 'xpub'))
      .rejects.toMatchObject({ code: 'invalid-type' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects non-xpub/tpub versions in script configs', async () => {
    const { bitbox, query } = paired();
    await expect(bitbox.btcAddress(
      'btc',
      "m/48'/0'/0'/2'/0/0",
      {
        multisig: {
          threshold: 1,
          xpubs: [
            'ypub6WqXiL3fbDK5QNPe3hN4uSVkEvuE8wXoNCcecgggSuKVpU3Kc4fTvhuLgUhtnbAdaTb9gpz5PQdvzcsKPTLgW2CPkF5ZNRzQeKFT4NSc1xN',
          ],
          ourXpubIndex: 0,
          scriptType: 'p2wsh',
        },
      },
      false,
    )).rejects.toMatchObject({ code: 'invalid-type' });
    expect(query).not.toHaveBeenCalled();
  });

  it('parses the PSBT before applying the firmware gate', async () => {
    const { bitbox, query } = paired('9.14.0');
    await expect(bitbox.btcSignPSBT('btc', 'not a PSBT', undefined, 'default'))
      .rejects.toMatchObject({ code: 'psbt-parse' });
    await expect(bitbox.btcSignPSBT('btc', validPsbt, undefined, 'default'))
      .rejects.toMatchObject({
        code: 'version',
        message: 'firmware version >=9.15.0 required',
      });
    expect(query).not.toHaveBeenCalled();
  });

  it('validates PSBT options before querying the device', async () => {
    const { bitbox, query } = paired();
    await expect(bitbox.btcSignPSBT(
      'doge' as 'btc',
      validPsbt,
      undefined,
      'default',
    )).rejects.toMatchObject({ code: 'invalid-type' });
    await expect(bitbox.btcSignPSBT(
      'btc',
      validPsbt,
      undefined,
      'bits' as 'default',
    )).rejects.toMatchObject({ code: 'invalid-type' });
    await expect(bitbox.btcSignPSBT(
      'btc',
      validPsbt,
      { scriptConfig: { simpleType: 'legacy' as 'p2wpkh' }, keypath: [] },
      'default',
    )).rejects.toMatchObject({ code: 'invalid-type' });
    expect(query).not.toHaveBeenCalled();
  });

  it('gates message signing before querying the device', async () => {
    const { bitbox, query } = paired('9.4.9');
    await expect(bitbox.btcSignMessage(
      'btc',
      {
        scriptConfig: { simpleType: 'p2wpkh' },
        keypath: "m/84'/0'/0'/0/0",
      },
      new TextEncoder().encode('message'),
    )).rejects.toMatchObject({
      code: 'version',
      message: 'firmware version >=9.5.0 required',
    });
    expect(query).not.toHaveBeenCalled();
  });
});
