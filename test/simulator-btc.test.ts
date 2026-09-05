// SPDX-License-Identifier: Apache-2.0

import { bytesToHex, concatBytes } from '@noble/hashes/utils';
import {
  crypto as bitcoinCrypto,
  initEccLib,
  networks,
  payments,
  Psbt,
  script as bitcoinScript,
  Transaction as BitcoinTransaction,
} from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PairedBitBox,
  type BtcScriptConfig,
  type BtcScriptConfigWithKeypath,
  type Error as BitBoxError,
} from '../src/index.js';
import { connectSimulator } from '../src/internal/connect-simulator.js';
import { atLeast, parseSemver } from '../src/internal/hww.js';
import { NoiseConfigNoCache } from '../src/internal/noise-config.js';
import { completePairing, performHandshake } from '../src/internal/pairing.js';
import { restoreFromMnemonic } from '../src/internal/restore.js';
import {
  SimulatorServer,
  ensureSimulator,
  simulatorCases,
  simulatorSupported,
  type SimulatorScreen,
} from './simulator-util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
initEccLib(ecc);
const vectorFile = JSON.parse(readFileSync(
  path.join(__dirname, 'data/btc-transaction-test-vectors.json'),
  'utf8',
)) as TestVectorFile;

const ENABLED = simulatorSupported() && process.env.SKIP_SIMULATOR !== '1';
type Semver = ReturnType<typeof parseSemver>;

type VectorScriptConfig =
  | { type: 'simple'; script_type: 'p2wpkh' | 'p2wpkh_p2sh' | 'p2tr' }
  | {
    type: 'multisig';
    threshold: number;
    xpubs: string[];
    our_xpub_index: number;
    script_type: 'p2wsh' | 'p2wsh_p2sh';
  }
  | {
    type: 'policy';
    policy: string;
    keys: {
      root_fingerprint?: string;
      keypath?: string;
      xpub: string;
    }[];
  };

type SignatureSlot = {
  input_index: number;
  kind: 'ecdsa' | 'taproot_key' | 'taproot_script';
  pubkey?: string;
  leaf_hash?: string;
  sighash: 'all' | 'default';
};

type VectorScreen = SimulatorScreen & { longtouch?: boolean };

interface VersionExpectation {
  min_version?: string;
  max_version_exclusive?: string;
  outcome: 'success' | 'unsupported' | 'invalid_input';
  unsupported_version?: string;
  screens: VectorScreen[];
}

interface TestVector {
  id: string;
  description: string;
  coin: 'btc' | 'tbtc' | 'ltc';
  psbt: {
    transaction: string;
    options?: {
      force_script_config?: {
        script_config: VectorScriptConfig;
        keypath: string;
      };
      outputs?: Record<string, unknown>;
      payment_requests?: unknown[];
      format_unit?: 'default' | 'sat';
    };
  };
  expectations: VersionExpectation[];
  registrations?: {
    script_config: VectorScriptConfig;
    keypath?: string;
    name: string;
  }[];
  expected_signatures?: SignatureSlot[];
}

interface TestVectorFile {
  vectors: TestVector[];
}

async function connectRestored(): Promise<PairedBitBox> {
  const session = await connectSimulator(undefined, undefined, new NoiseConfigNoCache());
  try {
    const pairing = await performHandshake(session.hww, session.config);
    const channel = await completePairing(pairing);
    await restoreFromMnemonic(channel);
    return new PairedBitBox({ channel, info: session.hww.info, close: session.close });
  } catch (error) {
    session.close();
    throw error;
  }
}

function bitcoinMessageHash(message: Uint8Array): Uint8Array {
  // bitcoinjs-lib does not include the legacy signed-message hash helper.
  if (message.length >= 0xfd) {
    throw new Error('test message is too long for a one-byte CompactSize');
  }
  return bitcoinCrypto.hash256(concatBytes(
    new TextEncoder().encode(networks.bitcoin.messagePrefix),
    Uint8Array.of(message.length),
    message,
  ));
}

function scriptConfig(config: VectorScriptConfig): BtcScriptConfig {
  switch (config.type) {
    case 'simple':
      return {
        simpleType: {
          p2wpkh: 'p2wpkh',
          p2wpkh_p2sh: 'p2wpkhP2sh',
          p2tr: 'p2tr',
        }[config.script_type] as 'p2wpkh' | 'p2wpkhP2sh' | 'p2tr',
      };
    case 'multisig':
      return {
        multisig: {
          threshold: config.threshold,
          xpubs: config.xpubs,
          ourXpubIndex: config.our_xpub_index,
          scriptType: config.script_type === 'p2wsh' ? 'p2wsh' : 'p2wshP2sh',
        },
      };
    case 'policy':
      return {
        policy: {
          policy: config.policy,
          keys: config.keys.map(key => ({
            xpub: key.xpub,
            ...(key.root_fingerprint === undefined
              ? {}
              : { rootFingerprint: key.root_fingerprint }),
            ...(key.keypath === undefined ? {} : { keypath: key.keypath }),
          })),
        },
      };
  }
}

