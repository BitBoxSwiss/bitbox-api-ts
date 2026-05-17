// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import {
  AntiKleptoHostNonceCommitmentSchema,
  AntiKleptoSignatureRequestSchema,
} from '../../proto/gen/antiklepto_pb.js';
import {
  ETHAddressCase as PbAddressCase,
  ETHPubRequestSchema,
  ETHPubRequest_OutputType,
  ETHSignEIP1559RequestSchema,
  ETHSignMessageRequestSchema,
  ETHSignRequestSchema,
  ETHSignTypedMessageRequestSchema,
  ETHTypedMessageValueRequestSchema,
  type ETHResponse,
} from '../../proto/gen/eth_pb.js';
import type {
  Eth1559Transaction,
  EthAddressCase,
  EthSignature,
  EthTransaction,
  Keypath,
} from '../../index.js';
import type { Info } from '../hww.js';
import type { EncryptedChannel } from '../pairing.js';
import { genHostNonce, hostCommit, verifyEcdsa } from './antiklepto.js';
import {
  buildStructTypes,
  DataType,
  getValue,
  parseEip712Message,
  parseType,
  TypedMessageError,
} from './eip712.js';
import { parseKeypath } from './keypath.js';
import { queryEth, unexpectedResponse } from './query.js';
import { handleEthDataStreaming } from './streaming.js';
import { requireVersion, STREAMING_THRESHOLD } from './version.js';
import { chainIdTooLargeError, invalidTypeError } from '../errors.js';
import { bigUintToBytesBE, stripLeadingZeroes } from '../utils.js';

const UINT64_MAX = (1n << 64n) - 1n;
const ETH_TX_DETAIL = 'wrong type for EthTransaction';
const ETH_1559_TX_DETAIL = 'wrong type for Eth1559Transaction';

function validateUint64(value: unknown, detail: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > UINT64_MAX) {
    throw invalidTypeError(detail);
  }
  return value;
}

function validateSafeUint64Number(value: number, detail: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidTypeError(detail);
  }
  return validateUint64(BigInt(value), detail);
}

function validateRecipient(recipient: unknown, detail: string): void {
  if (!(recipient instanceof Uint8Array) || recipient.length !== 20) {
    throw invalidTypeError(detail);
  }
}

function mapAddressCase(value: EthAddressCase | undefined): PbAddressCase {
  switch (value) {
    case 'upper':
      return PbAddressCase.ETH_ADDRESS_CASE_UPPER;
    case 'lower':
      return PbAddressCase.ETH_ADDRESS_CASE_LOWER;
    case 'mixed':
    case undefined:
      return PbAddressCase.ETH_ADDRESS_CASE_MIXED;
    default:
      throw invalidTypeError('wrong type for EthAddressCase');
  }
}

function makeHostNonceCommitment(hostNonce: Uint8Array) {
  return create(AntiKleptoHostNonceCommitmentSchema, {
    commitment: hostCommit(hostNonce),
  });
}

async function antikleptoFinish(
  channel: EncryptedChannel,
  response: ETHResponse['response'],
  hostNonce: Uint8Array,
): Promise<Uint8Array> {
  if (response.case !== 'antikleptoSignerCommitment') {
    throw unexpectedResponse('expected antiklepto signer commitment');
  }
  const signerCommitment = response.value.commitment;
  const sigResp = await queryEth(channel, {
    case: 'antikleptoSignature',
    value: create(AntiKleptoSignatureRequestSchema, { hostNonce }),
  });
  if (sigResp.case !== 'sign') {
    throw unexpectedResponse('expected sign response after antiklepto');
  }
  const signature = sigResp.value.signature;
  if (signature.length !== 65) {
    throw unexpectedResponse('signature must be 65 bytes');
  }
  verifyEcdsa(hostNonce, signerCommitment, signature);
  return signature;
}

function unwrapDirectSignature(response: ETHResponse['response']): Uint8Array {
  if (response.case !== 'sign') {
    throw unexpectedResponse('expected sign response');
  }
  if (response.value.signature.length !== 65) {
    throw unexpectedResponse('signature must be 65 bytes');
  }
  return response.value.signature;
}

