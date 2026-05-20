// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import { bytesToHex } from '@noble/hashes/utils';
import type { DeviceInfo } from '../index.js';
import { DeviceInfoRequestSchema } from '../proto/gen/bitbox02_system_pb.js';
import { RootFingerprintRequestSchema } from '../proto/gen/common_pb.js';
import { RequestSchema } from '../proto/gen/hww_pb.js';
import type { EncryptedChannel } from './pairing.js';
import { query, unexpectedResponse } from './eth/query.js';

export async function deviceInfo(channel: EncryptedChannel): Promise<DeviceInfo> {
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'deviceInfo',
      value: create(DeviceInfoRequestSchema),
    },
  }));
  if (response.response.case !== 'deviceInfo') {
    throw unexpectedResponse();
  }
  const value = response.response.value;
  return {
    name: value.name,
    initialized: value.initialized,
    version: value.version,
    mnemonicPassphraseEnabled: value.mnemonicPassphraseEnabled,
    securechipModel: value.securechipModel,
    monotonicIncrementsRemaining: value.monotonicIncrementsRemaining,
  };
}

export async function rootFingerprint(channel: EncryptedChannel): Promise<string> {
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'fingerprint',
      value: create(RootFingerprintRequestSchema),
    },
  }));
  if (response.response.case !== 'fingerprint') {
    throw unexpectedResponse();
  }
  return bytesToHex(response.response.value.fingerprint);
}
