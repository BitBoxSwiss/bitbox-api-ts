// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import type {
  BtcCoin,
  BtcFormatUnit,
  BtcRegisterXPubType,
  BtcScriptConfig,
  BtcScriptConfigWithKeypath,
  BtcSignMessageSignature,
  BtcXPubsType,
  Keypath,
  XPubType,
} from '../../index.js';
import {
  AntiKleptoHostNonceCommitmentSchema,
  AntiKleptoSignatureRequestSchema,
} from '../../proto/gen/antiklepto_pb.js';
import {
  BTCIsScriptConfigRegisteredRequestSchema,
  type BTCCoin,
  BTCOutputType,
  BTCPrevTxInitRequestSchema,
  BTCPrevTxInputRequestSchema,
  BTCPrevTxOutputRequestSchema,
  BTCPubRequestSchema,
  BTCRegisterScriptConfigRequestSchema,
  BTCScriptConfigRegistrationSchema,
  BTCScriptConfig_SimpleType,
  BTCSignInitRequestSchema,
  BTCSignInputRequestSchema,
  BTCSignMessageRequestSchema,
  BTCSignNextResponse_Type,
  BTCSignOutputRequestSchema,
  type BTCSignInitRequest_FormatUnit,
  BTCXpubsRequestSchema,
  type BTCScriptConfigWithKeypath,
} from '../../proto/gen/btc_pb.js';
import { KeypathSchema } from '../../proto/gen/common_pb.js';
import { RequestSchema } from '../../proto/gen/hww_pb.js';
import { rootFingerprint } from '../device.js';
import { btcSignError, invalidTypeError } from '../errors.js';
import { atLeast, parseSemver, type Info } from '../hww.js';
import { parseKeypath } from '../keypath.js';
import type { EncryptedChannel } from '../pairing.js';
import { query, unexpectedResponse } from '../proto-query.js';
import { requireVersion } from '../version.js';
import { genHostNonce, hostCommit, verifyEcdsa, verifyEcdsaCompact } from '../antiklepto.js';
import {
  mapCoin,
  mapFormatUnit,
  mapRegisterXpubType,
  mapScriptConfig,
  mapScriptConfigWithKeypath,
  mapXpubsType,
  mapXpubType,
} from './config.js';
import { addSignatures, parsePsbt, preparePsbt, type Transaction } from './psbt.js';
import {
  queryBtc,
  queryBtcSignNext,
  queryNestedBtcSignNext,
} from './query.js';

async function queryXpub(
  channel: EncryptedChannel,
  coin: BTCCoin,
  keypath: number[],
  xpubType: XPubType,
  display: boolean,
): Promise<string> {
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'btcPub',
      value: create(BTCPubRequestSchema, {
        coin,
        keypath,
        output: { case: 'xpubType', value: mapXpubType(xpubType) },
        display,
      }),
    },
  }));
  if (response.response.case !== 'pub') {
    throw unexpectedResponse();
  }
  return response.response.value.pub;
}

export async function btcXpub(
  channel: EncryptedChannel,
  coin: BtcCoin,
  keypath: Keypath,
  xpubType: XPubType,
  display: boolean,
): Promise<string> {
  return queryXpub(channel, mapCoin(coin), parseKeypath(keypath), xpubType, display);
}

export async function btcXpubs(
  channel: EncryptedChannel,
  info: Info,
  coin: BtcCoin,
  keypaths: Keypath[],
  xpubType: BtcXPubsType,
): Promise<string[]> {
  const parsedKeypaths = keypaths.map(parseKeypath);
  const mappedCoin = mapCoin(coin);
  const mappedType = mapXpubsType(xpubType);
  if (!atLeast(parseSemver(info.version), { major: 9, minor: 24, patch: 0 })) {
    const xpubs: string[] = [];
    for (const keypath of parsedKeypaths) {
      xpubs.push(await queryXpub(channel, mappedCoin, keypath, xpubType, false));
    }
    return xpubs;
  }

  const response = await queryBtc(channel, {
    case: 'xpubs',
    value: create(BTCXpubsRequestSchema, {
      coin: mappedCoin,
      xpubType: mappedType,
      keypaths: parsedKeypaths.map(keypath => create(KeypathSchema, { keypath })),
    }),
  });
  if (response.case !== 'pubs') {
    throw unexpectedResponse();
  }
  return response.value.pubs;
}

