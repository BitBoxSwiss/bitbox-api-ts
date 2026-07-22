// SPDX-License-Identifier: Apache-2.0

/** @internal */
export interface BitBoxError {
  code: string;
  message: string;
  err?: unknown;
}

// JS-side connection, parsing, and input-shape errors.
/** @internal */ export const CODE_UNKNOWN_JS = 'unknown-js';
/** @internal */ export const CODE_COULD_NOT_OPEN = 'could-not-open';
/** @internal */ export const CODE_USER_ABORT = 'user-abort';
/** @internal */ export const CODE_INVALID_TYPE = 'invalid-type';
/** @internal */ export const CODE_PSBT_PARSE = 'psbt-parse';
/** @internal */ export const CODE_CHAIN_ID_TOO_LARGE = 'chain-id-too-large';

// Core API errors shared by pairing, transport, and method implementations.
/** @internal */ export const CODE_UNKNOWN = 'unknown';
/** @internal */ export const CODE_VERSION = 'version';
/** @internal */ export const CODE_COMMUNICATION = 'communication';
/** @internal */ export const CODE_NOISE = 'noise';
/** @internal */ export const CODE_NOISE_CONFIG = 'noise-config';
/** @internal */ export const CODE_PAIRING_REJECTED = 'pairing-rejected';
/** @internal */ export const CODE_UNEXPECTED_RESPONSE = 'unexpected-response';
/** @internal */ export const CODE_PROTOBUF_DECODE = 'protobuf-decode';
/** @internal */ export const CODE_KEYPATH_PARSE = 'keypath-parse';
/** @internal */ export const CODE_ANTIKLEPTO = 'antiklepto';
/** @internal */ export const CODE_ETH_TYPED_MESSAGE = 'eth-typed-message';
/** @internal */ export const CODE_BTC_SIGN = 'btc-sign';

// Device-origin errors reported through protobuf responses.
/** @internal */ export const CODE_BITBOX_UNKNOWN = 'bitbox-unknown';
/** @internal */ export const CODE_BITBOX_INVALID_INPUT = 'bitbox-invalid-input';
/** @internal */ export const CODE_BITBOX_MEMORY = 'bitbox-memory';
/** @internal */ export const CODE_BITBOX_GENERIC = 'bitbox-generic';
/** @internal */ export const CODE_BITBOX_USER_ABORT = 'bitbox-user-abort';
/** @internal */ export const CODE_BITBOX_INVALID_STATE = 'bitbox-invalid-state';
/** @internal */ export const CODE_BITBOX_DISABLED = 'bitbox-disabled';
/** @internal */ export const CODE_BITBOX_DUPLICATE = 'bitbox-duplicate';
/** @internal */ export const CODE_BITBOX_NOISE_ENCRYPT = 'bitbox-noise-encrypt';
/** @internal */ export const CODE_BITBOX_NOISE_DECRYPT = 'bitbox-noise-decrypt';

// PSBT error codes exposed by Bitcoin signing.
/** @internal */ export const CODE_PSBT_SIGN_ERROR = 'psbt-sign-error';
/** @internal */ export const CODE_PSBT_KEY_NOT_UNIQUE = 'psbt-key-not-unique';
/** @internal */ export const CODE_PSBT_KEY_NOT_FOUND = 'psbt-key-not-found';
/** @internal */ export const CODE_PSBT_UNKNOWN_OUTPUT_TYPE = 'psbt-unknown-output-type';
/** @internal */ export const CODE_PSBT_INVALID_OP_RETURN = 'psbt-invalid-op-return';
/** @internal */ export const CODE_PSBT_INVALID_ACCOUNT_KEYPATH =
  'psbt-invalid-account-keypath';

// TS compatibility codes for methods or lifecycle states without a device roundtrip.
/** @internal */ export const CODE_UNSUPPORTED = 'unsupported';
/** @internal */ export const CODE_NOT_IMPLEMENTED = 'not-implemented';
/** @internal */ export const CODE_INVALID_STATE = 'invalid-state';

