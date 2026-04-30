// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { PairedBitBox, type Eth1559Transaction } from '../src/index.js';
import {
  CODE_ANTIKLEPTO,
  CODE_BITBOX_DISABLED,
  CODE_BITBOX_DUPLICATE,
  CODE_BITBOX_GENERIC,
  CODE_BITBOX_INVALID_INPUT,
  CODE_BITBOX_INVALID_STATE,
  CODE_BITBOX_MEMORY,
  CODE_BITBOX_NOISE_DECRYPT,
  CODE_BITBOX_NOISE_ENCRYPT,
  CODE_BITBOX_UNKNOWN,
  CODE_BITBOX_USER_ABORT,
  CODE_BTC_SIGN,
  CODE_CHAIN_ID_TOO_LARGE,
  CODE_COMMUNICATION,
  CODE_COULD_NOT_OPEN,
  CODE_ETH_TYPED_MESSAGE,
  CODE_INVALID_STATE,
  CODE_INVALID_TYPE,
  CODE_KEYPATH_PARSE,
  CODE_NOISE,
  CODE_NOISE_CONFIG,
  CODE_NOT_IMPLEMENTED,
  CODE_PAIRING_REJECTED,
  CODE_PROTOBUF_DECODE,
  CODE_PSBT_INVALID_OP_RETURN,
  CODE_PSBT_KEY_NOT_FOUND,
  CODE_PSBT_KEY_NOT_UNIQUE,
  CODE_PSBT_PARSE,
  CODE_PSBT_SIGN_ERROR,
  CODE_PSBT_UNKNOWN_OUTPUT_TYPE,
  CODE_UNEXPECTED_RESPONSE,
  CODE_UNKNOWN,
  CODE_UNKNOWN_JS,
  CODE_UNSUPPORTED,
  CODE_USER_ABORT,
  CODE_VERSION,
  antikleptoError,
  chainIdTooLargeError,
  communicationError,
  couldNotOpenBridge,
  couldNotOpenWebHID,
  deviceErrorFor,
  ethTypedMessageError,
  invalidTypeError,
  keypathParseError,
  noiseConfigError,
  toPublicError,
  unknownJs,
  userAbortConnect,
  versionError,
} from '../src/internal/errors.js';

interface ExpectedError {
  code: string;
  message: string;
}