function registration(
  coin: BtcCoin,
  scriptConfig: BtcScriptConfig,
  keypathAccount: Keypath | undefined,
) {
  return create(BTCScriptConfigRegistrationSchema, {
    coin: mapCoin(coin),
    scriptConfig: mapScriptConfig(scriptConfig),
    keypath: keypathAccount === undefined ? [] : parseKeypath(keypathAccount),
  });
}

export async function btcIsScriptConfigRegistered(
  channel: EncryptedChannel,
  coin: BtcCoin,
  scriptConfig: BtcScriptConfig,
  keypathAccount: Keypath | undefined,
): Promise<boolean> {
  const response = await queryBtc(channel, {
    case: 'isScriptConfigRegistered',
    value: create(BTCIsScriptConfigRegisteredRequestSchema, {
      registration: registration(coin, scriptConfig, keypathAccount),
    }),
  });
  if (response.case !== 'isScriptConfigRegistered') {
    throw unexpectedResponse();
  }
  return response.value.isRegistered;
}

export async function btcRegisterScriptConfig(
  channel: EncryptedChannel,
  coin: BtcCoin,
  scriptConfig: BtcScriptConfig,
  keypathAccount: Keypath | undefined,
  xpubType: BtcRegisterXPubType,
  name: string | undefined,
): Promise<void> {
  const response = await queryBtc(channel, {
    case: 'registerScriptConfig',
    value: create(BTCRegisterScriptConfigRequestSchema, {
      registration: registration(coin, scriptConfig, keypathAccount),
      name: name ?? '',
      xpubType: mapRegisterXpubType(xpubType),
    }),
  });
  if (response.case !== 'success') {
    throw unexpectedResponse();
  }
}

export async function btcAddress(
  channel: EncryptedChannel,
  coin: BtcCoin,
  keypath: Keypath,
  scriptConfig: BtcScriptConfig,
  display: boolean,
): Promise<string> {
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'btcPub',
      value: create(BTCPubRequestSchema, {
        coin: mapCoin(coin),
        keypath: parseKeypath(keypath),
        output: {
          case: 'scriptConfig',
          value: mapScriptConfig(scriptConfig),
        },
        display,
      }),
    },
  }));
  if (response.response.case !== 'pub') {
    throw unexpectedResponse();
  }
  return response.response.value.pub;
}

function isTaprootSimple(scriptConfig: BTCScriptConfigWithKeypath): boolean {
  return (
    scriptConfig.scriptConfig?.config.case === 'simpleType' &&
    scriptConfig.scriptConfig.config.value === BTCScriptConfig_SimpleType.P2TR
  );
}

function isTaprootPolicy(scriptConfig: BTCScriptConfigWithKeypath): boolean {
  return (
    scriptConfig.scriptConfig?.config.case === 'policy' &&
    scriptConfig.scriptConfig.config.value.policy.startsWith('tr(')
  );
}

function isSchnorr(scriptConfig: BTCScriptConfigWithKeypath): boolean {
  return isTaprootSimple(scriptConfig) || isTaprootPolicy(scriptConfig);
}

function makeHostNonceCommitment(hostNonce: Uint8Array) {
  return create(AntiKleptoHostNonceCommitmentSchema, {
    commitment: hostCommit(hostNonce),
  });
}