// Device protobuf messages are ignored; the numeric code selects the stable public message.
/** @internal */
export const DEVICE_ERROR_TABLE: Record<number, { code: string; message: string }> = {
  101: { code: CODE_BITBOX_INVALID_INPUT, message: 'bitbox error: invalid input' },
  102: { code: CODE_BITBOX_MEMORY, message: 'bitbox error: memory' },
  103: { code: CODE_BITBOX_GENERIC, message: 'bitbox error: generic error' },
  104: { code: CODE_BITBOX_USER_ABORT, message: 'bitbox error: aborted by the user' },
  105: { code: CODE_BITBOX_INVALID_STATE, message: "bitbox error: can't call this endpoint: wrong state" },
  106: { code: CODE_BITBOX_DISABLED, message: 'bitbox error: function disabled' },
  107: { code: CODE_BITBOX_DUPLICATE, message: 'bitbox error: duplicate entry' },
  108: { code: CODE_BITBOX_NOISE_ENCRYPT, message: 'bitbox error: noise encryption failed' },
  109: { code: CODE_BITBOX_NOISE_DECRYPT, message: 'bitbox error: noise decryption failed' },
};

/** @internal */
export const DEVICE_UNKNOWN: { code: string; message: string } = {
  code: CODE_BITBOX_UNKNOWN,
  message: 'bitbox error: error code not recognized',
};

/** @internal */
export function deviceErrorFor(protobufCode: number): { code: string; message: string } {
  return DEVICE_ERROR_TABLE[protobufCode] ?? DEVICE_UNKNOWN;
}

interface TypedError extends Error {
  code: string;
}