function scriptConfigWithKeypath(
  config: NonNullable<TestVector['psbt']['options']>['force_script_config'],
): BtcScriptConfigWithKeypath | undefined {
  if (config === undefined) {
    return undefined;
  }
  return { scriptConfig: scriptConfig(config.script_config), keypath: config.keypath };
}

function expectationFor(
  expectations: VersionExpectation[],
  version: Semver,
): VersionExpectation | undefined {
  return expectations.find((expectation) => {
    const afterMinimum = expectation.min_version === undefined ||
      atLeast(version, parseSemver(expectation.min_version));
    const beforeMaximum = expectation.max_version_exclusive === undefined ||
      !atLeast(version, parseSemver(expectation.max_version_exclusive));
    return afterMinimum && beforeMaximum;
  });
}

function expectedScreens(screens: VectorScreen[]): SimulatorScreen[] {
  return screens.map(({ longtouch: _longtouch, ...screen }) => screen);
}

function signatureSlots(psbt: Psbt): SignatureSlot[] {
  const slots: SignatureSlot[] = [];
  psbt.data.inputs.forEach((input, inputIndex) => {
    for (const partialSig of input.partialSig ?? []) {
      const decoded = bitcoinScript.signature.decode(partialSig.signature);
      slots.push({
        input_index: inputIndex,
        kind: 'ecdsa',
        pubkey: bytesToHex(partialSig.pubkey),
        sighash: decoded.hashType === BitcoinTransaction.SIGHASH_ALL ? 'all' : 'default',
      });
    }
    if (input.tapKeySig !== undefined) {
      slots.push({
        input_index: inputIndex,
        kind: 'taproot_key',
        ...(input.tapInternalKey === undefined
          ? {}
          : { pubkey: bytesToHex(input.tapInternalKey) }),
        sighash: input.tapKeySig.length === 64 ? 'default' : 'all',
      });
    }
    for (const tapScriptSig of input.tapScriptSig ?? []) {
      slots.push({
        input_index: inputIndex,
        kind: 'taproot_script',
        pubkey: bytesToHex(tapScriptSig.pubkey),
        leaf_hash: bytesToHex(tapScriptSig.leafHash),
        sighash: tapScriptSig.signature.length === 64 ? 'default' : 'all',
      });
    }
  });
  return slots.sort((left, right) => slotKey(left).localeCompare(slotKey(right)));
}

function slotKey(slot: SignatureSlot): string {
  return [
    slot.input_index,
    slot.kind,
    slot.pubkey ?? '',
    slot.leaf_hash ?? '',
    slot.sighash,
  ].join(':');
}

function assertSignatureInsertions(
  vector: TestVector,
  before: SignatureSlot[],
  after: SignatureSlot[],
): void {
  const beforeKeys = new Set(before.map(slotKey));
  const afterKeys = new Set(after.map(slotKey));
  for (const key of beforeKeys) {
    expect(afterKeys.has(key), `${vector.id}: signing removed a signature slot`).toBe(true);
  }
  const inserted = after.filter(slot => !beforeKeys.has(slotKey(slot)));
  const expected = [...(vector.expected_signatures ?? [])]
    .sort((left, right) => slotKey(left).localeCompare(slotKey(right)));
  expect(inserted, `${vector.id}: inserted signature slots differ`).toEqual(expected);
}

function verifyAndFinalize(vector: TestVector, signed: Psbt): void {
  const fundingOutputs = signed.data.inputs.map((input, inputIndex) => {
    if (input.witnessUtxo !== undefined) {
      return input.witnessUtxo;
    }
    if (input.nonWitnessUtxo === undefined) {
      throw new Error(`${vector.id}: input ${inputIndex} has no funding output`);
    }
    const output = BitcoinTransaction.fromBuffer(input.nonWitnessUtxo)
      .outs[signed.txInputs[inputIndex]!.index];
    if (output === undefined) {
      throw new Error(`${vector.id}: funding output index is out of bounds`);
    }
    return output;
  });
  expect(signed.validateSignaturesOfAllInputs((pubkey, hash, signature) =>
    pubkey.length === 32
      ? ecc.verifySchnorr(hash, pubkey, signature)
      : ecc.verify(hash, pubkey, signature),
  ), `${vector.id}: transaction signature is invalid`).toBe(true);

  const finalized = signed.clone();
  signed.data.inputs.forEach((input, inputIndex) => {
    if (input.witnessUtxo === undefined) {
      finalized.updateInput(inputIndex, { witnessUtxo: fundingOutputs[inputIndex]! });
    }
  });
  try {
    finalized.finalizeAllInputs();
  } catch (error) {
    // bitcoinjs-lib has no miniscript satisfier. Signatures above are still checked
    // cryptographically for policy vectors that it cannot finalize.
    if (vector.psbt.options?.force_script_config?.script_config.type === 'policy') {
      return;
    }
    throw error;
  }
  const transaction = finalized.extractTransaction(true);
  expect(transaction.ins).toHaveLength(signed.txInputs.length);
  expect(transaction.outs).toHaveLength(signed.txOutputs.length);
  for (const input of transaction.ins) {
    expect(input.script.length > 0 || input.witness.length > 0).toBe(true);
  }
}