async function btcSign(
  channel: EncryptedChannel,
  info: Info,
  coin: BTCCoin,
  transaction: Transaction,
  outputScriptConfigs: BTCScriptConfigWithKeypath[],
  outputScriptConfigIndices: (number | undefined)[],
  formatUnit: BTCSignInitRequest_FormatUnit,
): Promise<Uint8Array[]> {
  if (
    outputScriptConfigIndices.length !== 0 &&
    outputScriptConfigIndices.length !== transaction.outputs.length
  ) {
    throw btcSignError('output script config indices must match transaction outputs');
  }
  requireVersion(info, { major: 9, minor: 4, patch: 0 });
  if (
    transaction.scriptConfigs
      .concat(outputScriptConfigs)
      .some(isTaprootSimple)
  ) {
    requireVersion(info, { major: 9, minor: 10, patch: 0 });
  }
  if (
    transaction.outputs.some(output =>
      output.kind === 'external' && output.outputType === BTCOutputType.OP_RETURN)
  ) {
    requireVersion(info, { major: 9, minor: 24, patch: 0 });
  }

  const signatures: Uint8Array[] = [];
  let nextResponse = await queryBtcSignNext(channel, {
    case: 'btcSignInit',
    value: create(BTCSignInitRequestSchema, {
      coin,
      scriptConfigs: transaction.scriptConfigs,
      outputScriptConfigs,
      version: transaction.version,
      numInputs: transaction.inputs.length,
      numOutputs: transaction.outputs.length,
      locktime: transaction.locktime,
      formatUnit,
      containsSilentPaymentOutputs: false,
    }),
  });

  let isInputsPass2 = false;
  for (;;) {
    switch (nextResponse.type) {
      case BTCSignNextResponse_Type.INPUT: {
        const inputIndex = nextResponse.index;
        const input = transaction.inputs[inputIndex];
        if (input === undefined) {
          throw unexpectedResponse();
        }
        const scriptConfig = transaction.scriptConfigs[input.scriptConfigIndex];
        if (scriptConfig === undefined) {
          throw unexpectedResponse();
        }
        const performAntiklepto = isInputsPass2 && !isSchnorr(scriptConfig);
        const hostNonce = performAntiklepto ? genHostNonce() : undefined;
        nextResponse = await queryBtcSignNext(channel, {
          case: 'btcSignInput',
          value: create(BTCSignInputRequestSchema, {
            prevOutHash: input.prevOutHash,
            prevOutIndex: input.prevOutIndex,
            prevOutValue: input.prevOutValue,
            sequence: input.sequence,
            keypath: input.keypath,
            scriptConfigIndex: input.scriptConfigIndex,
            ...(hostNonce === undefined
              ? {}
              : { hostNonceCommitment: makeHostNonceCommitment(hostNonce) }),
          }),
        });

        if (hostNonce !== undefined) {
          if (
            nextResponse.type !== BTCSignNextResponse_Type.HOST_NONCE ||
            nextResponse.antiKleptoSignerCommitment === undefined
          ) {
            throw unexpectedResponse();
          }
          const signerCommitment = nextResponse.antiKleptoSignerCommitment.commitment;
          nextResponse = await queryNestedBtcSignNext(channel, {
            case: 'antikleptoSignature',
            value: create(AntiKleptoSignatureRequestSchema, { hostNonce }),
          });
          if (!nextResponse.hasSignature) {
            throw unexpectedResponse();
          }
          verifyEcdsaCompact(hostNonce, signerCommitment, nextResponse.signature);
        }

        if (isInputsPass2) {
          if (!nextResponse.hasSignature) {
            throw unexpectedResponse();
          }
          signatures.push(nextResponse.signature);
        }
        if (inputIndex === transaction.inputs.length - 1) {
          isInputsPass2 = true;
        }
        break;
      }
      case BTCSignNextResponse_Type.PREVTX_INIT: {
        const previous = transaction.inputs[nextResponse.index]?.prevTx;
        if (previous === undefined) {
          throw btcSignError("input's previous transaction required but missing");
        }
        nextResponse = await queryNestedBtcSignNext(channel, {
          case: 'prevtxInit',
          value: create(BTCPrevTxInitRequestSchema, {
            version: previous.version,
            numInputs: previous.inputs.length,
            numOutputs: previous.outputs.length,
            locktime: previous.locktime,
          }),
        });
        break;
      }
      case BTCSignNextResponse_Type.PREVTX_INPUT: {
        const previous = transaction.inputs[nextResponse.index]?.prevTx;
        const input = previous?.inputs[nextResponse.prevIndex];
        if (input === undefined) {
          throw unexpectedResponse();
        }
        nextResponse = await queryNestedBtcSignNext(channel, {
          case: 'prevtxInput',
          value: create(BTCPrevTxInputRequestSchema, input),
        });
        break;
      }
      case BTCSignNextResponse_Type.PREVTX_OUTPUT: {
        const previous = transaction.inputs[nextResponse.index]?.prevTx;
        const output = previous?.outputs[nextResponse.prevIndex];
        if (output === undefined) {
          throw unexpectedResponse();
        }
        nextResponse = await queryNestedBtcSignNext(channel, {
          case: 'prevtxOutput',
          value: create(BTCPrevTxOutputRequestSchema, output),
        });
        break;
      }
      case BTCSignNextResponse_Type.OUTPUT: {
        const outputIndex = nextResponse.index;
        const output = transaction.outputs[outputIndex];
        if (output === undefined) {
          throw unexpectedResponse();
        }
        nextResponse = await queryBtcSignNext(channel, {
          case: 'btcSignOutput',
          value: output.kind === 'internal'
            ? create(BTCSignOutputRequestSchema, {
              ours: true,
              value: output.value,
              keypath: output.keypath,
              scriptConfigIndex: output.scriptConfigIndex,
              ...(outputScriptConfigIndices[outputIndex] === undefined
                ? {}
                : {
                  outputScriptConfigIndex:
                    outputScriptConfigIndices[outputIndex],
                }),
            })
            : create(BTCSignOutputRequestSchema, {
              ours: false,
              type: output.outputType,
              value: output.value,
              payload: output.payload,
            }),
        });
        break;
      }
      case BTCSignNextResponse_Type.DONE:
        return signatures;
      case BTCSignNextResponse_Type.HOST_NONCE:
      case BTCSignNextResponse_Type.PAYMENT_REQUEST:
      default:
        throw unexpectedResponse();
    }
  }
}