const EXPECTED = {
  unknownJs: { code: CODE_UNKNOWN_JS, message: 'Unknown Javascript error' },
  couldNotOpenWebHID: {
    code: CODE_COULD_NOT_OPEN,
    message:
      'Could not open device. It might already have an open connection to another app. If so, please close the other app first.',
  },
  couldNotOpenBridge: {
    code: CODE_COULD_NOT_OPEN,
    message: 'Could not open device. <bridge message>',
  },
  userAbort: { code: CODE_USER_ABORT, message: 'connection aborted by user' },
  invalidType: {
    code: CODE_INVALID_TYPE,
    message: 'invalid JavaScript type: wrong type for EthTransaction',
  },
  chainIdTooLarge: {
    code: CODE_CHAIN_ID_TOO_LARGE,
    message:
      'Chain ID too large and would overflow in the computation of the `v` signature value: 9223372036854775808',
  },
  unknown: { code: CODE_UNKNOWN, message: 'unknown error' },
  version: { code: CODE_VERSION, message: 'firmware version >=9.10.0 required' },
  communication: { code: CODE_COMMUNICATION, message: 'communication error: <detail>' },
  noise: { code: CODE_NOISE, message: 'noise channel error' },
  noiseConfig: { code: CODE_NOISE_CONFIG, message: 'noise config error: <detail>' },
  pairingRejected: { code: CODE_PAIRING_REJECTED, message: 'pairing code rejected by user' },
  unexpectedResponse: {
    code: CODE_UNEXPECTED_RESPONSE,
    message: 'BitBox returned an unexpected response',
  },
  protobufDecode: {
    code: CODE_PROTOBUF_DECODE,
    message: 'protobuf message could not be decoded',
  },
  keypathParse: {
    code: CODE_KEYPATH_PARSE,
    message: 'failed parsing keypath: m/oops',
  },
  invalidSignature: {
    code: CODE_KEYPATH_PARSE,
    message: 'Unexpected signature format returned by BitBox',
  },
  antiklepto: {
    code: CODE_ANTIKLEPTO,
    message: 'Antiklepto verification failed: <detail>',
  },
  ethTypedMessage: {
    code: CODE_ETH_TYPED_MESSAGE,
    message: 'EIP-712 typed message processing error: <detail>',
  },
  btcSign: { code: CODE_BTC_SIGN, message: 'Bitcoin transaction signing error: <detail>' },
  bitboxInvalidInput: { code: CODE_BITBOX_INVALID_INPUT, message: 'bitbox error: invalid input' },
  bitboxMemory: { code: CODE_BITBOX_MEMORY, message: 'bitbox error: memory' },
  bitboxGeneric: { code: CODE_BITBOX_GENERIC, message: 'bitbox error: generic error' },
  bitboxUserAbort: { code: CODE_BITBOX_USER_ABORT, message: 'bitbox error: aborted by the user' },
  bitboxInvalidState: {
    code: CODE_BITBOX_INVALID_STATE,
    message: "bitbox error: can't call this endpoint: wrong state",
  },
  bitboxDisabled: { code: CODE_BITBOX_DISABLED, message: 'bitbox error: function disabled' },
  bitboxDuplicate: { code: CODE_BITBOX_DUPLICATE, message: 'bitbox error: duplicate entry' },
  bitboxNoiseEncrypt: {
    code: CODE_BITBOX_NOISE_ENCRYPT,
    message: 'bitbox error: noise encryption failed',
  },
  bitboxNoiseDecrypt: {
    code: CODE_BITBOX_NOISE_DECRYPT,
    message: 'bitbox error: noise decryption failed',
  },
  bitboxUnknown: { code: CODE_BITBOX_UNKNOWN, message: 'bitbox error: error code not recognized' },
  psbtParse: { code: CODE_PSBT_PARSE, message: 'PSBT parse error: <detail>' },
  psbtSignError: { code: CODE_PSBT_SIGN_ERROR, message: 'PSBT error: <detail>' },
  psbtKeyNotUnique: {
    code: CODE_PSBT_KEY_NOT_UNIQUE,
    message: 'PSBT error: Taproot pubkeys must be unique across the internal key and all leaf scripts.',
  },
  psbtKeyNotFound: { code: CODE_PSBT_KEY_NOT_FOUND, message: 'PSBT error: Could not find our key in an input.' },
  psbtUnknownOutputType: {
    code: CODE_PSBT_UNKNOWN_OUTPUT_TYPE,
    message: 'PSBT error: Unrecognized/unsupported output type.',
  },
  psbtInvalidOpReturn: {
    code: CODE_PSBT_INVALID_OP_RETURN,
    message: 'PSBT error: Invalid OP_RETURN script: <detail>',
  },
} satisfies Record<string, ExpectedError>;

function publicShape(err: { code: string; message: string }): ExpectedError {
  return { code: err.code, message: err.message };
}

const INFO = {
  product: 'bitbox02-multi' as const,
  version: '9.26.0',
  unlocked: true,
  initialized: true,
};