function shapeLegacyV(recid: number, chainId: bigint): Uint8Array {
  const v = BigInt(recid) + 27n + chainId * 2n + 8n;
  if (v > UINT64_MAX) {
    throw chainIdTooLargeError(chainId);
  }
  return bigUintToBytesBE(v);
}

function buildSignature(signature: Uint8Array, v: Uint8Array): EthSignature {
  return {
    r: signature.slice(0, 32),
    s: signature.slice(32, 64),
    v,
  };
}

export async function ethXpub(
  channel: EncryptedChannel,
  keypath: Keypath,
): Promise<string> {
  const response = await queryEth(channel, {
    case: 'pub',
    value: create(ETHPubRequestSchema, {
      keypath: parseKeypath(keypath),
      coin: 0,
      outputType: ETHPubRequest_OutputType.XPUB,
      display: false,
      contractAddress: new Uint8Array(),
      chainId: 0n,
    }),
  });
  if (response.case !== 'pub') {
    throw unexpectedResponse();
  }
  return response.value.pub;
}

export async function ethAddress(
  channel: EncryptedChannel,
  chainId: bigint,
  keypath: Keypath,
  display: boolean,
): Promise<string> {
  validateUint64(chainId, 'chainId');
  const response = await queryEth(channel, {
    case: 'pub',
    value: create(ETHPubRequestSchema, {
      keypath: parseKeypath(keypath),
      coin: 0,
      outputType: ETHPubRequest_OutputType.ADDRESS,
      display,
      contractAddress: new Uint8Array(),
      chainId,
    }),
  });
  if (response.case !== 'pub') {
    throw unexpectedResponse();
  }
  return response.value.pub;
}

export async function ethSignTransaction(
  channel: EncryptedChannel,
  info: Info,
  chainId: bigint,
  keypath: Keypath,
  tx: EthTransaction,
  addressCase: EthAddressCase | undefined,
): Promise<EthSignature> {
  requireVersion(info, { major: 9, minor: 10, patch: 0 });
  const useStreaming = tx.data.length > STREAMING_THRESHOLD;
  if (useStreaming) {
    requireVersion(info, { major: 9, minor: 26, patch: 0 });
  }
  validateUint64(chainId, 'chainId');
  validateRecipient(tx.recipient, ETH_TX_DETAIL);

  const hostNonce = genHostNonce();
  const req = create(ETHSignRequestSchema, {
    coin: 0,
    keypath: parseKeypath(keypath),
    nonce: stripLeadingZeroes(tx.nonce),
    gasPrice: stripLeadingZeroes(tx.gasPrice),
    gasLimit: stripLeadingZeroes(tx.gasLimit),
    recipient: tx.recipient,
    value: stripLeadingZeroes(tx.value),
    data: useStreaming ? new Uint8Array() : tx.data,
    hostNonceCommitment: makeHostNonceCommitment(hostNonce),
    chainId,
    addressCase: mapAddressCase(addressCase),
    dataLength: useStreaming ? tx.data.length : 0,
  });

  let response = await queryEth(channel, { case: 'sign', value: req });
  if (useStreaming) {
    response = await handleEthDataStreaming(channel, tx.data, response);
  }
  const signature = await antikleptoFinish(channel, response, hostNonce);
  return buildSignature(signature, shapeLegacyV(signature[64]!, chainId));
}

