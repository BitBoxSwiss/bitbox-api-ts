// SPDX-License-Identifier: Apache-2.0

import type { Info } from './hww.js';
import {
  CipherState,
  NoiseXX,
  generateStaticPrivateKey,
  type HandshakeFinalState,
} from './noise.js';
import {
  addDeviceStaticPubkey,
  containsDeviceStaticPubkey,
  type NoiseConfig,
} from './noise-config.js';
import { CODE_UNEXPECTED_RESPONSE, makeError } from './errors.js';

/**
 * Minimal subset of `PairingTransport` the pairing layer needs. The real
 * `PairingTransport` satisfies it; tests can implement it directly without
 * constructing the HWW retry/framing stack.
 * @internal
 */
export interface PairingTransport {
  readonly info: Info;
  query(msg: Uint8Array): Promise<Uint8Array>;
}

const OP_UNLOCK = 0x75; // 'u'
const OP_I_CAN_HAS_HANDSHAEK = 0x68; // 'h'
const OP_HER_COMEZ_TEH_HANDSHAEK = 0x48; // 'H'
const OP_I_CAN_HAS_PAIRIN_VERIFICASHUN = 0x76; // 'v'
const OP_NOISE_MSG = 0x6e; // 'n'

const RESPONSE_SUCCESS = 0x00;
const DEVICE_PAIRING_REQUIRED = 0x01;

const EMPTY = new Uint8Array(0);

/** @internal */
export class NoiseError extends Error {
  readonly code: 'noise' | 'pairing-rejected';
  constructor(code: 'noise' | 'pairing-rejected', message: string) {
    super(message);
    this.code = code;
  }
}

/** @internal */
export interface PairingState {
  hww: PairingTransport;
  config: NoiseConfig;
  finalState: HandshakeFinalState;
  /** Set when first-time pairing or device requested re-verification. */
  pairingCode: string | undefined;
}

/** @internal */
export interface EncryptedChannel {
  query(plaintext: Uint8Array): Promise<Uint8Array>;
}

const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += RFC4648_ALPHABET[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += RFC4648_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/** @internal */
export function formatPairingCode(handshakeHash: Uint8Array): string {
  const encoded = base32Encode(handshakeHash);
  return `${encoded.slice(0, 5)} ${encoded.slice(5, 10)}\n${encoded.slice(10, 15)} ${encoded.slice(15, 20)}`;
}

async function handshakeQuery(hww: PairingTransport, message: Uint8Array): Promise<Uint8Array> {
  const framed = new Uint8Array(message.length + 1);
  framed[0] = OP_HER_COMEZ_TEH_HANDSHAEK;
  framed.set(message, 1);
  const response = await hww.query(framed);
  if (response.length < 1 || response[0] !== RESPONSE_SUCCESS) {
    throw new NoiseError('noise', 'handshake response was not RESPONSE_SUCCESS');
  }
  return response.slice(1);
}

/**
 * Drives `OP_UNLOCK`, `OP_I_CAN_HAS_HANDSHAEK`, and the three Noise XX message
 * exchanges. Returns the in-flight pairing state — caller decides whether to
 * surface a pairing code to the user before completing pairing.
 * @internal
 */
export async function performHandshake(
  hww: PairingTransport,
  config: NoiseConfig,
): Promise<PairingState> {
  await hww.query(new Uint8Array([OP_UNLOCK]));

  let configData = config.read();
  let appStaticPrivkey: Uint8Array;
  if (configData.appStaticPrivkey !== undefined) {
    appStaticPrivkey = configData.appStaticPrivkey;
  } else {
    appStaticPrivkey = generateStaticPrivateKey();
    configData = {
      appStaticPrivkey,
      deviceStaticPubkeys: configData.deviceStaticPubkeys,
    };
    config.store(configData);
  }

  const handshakeStart = await hww.query(new Uint8Array([OP_I_CAN_HAS_HANDSHAEK]));
  if (handshakeStart.length !== 1 || handshakeStart[0] !== RESPONSE_SUCCESS) {
    throw new NoiseError('noise', 'device did not accept handshake start');
  }

  const xx = new NoiseXX(true, appStaticPrivkey);
  const m1 = xx.writeMessage();
  const m2 = await handshakeQuery(hww, m1);
  xx.readMessage(m2);
  const m3 = xx.writeMessage();
  const finishResponse = await handshakeQuery(hww, m3);
  const finalState = xx.finalize();

  const cached = config.read();
  const appWantsVerification = !containsDeviceStaticPubkey(cached, finalState.remoteStaticPubkey);
  const deviceWantsVerification =
    finishResponse.length === 1 && finishResponse[0] === DEVICE_PAIRING_REQUIRED;

  const pairingCode =
    appWantsVerification || deviceWantsVerification
      ? formatPairingCode(finalState.hash)
      : undefined;

  return { hww, config, finalState, pairingCode };
}

/**
 * Completes pairing: if a pairing code was shown the host issues
 * `OP_I_CAN_HAS_PAIRIN_VERIFICASHUN` and persists the device's static pubkey on
 * confirmation. Returns an encrypted-channel adapter for subsequent queries.
 * @internal
 */
export async function completePairing(state: PairingState): Promise<EncryptedChannel> {
  if (state.pairingCode !== undefined) {
    const verify = await state.hww.query(new Uint8Array([OP_I_CAN_HAS_PAIRIN_VERIFICASHUN]));
    if (verify.length !== 1 || verify[0] !== RESPONSE_SUCCESS) {
      throw new NoiseError('pairing-rejected', 'pairing code rejected by user');
    }
    const cached = state.config.read();
    const updated = addDeviceStaticPubkey(cached, state.finalState.remoteStaticPubkey);
    if (updated !== cached) {
      state.config.store(updated);
    }
  }
  return makeEncryptedChannel(state.hww, state.finalState.send, state.finalState.recv);
}

/** @internal */
export function makeEncryptedChannel(
  hww: PairingTransport,
  send: CipherState,
  recv: CipherState,
): EncryptedChannel {
  return {
    async query(plaintext: Uint8Array): Promise<Uint8Array> {
      const ciphertext = send.encryptWithAd(EMPTY, plaintext);
      const framed = new Uint8Array(ciphertext.length + 1);
      framed[0] = OP_NOISE_MSG;
      framed.set(ciphertext, 1);
      const response = await hww.query(framed);
      if (response.length < 1 || response[0] !== RESPONSE_SUCCESS) {
        throw makeError(CODE_UNEXPECTED_RESPONSE, 'BitBox returned an unexpected response');
      }
      return recv.decryptWithAd(EMPTY, response.slice(1));
    },
  };
}
