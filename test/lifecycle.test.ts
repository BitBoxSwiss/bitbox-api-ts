// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import {
  BitBox,
  PairedBitBox,
  PairingBitBox,
  ensureError,
  type Error as BitboxError,
} from '../src/index.js';
import type { ConnectSession } from '../src/internal/connect.js';
import type { HwwCommunication, Info } from '../src/internal/hww.js';
import {
  InMemoryNoiseConfig,
  NoiseConfigNoCache,
  type NoiseConfig,
} from '../src/internal/noise-config.js';
import {
  NoiseXX,
  publicKeyFromPrivateKey,
  type HandshakeFinalState,
} from '../src/internal/noise.js';
import type { EncryptedChannel, PairingTransport } from '../src/internal/pairing.js';
import { hwwSuccess as success, pinned32 } from './utils.js';

const OP_UNLOCK = 0x75;
const OP_I_CAN_HAS_HANDSHAEK = 0x68;
const OP_HER_COMEZ_TEH_HANDSHAEK = 0x48;
const OP_I_CAN_HAS_PAIRIN_VERIFICASHUN = 0x76;
const OP_NOISE_MSG = 0x6e;
const EMPTY = new Uint8Array(0);

const INFO: Info = {
  version: '9.24.0',
  product: 'bitbox02-multi',
  unlocked: false,
  initialized: true,
};

class FakePairingDevice implements PairingTransport {
  readonly info = INFO;
  private noise: NoiseXX | undefined;
  private finalState: HandshakeFinalState | undefined;
  private handshakeMessages = 0;

  constructor(private readonly staticPrivateKey: Uint8Array) {}

  async query(msg: Uint8Array): Promise<Uint8Array> {
    const opcode = msg[0];
    const payload = msg.slice(1);
    if (opcode === OP_UNLOCK) {
      return success();
    }
    if (opcode === OP_I_CAN_HAS_HANDSHAEK) {
      this.noise = new NoiseXX(false, this.staticPrivateKey, {
        fixedEphemeralPrivateKey: pinned32(90),
      });
      this.handshakeMessages = 0;
      return success();
    }
    if (opcode === OP_HER_COMEZ_TEH_HANDSHAEK) {
      if (this.noise === undefined) {
        throw new Error('handshake before start');
      }
      if (this.handshakeMessages === 0) {
        this.noise.readMessage(payload);
        this.handshakeMessages = 1;
        return success(this.noise.writeMessage());
      }
      this.noise.readMessage(payload);
      this.finalState = this.noise.finalize();
      this.handshakeMessages = 2;
      return success(new Uint8Array([0x00])); // device does NOT require verification
    }
    if (opcode === OP_I_CAN_HAS_PAIRIN_VERIFICASHUN) {
      return success();
    }
    if (opcode === OP_NOISE_MSG) {
      if (this.finalState === undefined) {
        throw new Error('encrypted query before handshake done');
      }
      const plaintext = this.finalState.recv.decryptWithAd(EMPTY, payload);
      const response = this.finalState.send.encryptWithAd(EMPTY, plaintext);
      return success(response);
    }
    throw new Error(`unexpected opcode: ${opcode}`);
  }
}

function preTrustedConfig(deviceSk: Uint8Array): NoiseConfig {
  const cfg = new InMemoryNoiseConfig();
  cfg.store({
    appStaticPrivkey: pinned32(41),
    deviceStaticPubkeys: [publicKeyFromPrivateKey(deviceSk)],
  });
  return cfg;
}

function makeSession(
  hww: PairingTransport,
  close: () => void,
  config: NoiseConfig,
): ConnectSession {
  // PairingTransport is a minimal interface; HwwCommunication is structurally
  // compatible for the handshake/encrypted query path used by performHandshake.
  return { hww: hww as unknown as HwwCommunication, close, config };
}