describe('error code fixture', () => {
  it.each([
    ['unknown-js', () => unknownJs(new Error('inner')), EXPECTED.unknownJs],
    ['could-not-open WebHID', () => couldNotOpenWebHID(), EXPECTED.couldNotOpenWebHID],
    ['could-not-open bridge', () => couldNotOpenBridge('<bridge message>'), EXPECTED.couldNotOpenBridge],
    ['user-abort', () => userAbortConnect(), EXPECTED.userAbort],
    ['invalid-type', () => invalidTypeError('wrong type for EthTransaction'), EXPECTED.invalidType],
    ['chain-id-too-large', () => chainIdTooLargeError(1n << 63n), EXPECTED.chainIdTooLarge],
    ['version', () => versionError('>=9.10.0'), EXPECTED.version],
    ['communication', () => communicationError('<detail>'), EXPECTED.communication],
    ['noise-config', () => noiseConfigError('<detail>'), EXPECTED.noiseConfig],
    ['keypath-parse', () => keypathParseError('m/oops'), EXPECTED.keypathParse],
    ['antiklepto', () => antikleptoError('<detail>'), EXPECTED.antiklepto],
    ['eth-typed-message', () => ethTypedMessageError('<detail>'), EXPECTED.ethTypedMessage],
  ] as const)('%s factory', (_name, create, expected) => {
    expect(publicShape(create())).toEqual(expected);
  });

  it('documents fixed public messages without factories', () => {
    expect([
      EXPECTED.unknown,
      EXPECTED.noise,
      EXPECTED.pairingRejected,
      EXPECTED.unexpectedResponse,
      EXPECTED.protobufDecode,
      EXPECTED.invalidSignature,
      EXPECTED.btcSign,
      EXPECTED.psbtParse,
      EXPECTED.psbtSignError,
      EXPECTED.psbtKeyNotUnique,
      EXPECTED.psbtKeyNotFound,
      EXPECTED.psbtUnknownOutputType,
      EXPECTED.psbtInvalidOpReturn,
    ]).toEqual([
      { code: CODE_UNKNOWN, message: 'unknown error' },
      { code: CODE_NOISE, message: 'noise channel error' },
      { code: CODE_PAIRING_REJECTED, message: 'pairing code rejected by user' },
      { code: CODE_UNEXPECTED_RESPONSE, message: 'BitBox returned an unexpected response' },
      { code: CODE_PROTOBUF_DECODE, message: 'protobuf message could not be decoded' },
      { code: CODE_KEYPATH_PARSE, message: 'Unexpected signature format returned by BitBox' },
      { code: CODE_BTC_SIGN, message: 'Bitcoin transaction signing error: <detail>' },
      { code: CODE_PSBT_PARSE, message: 'PSBT parse error: <detail>' },
      { code: CODE_PSBT_SIGN_ERROR, message: 'PSBT error: <detail>' },
      {
        code: CODE_PSBT_KEY_NOT_UNIQUE,
        message: 'PSBT error: Taproot pubkeys must be unique across the internal key and all leaf scripts.',
      },
      { code: CODE_PSBT_KEY_NOT_FOUND, message: 'PSBT error: Could not find our key in an input.' },
      { code: CODE_PSBT_UNKNOWN_OUTPUT_TYPE, message: 'PSBT error: Unrecognized/unsupported output type.' },
      { code: CODE_PSBT_INVALID_OP_RETURN, message: 'PSBT error: Invalid OP_RETURN script: <detail>' },
    ]);
  });

  it('maps every protobuf device error code to wrapper text', () => {
    expect(deviceErrorFor(101)).toEqual(EXPECTED.bitboxInvalidInput);
    expect(deviceErrorFor(102)).toEqual(EXPECTED.bitboxMemory);
    expect(deviceErrorFor(103)).toEqual(EXPECTED.bitboxGeneric);
    expect(deviceErrorFor(104)).toEqual(EXPECTED.bitboxUserAbort);
    expect(deviceErrorFor(105)).toEqual(EXPECTED.bitboxInvalidState);
    expect(deviceErrorFor(106)).toEqual(EXPECTED.bitboxDisabled);
    expect(deviceErrorFor(107)).toEqual(EXPECTED.bitboxDuplicate);
    expect(deviceErrorFor(108)).toEqual(EXPECTED.bitboxNoiseEncrypt);
    expect(deviceErrorFor(109)).toEqual(EXPECTED.bitboxNoiseDecrypt);
    expect(deviceErrorFor(0)).toEqual(EXPECTED.bitboxUnknown);
    expect(deviceErrorFor(100)).toEqual(EXPECTED.bitboxUnknown);
    expect(deviceErrorFor(999)).toEqual(EXPECTED.bitboxUnknown);
  });
});