export async function ethSign1559Transaction(
  channel: EncryptedChannel,
  info: Info,
  keypath: Keypath,
  tx: Eth1559Transaction,
  addressCase: EthAddressCase | undefined,
): Promise<EthSignature> {
  requireVersion(info, { major: 9, minor: 16, patch: 0 });
  const useStreaming = tx.data.length > STREAMING_THRESHOLD;
  if (useStreaming) {
    requireVersion(info, { major: 9, minor: 26, patch: 0 });
  }
  const chainId =
    typeof tx.chainId === 'bigint'
      ? validateUint64(tx.chainId, ETH_1559_TX_DETAIL)
      : validateSafeUint64Number(tx.chainId, ETH_1559_TX_DETAIL);
  validateRecipient(tx.recipient, ETH_1559_TX_DETAIL);

  const hostNonce = genHostNonce();
  const req = create(ETHSignEIP1559RequestSchema, {
    chainId,
    keypath: parseKeypath(keypath),
    nonce: stripLeadingZeroes(tx.nonce),
    maxPriorityFeePerGas: stripLeadingZeroes(tx.maxPriorityFeePerGas),
    maxFeePerGas: stripLeadingZeroes(tx.maxFeePerGas),
    gasLimit: stripLeadingZeroes(tx.gasLimit),
    recipient: tx.recipient,
    value: stripLeadingZeroes(tx.value),
    data: useStreaming ? new Uint8Array() : tx.data,
    hostNonceCommitment: makeHostNonceCommitment(hostNonce),
    addressCase: mapAddressCase(addressCase),
    dataLength: useStreaming ? tx.data.length : 0,
  });

  let response = await queryEth(channel, { case: 'signEip1559', value: req });
  if (useStreaming) {
    response = await handleEthDataStreaming(channel, tx.data, response);
  }
  const signature = await antikleptoFinish(channel, response, hostNonce);
  return buildSignature(signature, new Uint8Array([signature[64]!]));
}

export async function ethSignMessage(
  channel: EncryptedChannel,
  info: Info,
  chainId: bigint,
  keypath: Keypath,
  msg: Uint8Array,
): Promise<EthSignature> {
  requireVersion(info, { major: 9, minor: 10, patch: 0 });
  validateUint64(chainId, 'chainId');

  const hostNonce = genHostNonce();
  const req = create(ETHSignMessageRequestSchema, {
    coin: 0,
    keypath: parseKeypath(keypath),
    msg,
    hostNonceCommitment: makeHostNonceCommitment(hostNonce),
    chainId,
  });

  const response = await queryEth(channel, { case: 'signMsg', value: req });
  const signature = await antikleptoFinish(channel, response, hostNonce);
  return buildSignature(signature, new Uint8Array([(signature[64]! + 27) & 0xff]));
}

export async function ethSignTypedMessage(
  channel: EncryptedChannel,
  info: Info,
  chainId: bigint,
  keypath: Keypath,
  msgInput: unknown,
  useAntiklepto: boolean | undefined,
): Promise<EthSignature> {
  requireVersion(info, { major: 9, minor: 12, patch: 0 });
  const enableAntiklepto = useAntiklepto ?? true;
  if (!enableAntiklepto) {
    requireVersion(info, { major: 9, minor: 26, patch: 0 });
  }
  validateUint64(chainId, 'chainId');

  const msg = parseEip712Message(msgInput);
  const types = buildStructTypes(msg.types);
  // Validate primary type and EIP712Domain are parseable up front.
  parseType(msg.primaryType, msg.types);
  parseType('EIP712Domain', msg.types);

  const hostNonce = enableAntiklepto ? genHostNonce() : undefined;

  const initialReq = create(ETHSignTypedMessageRequestSchema, {
    chainId,
    keypath: parseKeypath(keypath),
    types,
    primaryType: msg.primaryType,
    ...(hostNonce !== undefined
      ? { hostNonceCommitment: makeHostNonceCommitment(hostNonce) }
      : {}),
  });

  let response = await queryEth(channel, { case: 'signTypedMsg', value: initialReq });
  while (response.case === 'typedMsgValue') {
    const { value, dataType } = getValue(response.value, msg);
    if (dataType === DataType.STRING && value.length > STREAMING_THRESHOLD) {
      throw new TypedMessageError('string value exceeds maximum size');
    }
    const useStreaming = value.length > STREAMING_THRESHOLD;
    response = await queryEth(channel, {
      case: 'typedMsgValue',
      value: create(ETHTypedMessageValueRequestSchema, {
        value: useStreaming ? new Uint8Array() : value,
        dataLength: useStreaming ? value.length : 0,
      }),
    });
    if (useStreaming) {
      response = await handleEthDataStreaming(channel, value, response);
    }
  }

  const signature =
    enableAntiklepto && hostNonce !== undefined
      ? await antikleptoFinish(channel, response, hostNonce)
      : unwrapDirectSignature(response);

  return buildSignature(signature, new Uint8Array([(signature[64]! + 27) & 0xff]));
}