function asBitboxError(err: unknown): BitboxError {
  return ensureError(err);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('BitBox lifecycle', () => {
  it('raw new BitBox().unlockAndPair() rejects with invalid-state', async () => {
    const b = new BitBox();
    await expect(b.unlockAndPair()).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('successful unlockAndPair consumes the BitBox; second call rejects synchronously', async () => {
    const deviceSk = pinned32(30);
    const close = vi.fn();
    const session = makeSession(new FakePairingDevice(deviceSk), close, preTrustedConfig(deviceSk));
    const bitbox = new BitBox(session);

    const pairing = await bitbox.unlockAndPair();
    expect(pairing).toBeInstanceOf(PairingBitBox);

    await expect(bitbox.unlockAndPair()).rejects.toMatchObject({ code: 'invalid-state' });
    // close on the original transport must NOT have been called on success;
    // ownership has moved to the resulting PairingBitBox.
    expect(close).not.toHaveBeenCalled();
  });

  it('concurrent unlockAndPair: second call rejects synchronously while the first is in flight', async () => {
    const deviceSk = pinned32(31);
    const session = makeSession(new FakePairingDevice(deviceSk), () => {}, preTrustedConfig(deviceSk));
    const bitbox = new BitBox(session);

    const first = bitbox.unlockAndPair();
    // Synchronously enqueued before any await: second call must already see the
    // BitBox as consumed because the first burned it on entry.
    const second = bitbox.unlockAndPair();
    await expect(second).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(first).resolves.toBeInstanceOf(PairingBitBox);
  });

  it('failed handshake invokes the transport close callback while preserving the original error', async () => {
    const close = vi.fn();
    const original = new Error('boom: transport handshake failed');
    const failingTransport: PairingTransport = {
      info: INFO,
      query: async () => { throw original; },
    };
    const bitbox = new BitBox(makeSession(failingTransport, close, new NoiseConfigNoCache()));

    let caught: BitboxError | undefined;
    try {
      await bitbox.unlockAndPair();
    } catch (err) {
      caught = asBitboxError(err);
    }
    expect(caught?.code).toBe('unknown-js');
    expect(caught?.err).toBe(original);
    expect(close).toHaveBeenCalledTimes(1);

    // Object is consumed even after failure.
    await expect(bitbox.unlockAndPair()).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('failed handshake whose close() also throws still surfaces the original error', async () => {
    const original = new Error('original-handshake-error');
    const failingTransport: PairingTransport = {
      info: INFO,
      query: async () => { throw original; },
    };
    const close = vi.fn(() => {
      throw new Error('teardown-also-broke');
    });
    const bitbox = new BitBox(makeSession(failingTransport, close, new NoiseConfigNoCache()));

    let caught: BitboxError | undefined;
    try {
      await bitbox.unlockAndPair();
    } catch (err) {
      caught = asBitboxError(err);
    }
    expect(caught?.err).toBe(original);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('PairingBitBox lifecycle', () => {
  it('raw new PairingBitBox().getPairingCode() throws invalid-state', () => {
    const p = new PairingBitBox();
    expect(() => p.getPairingCode()).toThrow();
    try {
      p.getPairingCode();
    } catch (err) {
      expect(asBitboxError(err).code).toBe('invalid-state');
    }
  });

  it('raw new PairingBitBox().waitConfirm() rejects with invalid-state', async () => {
    const p = new PairingBitBox();
    await expect(p.waitConfirm()).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('waitConfirm consumes the PairingBitBox; second call rejects with invalid-state', async () => {
    const deviceSk = pinned32(32);
    const session = makeSession(new FakePairingDevice(deviceSk), () => {}, preTrustedConfig(deviceSk));
    const bitbox = new BitBox(session);
    const pairing = await bitbox.unlockAndPair();

    const paired = await pairing.waitConfirm();
    expect(paired).toBeInstanceOf(PairedBitBox);
    await expect(pairing.waitConfirm()).rejects.toMatchObject({ code: 'invalid-state' });
    // Reading the pairing code after consume is also a programming error.
    try {
      pairing.getPairingCode();
      throw new Error('expected getPairingCode() to throw after consumption');
    } catch (err) {
      expect(asBitboxError(err).code).toBe('invalid-state');
    }
    paired.close();
  });

  it('failed waitConfirm invokes transport close exactly once when verification fails', async () => {
    const deviceSk = pinned32(34);
    const close = vi.fn();
    const fake = new FakePairingDevice(deviceSk);
    const original = new Error('verify-failed');
    const transport: PairingTransport = {
      info: INFO,
      query: async (msg) => {
        const opcode = msg[0];
        if (opcode === OP_I_CAN_HAS_PAIRIN_VERIFICASHUN) {
          throw original;
        }
        return await fake.query(msg);
      },
    };
    // Untrusted config forces the verification step in completePairing.
    const config = new InMemoryNoiseConfig();
    const bitbox = new BitBox(makeSession(transport, close, config));
    const pairing = await bitbox.unlockAndPair();
    expect(close).not.toHaveBeenCalled();

    let caught: BitboxError | undefined;
    try {
      await pairing.waitConfirm();
    } catch (err) {
      caught = asBitboxError(err);
    }
    expect(caught?.err).toBe(original);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(pairing.waitConfirm()).rejects.toMatchObject({ code: 'invalid-state' });
  });
});

describe('PairedBitBox lifecycle', () => {
  it('raw new PairedBitBox(): sync getters throw invalid-state', () => {
    const p = new PairedBitBox();
    expect(() => p.product()).toThrow();
    expect(() => p.version()).toThrow();
    expect(() => p.ethSupported()).toThrow();
    try { p.product(); } catch (err) { expect(asBitboxError(err).code).toBe('invalid-state'); }
    try { p.version(); } catch (err) { expect(asBitboxError(err).code).toBe('invalid-state'); }
    try { p.ethSupported(); } catch (err) { expect(asBitboxError(err).code).toBe('invalid-state'); }
  });

  it('raw new PairedBitBox(): promise-returning methods reject with invalid-state', async () => {
    const p = new PairedBitBox();
    await expect(p.deviceInfo()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.rootFingerprint()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.showMnemonic()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.changePassword()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.btcXpub('btc', [0], 'xpub', false)).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.ethXpub("m/44'/60'/0'/0/0")).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.ethAddress(1n, "m/44'/60'/0'/0/0", false)).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.cardanoXpubs([[0]])).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(p.bip85AppBip39()).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('raw new PairedBitBox().close() is a no-op', () => {
    const p = new PairedBitBox();
    expect(() => p.close()).not.toThrow();
  });

  it('close() invokes the transport close exactly once and then methods reject with invalid-state', async () => {
    const deviceSk = pinned32(35);
    const close = vi.fn();
    const session = makeSession(new FakePairingDevice(deviceSk), close, preTrustedConfig(deviceSk));
    const bitbox = new BitBox(session);
    const pairing = await bitbox.unlockAndPair();
    const paired = await pairing.waitConfirm();

    expect(paired.product()).toBe('bitbox02-multi');
    await expect(paired.changePassword()).rejects.toMatchObject({ code: 'version' });
    await expect(paired.btcXpub('btc', [0], 'xpub', false)).rejects.toMatchObject({
      code: 'unexpected-response',
    });

    paired.close();
    expect(close).toHaveBeenCalledTimes(1);

    // Idempotent: subsequent close() does not invoke the callback again.
    paired.close();
    paired.close();
    expect(close).toHaveBeenCalledTimes(1);

    // Other methods after close fail with invalid-state.
    expect(() => paired.product()).toThrowError();
    try { paired.product(); } catch (err) { expect(asBitboxError(err).code).toBe('invalid-state'); }
    await expect(paired.deviceInfo()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(paired.rootFingerprint()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(paired.showMnemonic()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(paired.changePassword()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(paired.bip85AppBip39()).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(paired.btcXpub('btc', [0], 'xpub', false)).rejects.toMatchObject({ code: 'invalid-state' });
    await expect(paired.ethXpub("m/44'/60'/0'/0/0")).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('methods called after close reject without waiting for a pending device call', async () => {
    const queryStarted = deferred();
    const channel: EncryptedChannel = {
      async query(): Promise<Uint8Array> {
        queryStarted.resolve();
        return new Promise<Uint8Array>(() => {});
      },
    };
    const close = vi.fn();
    const paired = new PairedBitBox({ channel, info: INFO, close });

    void paired.deviceInfo().catch(() => undefined);
    await queryStarted.promise;

    paired.close();

    const postCloseResult = paired.rootFingerprint().then(
      () => 'resolved',
      err => asBitboxError(err).code,
    );
    await expect(Promise.race([
      postCloseResult,
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('pending'), 25);
      }),
    ])).resolves.toBe('invalid-state');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