export async function btcSignPSBT(
  channel: EncryptedChannel,
  info: Info,
  coin: BtcCoin,
  psbtBase64: string,
  forcedScriptConfig: BtcScriptConfigWithKeypath | undefined,
  formatUnit: BtcFormatUnit,
): Promise<string> {
  const psbt = parsePsbt(psbtBase64);
  const mappedCoin = mapCoin(coin);
  const mappedScriptConfig = forcedScriptConfig === undefined
    ? undefined
    : mapScriptConfigWithKeypath(forcedScriptConfig);
  const mappedFormatUnit = mapFormatUnit(formatUnit);
  // Since v9.15.0, the device accepts any device-owned output as internal, not only change.
  requireVersion(info, { major: 9, minor: 15, patch: 0 });
  const fingerprint = await rootFingerprint(channel);
  const prepared = preparePsbt(info, fingerprint, psbt, mappedScriptConfig);
  const signatures = await btcSign(
    channel,
    info,
    mappedCoin,
    prepared.transaction,
    prepared.outputScriptConfigs,
    prepared.outputScriptConfigIndices,
    mappedFormatUnit,
  );
  return addSignatures(prepared, signatures);
}

export async function btcSignMessage(
  channel: EncryptedChannel,
  info: Info,
  coin: BtcCoin,
  scriptConfig: BtcScriptConfigWithKeypath,
  msg: Uint8Array,
): Promise<BtcSignMessageSignature> {
  requireVersion(info, { major: 9, minor: 5, patch: 0 });
  if (!(msg instanceof Uint8Array)) {
    throw invalidTypeError('wrong type for Uint8Array');
  }
  const hostNonce = genHostNonce();
  const response = await queryBtc(channel, {
    case: 'signMessage',
    value: create(BTCSignMessageRequestSchema, {
      coin: mapCoin(coin),
      scriptConfig: mapScriptConfigWithKeypath(scriptConfig),
      msg,
      hostNonceCommitment: makeHostNonceCommitment(hostNonce),
    }),
  });
  if (response.case !== 'antikleptoSignerCommitment') {
    throw unexpectedResponse();
  }

  const signatureResponse = await queryBtc(channel, {
    case: 'antikleptoSignature',
    value: create(AntiKleptoSignatureRequestSchema, { hostNonce }),
  });
  if (signatureResponse.case !== 'signMessage') {
    throw unexpectedResponse();
  }
  const signature = signatureResponse.value.signature;
  if (signature.length !== 65) {
    throw unexpectedResponse('signature must be 65 bytes');
  }
  verifyEcdsa(hostNonce, response.value.commitment, signature);

  const sig = Array.from(signature.slice(0, 64));
  const recid = signature[64]!;
  return {
    sig,
    recid,
    // BitBox02 uses only compressed pubkeys. Electrum encodes that as +4.
    electrumSig65: [27 + 4 + recid, ...sig],
  };
}