function shouldSkip(vector: TestVector): boolean {
  const outputs = vector.psbt.options?.outputs ?? {};
  const paymentRequests = vector.psbt.options?.payment_requests ?? [];
  return Object.keys(outputs).length > 0 || paymentRequests.length > 0;
}

async function registerScriptConfigs(
  bitbox: PairedBitBox,
  vector: TestVector,
): Promise<void> {
  for (const registration of vector.registrations ?? []) {
    const config = scriptConfig(registration.script_config);
    const registered = await bitbox.btcIsScriptConfigRegistered(
      vector.coin,
      config,
      registration.keypath,
    );
    if (!registered) {
      await bitbox.btcRegisterScriptConfig(
        vector.coin,
        config,
        registration.keypath,
        'autoXpubTpub',
        registration.name,
      );
    }
  }
}

function assertUnsupported(
  vector: TestVector,
  version: Semver,
  expectation: VersionExpectation,
  error: BitBoxError,
): void {
  const minimum = expectation.unsupported_version;
  expect(minimum, `${vector.id}: missing unsupported firmware version`).toBeDefined();
  expect(atLeast(version, parseSemver(minimum!))).toBe(false);
  expect(
    ['version', 'bitbox-invalid-input', 'bitbox-disabled'],
    `${vector.id}: unexpected unsupported error ${error.code}`,
  ).toContain(error.code);
}

async function runVector(
  bitbox: PairedBitBox,
  server: SimulatorServer,
  vector: TestVector,
): Promise<void> {
  const version = parseSemver(bitbox.version());
  const expectation = expectationFor(vector.expectations, version);
  if (expectation === undefined) {
    const firstMinimum = vector.expectations[0]?.min_version;
    if (firstMinimum !== undefined && !atLeast(version, parseSemver(firstMinimum))) {
      return;
    }
    throw new Error(`no vector expectation matches firmware ${bitbox.version()}`);
  }
  const original = Psbt.fromHex(vector.psbt.transaction);
  const base64 = original.toBase64();
  const before = signatureSlots(original);

  const setupCheckpoint = server.stdout.checkpoint();
  let setupError: BitBoxError | undefined;
  try {
    await registerScriptConfigs(bitbox, vector);
  } catch (error) {
    setupError = error as BitBoxError;
  }
  await server.stdout.waitUntilStable(setupCheckpoint);
  if (setupError !== undefined) {
    if (expectation.outcome === 'unsupported') {
      assertUnsupported(vector, version, expectation, setupError);
    } else if (expectation.outcome === 'invalid_input') {
      expect(setupError.code).toBe('bitbox-invalid-input');
    } else {
      throw setupError;
    }
    expect(expectedScreens(expectation.screens)).toEqual([]);
    expect(signatureSlots(original)).toEqual(before);
    return;
  }

  const transactionCheckpoint = server.stdout.checkpoint();
  let signedBase64: string | undefined;
  let signError: BitBoxError | undefined;
  try {
    signedBase64 = await bitbox.btcSignPSBT(
      vector.coin,
      base64,
      scriptConfigWithKeypath(vector.psbt.options?.force_script_config),
      vector.psbt.options?.format_unit ?? 'default',
    );
  } catch (error) {
    signError = error as BitBoxError;
  }
  const snapshot = expectation.outcome === 'success'
    ? await server.stdout.waitForTerminalScreen(transactionCheckpoint)
    : await server.stdout.waitUntilStable(transactionCheckpoint);
  const actualScreens = snapshot.screens();
  if (process.env.UPDATE_BTC_VECTOR_SCREENS === '1') {
    process.stdout.write(
      `screens for ${vector.id} on firmware ${bitbox.version()}: ${JSON.stringify(actualScreens)}\n`,
    );
  } else {
    expect(actualScreens, `${vector.id}: simulator screens differ`).toEqual(
      expectedScreens(expectation.screens),
    );
  }

  switch (expectation.outcome) {
    case 'success': {
      if (signError !== undefined || signedBase64 === undefined) {
        throw signError ?? new Error(`${vector.id}: signing returned no PSBT`);
      }
      const signed = Psbt.fromBase64(signedBase64);
      assertSignatureInsertions(vector, before, signatureSlots(signed));
      verifyAndFinalize(vector, signed);
      break;
    }
    case 'unsupported':
      expect(signError).toBeDefined();
      assertUnsupported(vector, version, expectation, signError!);
      expect(signatureSlots(original)).toEqual(before);
      break;
    case 'invalid_input':
      expect(signError?.code).toBe('bitbox-invalid-input');
      expect(signatureSlots(original)).toEqual(before);
      break;
  }
}

