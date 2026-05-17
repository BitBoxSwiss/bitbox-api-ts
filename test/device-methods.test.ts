// SPDX-License-Identifier: Apache-2.0

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
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

class FakeDeviceChannel implements EncryptedChannel {
  readonly requests: Request['request']['case'][] = [];

  async query(plaintext: Uint8Array): Promise<Uint8Array> {
    const request = fromBinary(RequestSchema, plaintext);
    this.requests.push(request.request.case);
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
      default:
        throw new Error(`unexpected request: ${request.request.case}`);
    }
    return toBinary(ResponseSchema, response);
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
});
