// SPDX-License-Identifier: Apache-2.0

import { equals } from '@bufbuild/protobuf';
import {
  opcodes,
  payments,
  type PaymentCreator,
  Psbt,
  script as bitcoinScript,
  Transaction as BitcoinTransaction,
} from 'bitcoinjs-lib';
import {
  BTCOutputType,
  BTCScriptConfig_SimpleType,
  BTCScriptConfigWithKeypathSchema,
  type BTCScriptConfigWithKeypath,
} from '../../proto/gen/btc_pb.js';
import {
  CODE_PSBT_INVALID_ACCOUNT_KEYPATH,
  CODE_PSBT_INVALID_OP_RETURN,
  CODE_PSBT_KEY_NOT_FOUND,
  CODE_PSBT_KEY_NOT_UNIQUE,
  CODE_PSBT_SIGN_ERROR,
  CODE_PSBT_UNKNOWN_OUTPUT_TYPE,
  btcSignError,
  psbtError,
  psbtParseError,
} from '../errors.js';
import type { Info } from '../hww.js';
import { atLeast, parseSemver } from '../hww.js';
import { HARDENED, parseKeypath } from '../keypath.js';
import { hexToBytes } from '../utils.js';
import { makeSimpleScriptConfigWithKeypath } from './config.js';

type PsbtInput = Psbt['data']['inputs'][number];
type PsbtOutput = Psbt['data']['outputs'][number];

const HASH_PAYMENTS: [PaymentCreator, BTCOutputType][] = [
  [payments.p2pkh, BTCOutputType.P2PKH],
  [payments.p2sh, BTCOutputType.P2SH],
  [payments.p2wpkh, BTCOutputType.P2WPKH],
  [payments.p2wsh, BTCOutputType.P2WSH],
];

export type OurKey =
  | { kind: 'segwit'; pubkey: Uint8Array; keypath: number[] }
  | { kind: 'taprootInternal'; keypath: number[] }
  | {
    kind: 'taprootScript';
    pubkey: Uint8Array;
    leafHash: Uint8Array;
    keypath: number[];
  };

export type PrevTx = {
  version: number;
  inputs: {
    prevOutHash: Uint8Array;
    prevOutIndex: number;
    signatureScript: Uint8Array;
    sequence: number;
  }[];
  outputs: { value: bigint; pubkeyScript: Uint8Array }[];
  locktime: number;
};

export type TxInput = {
  prevOutHash: Uint8Array;
  prevOutIndex: number;
  prevOutValue: bigint;
  sequence: number;
  keypath: number[];
  scriptConfigIndex: number;
  prevTx?: PrevTx;
};

export type TxOutput =
  | {
    kind: 'internal';
    keypath: number[];
    value: bigint;
    scriptConfigIndex: number;
  }
  | {
    kind: 'external';
    payload: Uint8Array;
    outputType: BTCOutputType;
    value: bigint;
  };

export type Transaction = {
  scriptConfigs: BTCScriptConfigWithKeypath[];
  version: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  locktime: number;
};

export type PreparedPsbt = {
  psbt: Psbt;
  transaction: Transaction;
  ourKeys: OurKey[];
  outputScriptConfigs: BTCScriptConfigWithKeypath[];
  outputScriptConfigIndices: (number | undefined)[];
};

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
}

function derivationPath(path: string): number[] {
  return path === 'm' ? [] : parseKeypath(path);
}

function findOurKey(
  ourRootFingerprint: Uint8Array,
  outputInfo: PsbtInput | PsbtOutput,
): OurKey {
  for (const derivation of outputInfo.tapBip32Derivation ?? []) {
    if (!bytesEqual(derivation.masterFingerprint, ourRootFingerprint)) {
      continue;
    }
    // TODO: check for fingerprint collision.
    const keypath = derivationPath(derivation.path);
    if (
      outputInfo.tapInternalKey !== undefined &&
      bytesEqual(outputInfo.tapInternalKey, derivation.pubkey)
    ) {
      if (derivation.leafHashes.length !== 0) {
        // We do not support the same key as both the internal key and a leaf key.
        throw psbtError(
          CODE_PSBT_KEY_NOT_UNIQUE,
          'Taproot pubkeys must be unique across the internal key and all leaf scripts.',
        );
      }
      return { kind: 'taprootInternal', keypath };
    }
    // BIP-388 makes pubkeys unique, so our key cannot occur in multiple leaves.
    if (derivation.leafHashes.length !== 1) {
      throw psbtError(
        CODE_PSBT_KEY_NOT_UNIQUE,
        'Taproot pubkeys must be unique across the internal key and all leaf scripts.',
      );
    }
    return {
      kind: 'taprootScript',
      pubkey: derivation.pubkey,
      leafHash: derivation.leafHashes[0]!,
      keypath,
    };
  }

  for (const derivation of outputInfo.bip32Derivation ?? []) {
    if (bytesEqual(derivation.masterFingerprint, ourRootFingerprint)) {
      // TODO: check for fingerprint collision.
      return {
        kind: 'segwit',
        pubkey: derivation.pubkey,
        keypath: derivationPath(derivation.path),
      };
    }
  }
  throw psbtError(CODE_PSBT_KEY_NOT_FOUND, 'Could not find our key in an input.');
}