// Factories for public messages with runtime details.
/** @internal */
export function makeError(code: string, message: string): TypedError {
  const err = new Error(message) as TypedError;
  // Error.message is non-enumerable by default, so JSON serialization and
  // Chrome extension message boundaries would otherwise drop it. Keep typed
  // errors Error-like while preserving the public { code, message } shape.
  Object.defineProperty(err, 'message', {
    value: message,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  err.code = code;
  return err;
}

/** @internal */
export function versionError(requirement: string): TypedError {
  return makeError(CODE_VERSION, `firmware version ${requirement} required`);
}

/** @internal */
export function communicationError(detail: string): TypedError {
  return makeError(CODE_COMMUNICATION, `communication error: ${detail}`);
}

/** @internal */
export function noiseConfigError(detail: string): TypedError {
  return makeError(CODE_NOISE_CONFIG, `noise config error: ${detail}`);
}

/** @internal */
export function keypathParseError(input: string): TypedError {
  return makeError(CODE_KEYPATH_PARSE, `failed parsing keypath: ${input}`);
}

/** @internal */
export function antikleptoError(detail: string): TypedError {
  return makeError(CODE_ANTIKLEPTO, `Antiklepto verification failed: ${detail}`);
}

/** @internal */
export function ethTypedMessageError(detail: string): TypedError {
  return makeError(CODE_ETH_TYPED_MESSAGE, `EIP-712 typed message processing error: ${detail}`);
}

/** @internal */
export function chainIdTooLargeError(chainId: bigint): TypedError {
  return makeError(
    CODE_CHAIN_ID_TOO_LARGE,
    `Chain ID too large and would overflow in the computation of the \`v\` signature value: ${chainId}`,
  );
}

/** @internal */
export function btcSignError(detail: string): TypedError {
  return makeError(CODE_BTC_SIGN, `Bitcoin transaction signing error: ${detail}`);
}

/** @internal */
export function psbtParseError(detail: string): TypedError {
  return makeError(CODE_PSBT_PARSE, `PSBT parse error: ${detail}`);
}

/** @internal */
export function psbtError(code: string, detail: string): TypedError {
  return makeError(code, `PSBT error: ${detail}`);
}

/** @internal */
export function invalidTypeError(detail: string): TypedError {
  return makeError(CODE_INVALID_TYPE, `invalid JavaScript type: ${detail}`);
}

/** @internal */
export function couldNotOpenWebHID(): TypedError {
  return makeError(
    CODE_COULD_NOT_OPEN,
    'Could not open device. It might already have an open connection to another app. If so, please close the other app first.',
  );
}

/** @internal */
export function couldNotOpenBridge(detail: string): TypedError {
  return makeError(CODE_COULD_NOT_OPEN, `Could not open device. ${detail}`);
}

/** @internal */
export function userAbortConnect(): TypedError {
  return makeError(CODE_USER_ABORT, 'connection aborted by user');
}

/** @internal */
export function unknownJs(err?: unknown): TypedError & { err?: unknown } {
  const e = makeError(CODE_UNKNOWN_JS, 'Unknown Javascript error') as TypedError & { err?: unknown };
  e.err = err;
  return e;
}

// Codes that can already cross the public boundary unchanged.
const TYPED_PUBLIC_CODES = new Set<string>([
  CODE_UNKNOWN_JS,
  CODE_COULD_NOT_OPEN,
  CODE_USER_ABORT,
  CODE_INVALID_TYPE,
  CODE_PSBT_PARSE,
  CODE_CHAIN_ID_TOO_LARGE,
  CODE_UNKNOWN,
  CODE_VERSION,
  CODE_COMMUNICATION,
  CODE_NOISE_CONFIG,
  CODE_PROTOBUF_DECODE,
  CODE_KEYPATH_PARSE,
  CODE_ANTIKLEPTO,
  CODE_ETH_TYPED_MESSAGE,
  CODE_BTC_SIGN,
  CODE_BITBOX_UNKNOWN,
  CODE_BITBOX_INVALID_INPUT,
  CODE_BITBOX_MEMORY,
  CODE_BITBOX_GENERIC,
  CODE_BITBOX_USER_ABORT,
  CODE_BITBOX_INVALID_STATE,
  CODE_BITBOX_DISABLED,
  CODE_BITBOX_DUPLICATE,
  CODE_BITBOX_NOISE_ENCRYPT,
  CODE_BITBOX_NOISE_DECRYPT,
  CODE_PSBT_SIGN_ERROR,
  CODE_PSBT_KEY_NOT_UNIQUE,
  CODE_PSBT_KEY_NOT_FOUND,
  CODE_PSBT_UNKNOWN_OUTPUT_TYPE,
  CODE_PSBT_INVALID_OP_RETURN,
  CODE_PSBT_INVALID_ACCOUNT_KEYPATH,
  CODE_UNSUPPORTED,
  CODE_NOT_IMPLEMENTED,
  CODE_INVALID_STATE,
]);

function isTypedShape(err: unknown): err is BitBoxError {
  return (
    err !== null &&
    typeof err === 'object' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

// Public API entry points use this to collapse internal transport/protocol details.
/** @internal */
export function toPublicError(err: unknown): BitBoxError {
  if (!isTypedShape(err)) {
    return unknownJs(err);
  }
  const { code, message } = err;

  if (code === CODE_NOISE) {
    return makeError(CODE_NOISE, 'noise channel error');
  }
  if (code === CODE_UNEXPECTED_RESPONSE) {
    return makeError(CODE_UNEXPECTED_RESPONSE, 'BitBox returned an unexpected response');
  }
  if (code === CODE_PAIRING_REJECTED) {
    return makeError(CODE_PAIRING_REJECTED, 'pairing code rejected by user');
  }

  if (TYPED_PUBLIC_CODES.has(code)) {
    return err;
  }

  switch (code) {
    case 'webhid-cancel':
      return userAbortConnect();
    case 'webhid':
    case 'simulator':
      return couldNotOpenWebHID();
    case 'bridge':
      return couldNotOpenBridge(message);
    case 'write':
      return communicationError('write error');
    case 'read':
      return communicationError('read error');
    case 'u2f-decode':
      return communicationError('u2f framing decoding error');
    case 'info':
      return communicationError('error querying device info');
    case 'noise-pairing-rejected':
      return makeError(CODE_PAIRING_REJECTED, 'pairing code rejected by user');
  }

  return unknownJs(err);
}

/** @internal */
export function ensureTyped(err: unknown): BitBoxError {
  if (isTypedShape(err)) {
    return err;
  }
  return unknownJs(err);
}
