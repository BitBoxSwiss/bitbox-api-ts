// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type { Info } from '../src/internal/hww.js';
import { InMemoryNoiseConfig, containsDeviceStaticPubkey } from '../src/internal/noise-config.js';
import { NoiseXX, publicKeyFromPrivateKey, type HandshakeFinalState } from '../src/internal/noise.js';
import {
  completePairing,
  performHandshake,
  type PairingTransport,
} from '../src/internal/pairing.js';
import { bytes, hwwFailure, hwwSuccess as success, pinned32 } from './utils.js';

const OP_UNLOCK = 0x75; // 'u'
const OP_I_CAN_HAS_HANDSHAEK = 0x68; // 'h'
const OP_HER_COMEZ_TEH_HANDSHAEK = 0x48; // 'H'
const OP_I_CAN_HAS_PAIRIN_VERIFICASHUN = 0x76; // 'v'
const OP_NOISE_MSG = 0x6e; // 'n'

const EMPTY = new Uint8Array(0);

const INFO: Info = {
  version: '9.24.0',
  product: 'bitbox02-multi',
  unlocked: false,
  initialized: true,
};

class FakePairingDevice implements PairingTransport {
  readonly info = INFO;
  readonly requests: number[] = [];
  verifyCalls = 0;

  private noise: NoiseXX | undefined;
  private finalState: HandshakeFinalState | undefined;
  private handshakeMessages = 0;

  constructor(
    private readonly staticPrivateKey: Uint8Array,
    private readonly options: {
      deviceRequiresVerification: boolean;
      rejectVerification?: boolean;
    },
  ) {}

  async query(msg: Uint8Array): Promise<Uint8Array> {
    const opcode = msg[0];
    if (opcode === undefined) {
      throw new Error('empty request');
    }
    const payload = msg.slice(1);
    this.requests.push(opcode);

    if (opcode === OP_UNLOCK) {
      expect(payload).toEqual(EMPTY);
      return success();
    }
    if (opcode === OP_I_CAN_HAS_HANDSHAEK) {
      expect(payload).toEqual(EMPTY);
      this.noise = new NoiseXX(false, this.staticPrivateKey, {
        fixedEphemeralPrivateKey: pinned32(90),
      });
      this.handshakeMessages = 0;
      return success();
    }
    if (opcode === OP_HER_COMEZ_TEH_HANDSHAEK) {
      return this.handleHandshake(payload);
    }
    if (opcode === OP_I_CAN_HAS_PAIRIN_VERIFICASHUN) {
      expect(payload).toEqual(EMPTY);
      this.verifyCalls += 1;
      return this.options.rejectVerification ? hwwFailure() : success();
    }
    if (opcode === OP_NOISE_MSG) {
      return this.handleEncryptedQuery(payload);
    }
    throw new Error(`unexpected opcode: ${opcode}`);
  }

  private handleHandshake(payload: Uint8Array): Uint8Array {
    if (this.noise === undefined) {
      throw new Error('handshake before start');
    }
    if (this.handshakeMessages === 0) {
      this.noise.readMessage(payload);
      this.handshakeMessages = 1;
      return success(this.noise.writeMessage());
    }
    if (this.handshakeMessages === 1) {
      this.noise.readMessage(payload);
      this.finalState = this.noise.finalize();
      this.handshakeMessages = 2;
      return success(bytes(this.options.deviceRequiresVerification ? 0x01 : 0x00));
    }
    throw new Error('too many handshake messages');
  }

  private handleEncryptedQuery(ciphertext: Uint8Array): Uint8Array {
    if (this.finalState === undefined) {
      throw new Error('encrypted query before completed handshake');
    }
    const plaintext = this.finalState.recv.decryptWithAd(EMPTY, ciphertext);
    const response = this.finalState.send.encryptWithAd(EMPTY, plaintext);
    return success(response);
  }
}

describe('pairing flow', () => {
  it('shows a pairing code for a new device and stores the device key after confirmation', async () => {
    const deviceSk = pinned32(30);
    const config = new InMemoryNoiseConfig();
    const device = new FakePairingDevice(deviceSk, { deviceRequiresVerification: true });

    const state = await performHandshake(device, config);
    expect(state.pairingCode).toMatch(/^[A-Z2-7]{5} [A-Z2-7]{5}\n[A-Z2-7]{5} [A-Z2-7]{5}$/);
    expect(containsDeviceStaticPubkey(config.read(), publicKeyFromPrivateKey(deviceSk))).toBe(false);

    const channel = await completePairing(state);
    expect(device.verifyCalls).toBe(1);
    expect(containsDeviceStaticPubkey(config.read(), publicKeyFromPrivateKey(deviceSk))).toBe(true);
    expect(await channel.query(bytes(0x01, 0x02, 0x03))).toEqual(bytes(0x01, 0x02, 0x03));
  });

  it('skips pairing verification when app and device both trust the cached key', async () => {
    const deviceSk = pinned32(40);
    const config = new InMemoryNoiseConfig();
    config.store({
      appStaticPrivkey: pinned32(41),
      deviceStaticPubkeys: [publicKeyFromPrivateKey(deviceSk)],
    });
    const device = new FakePairingDevice(deviceSk, { deviceRequiresVerification: false });

    const state = await performHandshake(device, config);
    expect(state.pairingCode).toBeUndefined();

    await completePairing(state);
    expect(device.verifyCalls).toBe(0);
  });

  it('verifies pairing when the device requests it even if the app has a cached key', async () => {
    const deviceSk = pinned32(50);
    const config = new InMemoryNoiseConfig();
    config.store({
      appStaticPrivkey: pinned32(51),
      deviceStaticPubkeys: [publicKeyFromPrivateKey(deviceSk)],
    });
    const device = new FakePairingDevice(deviceSk, { deviceRequiresVerification: true });

    const state = await performHandshake(device, config);
    expect(state.pairingCode).toBeDefined();

    await completePairing(state);
    expect(device.verifyCalls).toBe(1);
  });

  it('does not store the device key when pairing confirmation is rejected', async () => {
    const deviceSk = pinned32(60);
    const config = new InMemoryNoiseConfig();
    const device = new FakePairingDevice(deviceSk, {
      deviceRequiresVerification: true,
      rejectVerification: true,
    });

    const state = await performHandshake(device, config);
    await expect(completePairing(state)).rejects.toMatchObject({
      code: 'pairing-rejected',
      message: 'pairing code rejected by user',
    });
    expect(containsDeviceStaticPubkey(config.read(), publicKeyFromPrivateKey(deviceSk))).toBe(false);
  });
});