function paymentHash(
  payment: PaymentCreator,
  script: Uint8Array,
): Uint8Array | undefined {
  try {
    return payment({ output: script }).hash;
  } catch {
    return undefined;
  }
}

function p2trPayload(script: Uint8Array): Uint8Array | undefined {
  // Parsing a p2tr payment otherwise requires bitcoinjs-lib's optional ECC backend.
  const chunks = bitcoinScript.decompile(script);
  if (
    chunks?.length === 2 &&
    chunks[0] === opcodes.OP_1 &&
    chunks[1] instanceof Uint8Array &&
    chunks[1].length === 32 &&
    bytesEqual(bitcoinScript.compile(chunks), script)
  ) {
    return chunks[1];
  }
  return undefined;
}

function invalidOpReturn(detail: string): never {
  throw psbtError(CODE_PSBT_INVALID_OP_RETURN, `Invalid OP_RETURN script: ${detail}`);
}

function readOpReturnPush(script: Uint8Array): Uint8Array {
  const chunks = bitcoinScript.decompile(script);
  if (chunks === null) {
    return invalidOpReturn('failed to parse OP_RETURN payload');
  }
  if (chunks.length === 1) {
    return invalidOpReturn('naked OP_RETURN is not supported');
  }
  if (chunks.length !== 2) {
    return invalidOpReturn('only one data push supported after OP_RETURN');
  }
  let canonical: Uint8Array;
  try {
    canonical = bitcoinScript.compile(chunks);
  } catch {
    return invalidOpReturn('failed to parse OP_RETURN payload');
  }
  if (!bytesEqual(canonical, script)) {
    return invalidOpReturn('failed to parse OP_RETURN payload');
  }
  const payload = chunks[1];
  if (payload === opcodes.OP_0) {
    return new Uint8Array();
  }
  if (!(payload instanceof Uint8Array)) {
    return invalidOpReturn('no data push found after OP_RETURN');
  }
  return payload;
}

export function payloadFromPkscript(
  script: Uint8Array,
): { data: Uint8Array; outputType: BTCOutputType } {
  for (const [payment, outputType] of HASH_PAYMENTS) {
    const data = paymentHash(payment, script);
    if (data !== undefined) {
      return { data, outputType };
    }
  }
  const p2tr = p2trPayload(script);
  if (p2tr !== undefined) {
    return { data: p2tr, outputType: BTCOutputType.P2TR };
  }
  const chunks = bitcoinScript.decompile(script);
  if (chunks?.[0] === opcodes.OP_RETURN) {
    const payload = readOpReturnPush(script);
    return { data: payload, outputType: BTCOutputType.OP_RETURN };
  }
  throw psbtError(
    CODE_PSBT_UNKNOWN_OUTPUT_TYPE,
    'Unrecognized/unsupported output type.',
  );
}

function hardenedPrefix(keypath: number[]): number[] {
  const firstUnhardened = keypath.findIndex(element => element < HARDENED);
  return keypath.slice(0, firstUnhardened === -1 ? undefined : firstUnhardened);
}

function scriptConfigFromUtxo(
  script: Uint8Array,
  keypath: number[],
  redeemScript: Uint8Array | undefined,
): BTCScriptConfigWithKeypath {
  const accountKeypath = hardenedPrefix(keypath);
  if (paymentHash(payments.p2wpkh, script) !== undefined) {
    return makeSimpleScriptConfigWithKeypath(
      BTCScriptConfig_SimpleType.P2WPKH,
      accountKeypath,
    );
  }
  if (
    paymentHash(payments.p2sh, script) !== undefined &&
    redeemScript !== undefined &&
    paymentHash(payments.p2wpkh, redeemScript) !== undefined
  ) {
    return makeSimpleScriptConfigWithKeypath(
      BTCScriptConfig_SimpleType.P2WPKH_P2SH,
      accountKeypath,
    );
  }
  if (p2trPayload(script) !== undefined) {
    return makeSimpleScriptConfigWithKeypath(
      BTCScriptConfig_SimpleType.P2TR,
      accountKeypath,
    );
  }
  // Multisig and policy configs cannot currently be inferred and must be forced.
  throw psbtError(
    CODE_PSBT_UNKNOWN_OUTPUT_TYPE,
    'Unrecognized/unsupported output type.',
  );
}

