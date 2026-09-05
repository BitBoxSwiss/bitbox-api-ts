// SPDX-License-Identifier: Apache-2.0

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { PairedBitBox } from '../src/index.js';
import { DeviceInfoResponseSchema } from '../src/proto/gen/bitbox02_system_pb.js';
import { RootFingerprintResponseSchema } from '../src/proto/gen/common_pb.js';
import {
  RequestSchema,
  ResponseSchema,
  type Request,
  type Response,
} from '../src/proto/gen/hww_pb.js';
import type { EncryptedChannel } from '../src/internal/pairing.js';
import type { Info } from '../src/internal/hww.js';

const INFO: Info = {
  version: '9.26.1',
  product: 'bitbox02-multi',
  unlocked: true,
  initialized: true,
};

function responseFor(request: Request): Uint8Array {
  let response: Response;
  switch (request.request.case) {
    case 'deviceInfo':
      response = create(ResponseSchema, {
        response: {
          case: 'deviceInfo',
          value: create(DeviceInfoResponseSchema, {
            name: 'My BitBox',
            initialized: true,
            version: '9.26.1',
            mnemonicPassphraseEnabled: false,
            securechipModel: 'ATECC608B',
            monotonicIncrementsRemaining: 42,
            passwordStretchingAlgo: 'pwhash',
          }),
        },
      });
      break;
    case 'fingerprint':
      response = create(ResponseSchema, {
        response: {
          case: 'fingerprint',
          value: create(RootFingerprintResponseSchema, {
            fingerprint: new Uint8Array([0x4c, 0x00, 0x73, 0x9d]),
          }),
        },
      });
      break;
    case 'showMnemonic':
    case 'changePassword':
      response = create(ResponseSchema, { response: { case: 'success', value: {} } });
      break;
    case 'bip85':
      response = create(ResponseSchema, {
        response: {
          case: 'bip85',
          value: { app: { case: 'bip39', value: {} } },
        },
      });
      break;
    default:
      throw new Error(`unexpected request: ${request.request.case}`);
  }
  return toBinary(ResponseSchema, response);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class FakeDeviceChannel implements EncryptedChannel {
  readonly requests: Request['request']['case'][] = [];

  constructor(private readonly response?: Response) {}

  async query(plaintext: Uint8Array): Promise<Uint8Array> {
    const request = fromBinary(RequestSchema, plaintext);
    this.requests.push(request.request.case);
    return this.response === undefined
      ? responseFor(request)
      : toBinary(ResponseSchema, this.response);
  }
}

class EmptyResponseChannel implements EncryptedChannel {
  async query(_plaintext: Uint8Array): Promise<Uint8Array> {
    return toBinary(ResponseSchema, create(ResponseSchema, {}));
  }
}

class BlockingFirstQueryChannel implements EncryptedChannel {
  readonly requests: Request['request']['case'][] = [];
  activeQueries = 0;
  maxActiveQueries = 0;
  readonly firstQueryStarted = deferred();
  readonly releaseFirstQuery = deferred();

  async query(plaintext: Uint8Array): Promise<Uint8Array> {
    const request = fromBinary(RequestSchema, plaintext);
    this.requests.push(request.request.case);
    this.activeQueries += 1;
    this.maxActiveQueries = Math.max(this.maxActiveQueries, this.activeQueries);
    try {
      if (this.requests.length === 1) {
        this.firstQueryStarted.resolve();
        await this.releaseFirstQuery.promise;
      }
      return responseFor(request);
    } finally {
      this.activeQueries -= 1;
    }
  }
}

class FailsFirstChannel extends FakeDeviceChannel {
  override async query(plaintext: Uint8Array): Promise<Uint8Array> {
    const request = fromBinary(RequestSchema, plaintext);
    this.requests.push(request.request.case);
    if (this.requests.length === 1) {
      return toBinary(ResponseSchema, create(ResponseSchema, {}));
    }
    return responseFor(request);
  }
}

describe('device methods', () => {
  it('deviceInfo returns the wasm package DeviceInfo shape', async () => {
    const channel = new FakeDeviceChannel();
    const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

    const result = await paired.deviceInfo();

    expect(channel.requests).toEqual(['deviceInfo']);
    expect(result).toEqual({
      name: 'My BitBox',
      initialized: true,
      version: '9.26.1',
      mnemonicPassphraseEnabled: false,
      securechipModel: 'ATECC608B',
      monotonicIncrementsRemaining: 42,
    });
    expect('passwordStretchingAlgo' in result).toBe(false);
  });

  it('rootFingerprint returns lowercase hex', async () => {
    const channel = new FakeDeviceChannel();
    const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

    await expect(paired.rootFingerprint()).resolves.toBe('4c00739d');
    expect(channel.requests).toEqual(['fingerprint']);
  });

  it.each([
    // Rust sends empty ShowMnemonic/ChangePassword requests and expects Success.
    ['showMnemonic', '7.0.0', [0x3a, 0x00], [0x0a, 0x00]],
    ['changePassword', '9.25.0', [0xf2, 0x01, 0x00], [0x0a, 0x00]],
    // BIP85 requires the nested BIP39 app in both the request and response.
    ['bip85AppBip39', '9.17.0', [0xe2, 0x01, 0x02, 0x0a, 0x00], [0x82, 0x01, 0x02, 0x0a, 0x00]],
  ] as const)('%s uses the Rust protocol at its minimum firmware version', async (
    method, version, requestBytes, responseBytes,
  ) => {
    const query = vi.fn(async () => new Uint8Array(responseBytes));
    const paired = new PairedBitBox({
      channel: { query },
      info: { ...INFO, version },
      close(): void {},
    });

    await expect(paired[method]()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledExactlyOnceWith(new Uint8Array(requestBytes));
  });

  it.each([
    ['changePassword', '9.24.0', '>=9.25.0'],
    ['bip85AppBip39', '9.16.0', '>=9.17.0'],
  ] as const)('%s rejects older firmware before querying the device', async (
    method, version, required,
  ) => {
    const channel = new FakeDeviceChannel();
    const paired = new PairedBitBox({ channel, info: { ...INFO, version }, close(): void {} });

    await expect(paired[method]()).rejects.toMatchObject({
      code: 'version',
      message: `firmware version ${required} required`,
    });
    expect(channel.requests).toEqual([]);
  });

  describe.each(['showMnemonic', 'changePassword', 'bip85AppBip39'] as const)('%s', (method) => {
    it('rejects an unexpected response', async () => {
      const channel = new FakeDeviceChannel(create(ResponseSchema, {
        response: { case: 'fingerprint', value: {} },
      }));
      const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

      await expect(paired[method]()).rejects.toMatchObject({ code: 'unexpected-response' });
    });

    it('propagates device cancellation', async () => {
      const channel = new FakeDeviceChannel(create(ResponseSchema, {
        response: { case: 'error', value: { code: 104 } },
      }));
      const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

      await expect(paired[method]()).rejects.toMatchObject({
        code: 'bitbox-user-abort',
        message: 'bitbox error: aborted by the user',
      });
    });
  });

  it.each([
    create(ResponseSchema, { response: { case: 'success', value: {} } }),
    create(ResponseSchema, { response: { case: 'bip85', value: {} } }),
    create(ResponseSchema, {
      response: { case: 'bip85', value: { app: { case: 'ln', value: new Uint8Array(32) } } },
    }),
  ])('bip85AppBip39 requires a BIP39 app response (%#)', async (response) => {
    const channel = new FakeDeviceChannel(response);
    const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

    await expect(paired.bip85AppBip39()).rejects.toMatchObject({ code: 'unexpected-response' });
  });

  it('maps a missing top-level response oneof to protobuf-decode', async () => {
    const channel = new EmptyResponseChannel();
    const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

    await expect(paired.deviceInfo()).rejects.toMatchObject({
      code: 'protobuf-decode',
      message: 'protobuf message could not be decoded',
    });
  });

  it('serializes concurrent device queries', async () => {
    const channel = new BlockingFirstQueryChannel();
    const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

    const deviceInfo = paired.deviceInfo();
    await channel.firstQueryStarted.promise;

    const rootFingerprint = paired.rootFingerprint();
    const showMnemonic = paired.showMnemonic();
    const changePassword = paired.changePassword();
    const bip85AppBip39 = paired.bip85AppBip39();
    await Promise.resolve();
    await Promise.resolve();

    expect(channel.requests).toEqual(['deviceInfo']);
    expect(channel.maxActiveQueries).toBe(1);

    channel.releaseFirstQuery.resolve();
    await expect(Promise.all([
      deviceInfo, rootFingerprint, showMnemonic, changePassword, bip85AppBip39,
    ])).resolves.toEqual([
      {
        name: 'My BitBox',
        initialized: true,
        version: '9.26.1',
        mnemonicPassphraseEnabled: false,
        securechipModel: 'ATECC608B',
        monotonicIncrementsRemaining: 42,
      },
      '4c00739d',
      undefined,
      undefined,
      undefined,
    ]);
    expect(channel.requests).toEqual([
      'deviceInfo', 'fingerprint', 'showMnemonic', 'changePassword', 'bip85',
    ]);
    expect(channel.maxActiveQueries).toBe(1);
  });

  it('continues serializing after a rejected query', async () => {
    const channel = new FailsFirstChannel();
    const paired = new PairedBitBox({ channel, info: INFO, close(): void {} });

    await expect(paired.deviceInfo()).rejects.toMatchObject({ code: 'protobuf-decode' });
    await expect(paired.rootFingerprint()).resolves.toBe('4c00739d');
    expect(channel.requests).toEqual(['deviceInfo', 'fingerprint']);
  });
});