describe.skipIf(!ENABLED).sequential.each(simulatorCases())('simulator BTC $name', (simulator) => {
  let server: SimulatorServer | undefined;
  let binary = '';

  beforeAll(async () => {
    binary = await ensureSimulator(simulator);
  }, 120_000);

  beforeEach(() => {
    server = new SimulatorServer(binary);
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  }, 30_000);

  it('supports xpubs, addresses, and message signing', async () => {
    const bitbox = await connectRestored();
    try {
      await expect(bitbox.btcXpub(
        'tbtc',
        "m/49'/1'/0'",
        'ypub',
        false,
      )).resolves.toBe(
        'ypub6WqXiL3fbDK5QNPe3hN4uSVkEvuE8wXoNCcecgggSuKVpU3Kc4fTvhuLgUhtnbAdaTb9gpz5PQdvzcsKPTLgW2CPkF5ZNRzQeKFT4NSc1xN',
      );

      await expect(bitbox.btcXpubs(
        'tbtc',
        ["m/49'/1'/0'", "m/84'/1'/0'", "m/86'/1'/0'"],
        'tpub',
      )).resolves.toEqual([
        'tpubDCNtvuCS9oj3psPNfXZXuGjcQ5rSBi3MzigjBqqwQohWWetoRdLzT5v2uJq6KBTwxj1FYvuPTr7RoWkN4cmubDy5wW8SU3q9xYnDRpQepiT',
        'tpubDCYNsKenq7Cuuf4fHsu2fsWA7Wb5cTD2qRUrw6uHbNNYQoNkEoJk4hgNhxbnGss5gnEe2MpqN2qbRVqWJGmuofAWmwFFi4CZ9Tg1LHKJDhF',
        'tpubDDc6eecoyYxL4g3WKYpbbinyUmnfVikQCzHTPd6rJQivaPqGKBFiueQqWoAYonB8hAEXGM1ak7LqrnwczH24EbW7jbG5bNK5rncmRXtv7nG',
      ]);

      await expect(bitbox.btcAddress(
        'tbtc',
        "m/84'/1'/0'/1/10",
        { simpleType: 'p2wpkh' },
        false,
      )).resolves.toBe('tb1qq064dxjgl9h9wzgsmzy6t6306qew42w9ka02u3');

      const messageKeypath = "m/49'/0'/0'/0/10";
      const messageAddress = await bitbox.btcAddress(
        'btc',
        messageKeypath,
        { simpleType: 'p2wpkhP2sh' },
        false,
      );
      const message = new TextEncoder().encode('message');
      const signature = await bitbox.btcSignMessage(
        'btc',
        {
          scriptConfig: { simpleType: 'p2wpkhP2sh' },
          keypath: messageKeypath,
        },
        message,
      );
      const messageHash = bitcoinMessageHash(message);
      const compactSignature = Uint8Array.from(signature.sig);
      const publicKey = ecc.recover(
        messageHash,
        compactSignature,
        signature.recid as ecc.RecoveryIdType,
        true,
      );
      if (publicKey === null) {
        throw new Error('failed to recover Bitcoin message signing key');
      }
      expect(ecc.verify(
        messageHash,
        publicKey,
        compactSignature,
      )).toBe(true);
      expect(payments.p2sh({
        redeem: payments.p2wpkh({ pubkey: publicKey }),
      }).address).toBe(messageAddress);
      expect(signature.electrumSig65).toEqual([
        31 + signature.recid,
        ...signature.sig,
      ]);
    } finally {
      bitbox.close();
    }
  }, 60_000);

  it('signs the firmware BTC transaction vectors', async () => {
    const bitbox = await connectRestored();
    try {
      await server!.stdout.waitUntilStable(server!.stdout.checkpoint());
      for (const vector of vectorFile.vectors) {
        if (!shouldSkip(vector)) {
          await runVector(bitbox, server!, vector);
        }
      }
    } finally {
      bitbox.close();
    }
  }, 15 * 60_000);
});