function parseTransaction(raw: Uint8Array): BitcoinTransaction {
  try {
    return BitcoinTransaction.fromBuffer(raw);
  } catch (error) {
    throw psbtError(
      CODE_PSBT_SIGN_ERROR,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function previousTransaction(transaction: BitcoinTransaction): PrevTx {
  return {
    version: transaction.version >>> 0,
    inputs: transaction.ins.map(input => ({
      prevOutHash: input.hash,
      prevOutIndex: input.index,
      signatureScript: input.script,
      sequence: input.sequence,
    })),
    outputs: transaction.outs.map(output => ({
      value: output.value,
      pubkeyScript: output.script,
    })),
    locktime: transaction.locktime,
  };
}

function spendUtxo(
  inputIndex: number,
  txInput: Psbt['txInputs'][number],
  psbtInput: PsbtInput,
  previous: BitcoinTransaction | undefined,
): { value: bigint; script: Uint8Array } {
  if (psbtInput.witnessUtxo !== undefined) {
    return psbtInput.witnessUtxo;
  }
  if (previous === undefined) {
    throw psbtError(CODE_PSBT_SIGN_ERROR, 'missing spend utxo in PSBT');
  }
  if (!bytesEqual(previous.getHash(), txInput.hash)) {
    throw psbtError(
      CODE_PSBT_SIGN_ERROR,
      `non-witness UTXO hash for input ${inputIndex} does not match the prevout`,
    );
  }
  const output = previous.outs[txInput.index];
  if (output === undefined) {
    throw psbtError(CODE_PSBT_SIGN_ERROR, 'previous output index is out of bounds');
  }
  return output;
}

function isSimpleScriptConfig(config: BTCScriptConfigWithKeypath): boolean {
  return config.scriptConfig?.config.case === 'simpleType';
}

function isSameAccount(
  inputScriptConfigs: BTCScriptConfigWithKeypath[],
  outputScriptConfig: BTCScriptConfigWithKeypath,
): boolean {
  for (const inputScriptConfig of inputScriptConfigs) {
    if (isSimpleScriptConfig(inputScriptConfig)) {
      const inputAccount = inputScriptConfig.keypath[2];
      const outputAccount = outputScriptConfig.keypath[2];
      if (inputAccount === undefined || outputAccount === undefined) {
        throw psbtError(
          CODE_PSBT_INVALID_ACCOUNT_KEYPATH,
          'Account script configs must contain a BIP44 account keypath.',
        );
      }
      if (inputAccount !== outputAccount) {
        return false;
      }
    } else if (
      !equals(
        BTCScriptConfigWithKeypathSchema,
        inputScriptConfig,
        outputScriptConfig,
      )
    ) {
      return false;
    }
  }
  return true;
}

function findOrAddScriptConfig(
  configs: BTCScriptConfigWithKeypath[],
  config: BTCScriptConfigWithKeypath,
): number {
  const index = configs.findIndex(existing =>
    equals(BTCScriptConfigWithKeypathSchema, existing, config));
  if (index !== -1) {
    return index;
  }
  configs.push(config);
  return configs.length - 1;
}

export function parsePsbt(value: string): Psbt {
  try {
    return Psbt.fromBase64(value);
  } catch (error) {
    throw psbtParseError(error instanceof Error ? error.message : String(error));
  }
}

export function preparePsbt(
  info: Info,
  rootFingerprint: string,
  psbt: Psbt,
  forcedScriptConfig: BTCScriptConfigWithKeypath | undefined,
): PreparedPsbt {
  const ourRootFingerprint = hexToBytes(rootFingerprint);
  const isScriptConfigForced = forcedScriptConfig !== undefined;
  const scriptConfigs = forcedScriptConfig === undefined ? [] : [forcedScriptConfig];
  const outputScriptConfigs: BTCScriptConfigWithKeypath[] = [];
  const supportsSeparateOutputConfigs = atLeast(
    parseSemver(info.version),
    { major: 9, minor: 22, patch: 0 },
  );
  const ourKeys: OurKey[] = [];
  const inputs: TxInput[] = [];

  for (let inputIndex = 0; inputIndex < psbt.txInputs.length; inputIndex += 1) {
    const txInput = psbt.txInputs[inputIndex]!;
    const psbtInput = psbt.data.inputs[inputIndex]!;
    const previous = psbtInput.nonWitnessUtxo === undefined
      ? undefined
      : parseTransaction(psbtInput.nonWitnessUtxo);
    const utxo = spendUtxo(inputIndex, txInput, psbtInput, previous);
    const ourKey = findOurKey(ourRootFingerprint, psbtInput);
    const scriptConfigIndex = isScriptConfigForced
      ? 0
      : findOrAddScriptConfig(
        scriptConfigs,
        scriptConfigFromUtxo(utxo.script, ourKey.keypath, psbtInput.redeemScript),
      );
    inputs.push({
      prevOutHash: txInput.hash,
      prevOutIndex: txInput.index,
      prevOutValue: utxo.value,
      sequence: txInput.sequence ?? BitcoinTransaction.DEFAULT_SEQUENCE,
      keypath: ourKey.keypath,
      scriptConfigIndex,
      ...(previous === undefined ? {} : { prevTx: previousTransaction(previous) }),
    });
    ourKeys.push(ourKey);
  }

  const outputs: TxOutput[] = [];
  const outputScriptConfigIndices: (number | undefined)[] = [];
  for (let outputIndex = 0; outputIndex < psbt.txOutputs.length; outputIndex += 1) {
    const txOutput = psbt.txOutputs[outputIndex]!;
    const psbtOutput = psbt.data.outputs[outputIndex]!;
    let ourKey: OurKey | undefined;
    try {
      ourKey = findOurKey(ourRootFingerprint, psbtOutput);
    } catch {
      // Missing output key origin information means this is an external output.
    }
    if (ourKey === undefined) {
      const payload = payloadFromPkscript(txOutput.script);
      outputs.push({
        kind: 'external',
        payload: payload.data,
        outputType: payload.outputType,
        value: txOutput.value,
      });
      outputScriptConfigIndices.push(undefined);
      continue;
    }

    const scriptConfig = isScriptConfigForced
      ? scriptConfigs[0]!
      : scriptConfigFromUtxo(
        txOutput.script,
        ourKey.keypath,
        psbtOutput.redeemScript,
      );
    if (isSameAccount(scriptConfigs, scriptConfig)) {
      outputs.push({
        kind: 'internal',
        keypath: ourKey.keypath,
        value: txOutput.value,
        scriptConfigIndex: findOrAddScriptConfig(scriptConfigs, scriptConfig),
      });
      outputScriptConfigIndices.push(undefined);
    } else if (supportsSeparateOutputConfigs) {
      outputs.push({
        kind: 'internal',
        keypath: ourKey.keypath,
        value: txOutput.value,
        scriptConfigIndex: 0,
      });
      outputScriptConfigIndices.push(
        findOrAddScriptConfig(outputScriptConfigs, scriptConfig),
      );
    } else {
      const payload = payloadFromPkscript(txOutput.script);
      outputs.push({
        kind: 'external',
        payload: payload.data,
        outputType: payload.outputType,
        value: txOutput.value,
      });
      outputScriptConfigIndices.push(undefined);
    }
  }

  return {
    psbt,
    transaction: {
      scriptConfigs,
      version: psbt.version >>> 0,
      inputs,
      outputs,
      locktime: psbt.locktime,
    },
    ourKeys,
    outputScriptConfigs,
    outputScriptConfigIndices,
  };
}

export function addSignatures(
  prepared: PreparedPsbt,
  signatures: Uint8Array[],
): string {
  if (signatures.length !== prepared.ourKeys.length) {
    throw btcSignError('signature count must match transaction inputs');
  }
  signatures.forEach((signature, inputIndex) => {
    const input = prepared.psbt.data.inputs[inputIndex]!;
    const ourKey = prepared.ourKeys[inputIndex]!;
    switch (ourKey.kind) {
      case 'segwit': {
        input.partialSig = [
          ...(input.partialSig ?? []).filter(item => !bytesEqual(item.pubkey, ourKey.pubkey)),
          {
            pubkey: ourKey.pubkey,
            signature: bitcoinScript.signature.encode(
              signature,
              BitcoinTransaction.SIGHASH_ALL,
            ),
          },
        ];
        break;
      }
      case 'taprootInternal':
        input.tapKeySig = signature;
        break;
      case 'taprootScript':
        input.tapScriptSig = [
          ...(input.tapScriptSig ?? []).filter(item =>
            !(
              bytesEqual(item.pubkey, ourKey.pubkey) &&
              bytesEqual(item.leafHash, ourKey.leafHash)
            )),
          { pubkey: ourKey.pubkey, leafHash: ourKey.leafHash, signature },
        ];
        break;
    }
  });
  return prepared.psbt.toBase64();
}