describe('toPublicError', () => {
  it.each([
    ['webhid-cancel', { code: 'webhid-cancel', message: 'no BitBox02 selected' }, EXPECTED.userAbort],
    ['webhid', { code: 'webhid', message: 'failed to open HID device' }, EXPECTED.couldNotOpenWebHID],
    ['simulator', { code: 'simulator', message: 'invalid endpoint' }, EXPECTED.couldNotOpenWebHID],
    [
      'bridge',
      { code: 'bridge', message: 'Origin not whitelisted.' },
      { code: CODE_COULD_NOT_OPEN, message: 'Could not open device. Origin not whitelisted.' },
    ],
    ['noise', { code: CODE_NOISE, message: 'low-level detail' }, EXPECTED.noise],
    [
      'unexpected-response',
      { code: CODE_UNEXPECTED_RESPONSE, message: 'expected sign response' },
      EXPECTED.unexpectedResponse,
    ],
    [
      'pairing-rejected',
      { code: CODE_PAIRING_REJECTED, message: 'device rejected pairing' },
      EXPECTED.pairingRejected,
    ],
    [
      'noise-pairing-rejected',
      { code: 'noise-pairing-rejected', message: 'device rejected pairing' },
      EXPECTED.pairingRejected,
    ],
  ] as const)('maps %s', (_name, input, expected) => {
    expect(publicShape(toPublicError(input))).toEqual(expected);
  });

  it.each([
    ['write', 'communication error: write error'],
    ['read', 'communication error: read error'],
    ['u2f-decode', 'communication error: u2f framing decoding error'],
    ['info', 'communication error: error querying device info'],
  ] as const)('maps %s to communication', (code, message) => {
    expect(publicShape(toPublicError({ code, message: 'internal detail' }))).toEqual({
      code: CODE_COMMUNICATION,
      message,
    });
  });

  it('passes known public codes through unchanged', () => {
    for (const code of [
      CODE_VERSION,
      CODE_COMMUNICATION,
      CODE_NOISE_CONFIG,
      CODE_USER_ABORT,
      CODE_BITBOX_USER_ABORT,
      CODE_INVALID_TYPE,
      CODE_KEYPATH_PARSE,
      CODE_ANTIKLEPTO,
      CODE_ETH_TYPED_MESSAGE,
      CODE_CHAIN_ID_TOO_LARGE,
      CODE_UNSUPPORTED,
      CODE_NOT_IMPLEMENTED,
      CODE_INVALID_STATE,
    ]) {
      const input = { code, message: `m-${code}` };
      expect(toPublicError(input)).toBe(input);
    }
  });

  it('wraps non-typed and unknown typed throwables as unknown-js', () => {
    const raw = new Error('boom');
    const wrappedRaw = toPublicError(raw);
    expect(publicShape(wrappedRaw)).toEqual(EXPECTED.unknownJs);
    expect(wrappedRaw.err).toBe(raw);

    const typed = { code: 'future-code', message: 'not registered' };
    const wrappedTyped = toPublicError(typed);
    expect(publicShape(wrappedTyped)).toEqual(EXPECTED.unknownJs);
    expect(wrappedTyped.err).toBe(typed);
  });
});

describe('public boundary normalization', () => {
  it('maps transport errors thrown through PairedBitBox methods', async () => {
    const paired = new PairedBitBox({
      channel: {
        query: async () => {
          const err = new Error('socket closed') as Error & { code: string };
          err.code = 'read';
          throw err;
        },
      },
      info: INFO,
      close(): void {},
    });

    await expect(paired.ethXpub([0])).rejects.toMatchObject({
      code: CODE_COMMUNICATION,
      message: 'communication error: read error',
    });
  });

  it('keeps ETH host validation on the public invalid-type surface', async () => {
    const paired = new PairedBitBox({
      channel: {
        query: async () => {
          throw new Error('should not query');
        },
      },
      info: INFO,
      close(): void {},
    });
    const tx: Eth1559Transaction = {
      chainId: Number.MAX_SAFE_INTEGER + 1,
      nonce: new Uint8Array(),
      maxPriorityFeePerGas: new Uint8Array(),
      maxFeePerGas: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };

    await expect(paired.ethSign1559Transaction([0], tx)).rejects.toMatchObject({
      code: CODE_INVALID_TYPE,
      message: 'invalid JavaScript type: wrong type for Eth1559Transaction',
    });
  });
});
