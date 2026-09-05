// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import { bytesToHex } from '@noble/hashes/utils';
import type { DeviceInfo } from '../index.js';
import {
  ChangePasswordRequestSchema,
  DeviceInfoRequestSchema,
} from '../proto/gen/bitbox02_system_pb.js';
import { RootFingerprintRequestSchema } from '../proto/gen/common_pb.js';
import { RequestSchema } from '../proto/gen/hww_pb.js';
import { BIP85RequestSchema } from '../proto/gen/keystore_pb.js';
import { ShowMnemonicRequestSchema } from '../proto/gen/mnemonic_pb.js';
import type { Info } from './hww.js';
import type { EncryptedChannel } from './pairing.js';
import { query, unexpectedResponse } from './proto-query.js';
import { requireVersion } from './version.js';

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

/** Show recovery words on the BitBox. */
export async function showMnemonic(channel: EncryptedChannel): Promise<void> {
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'showMnemonic',
      value: create(ShowMnemonicRequestSchema),
    },
  }));
  if (response.response.case !== 'success') {
    throw unexpectedResponse();
  }
}

/** Invokes the password change workflow on the device. Requires firmware >=9.25.0. */
export async function changePassword(channel: EncryptedChannel, info: Info): Promise<void> {
  requireVersion(info, { major: 9, minor: 25, patch: 0 });
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'changePassword',
      value: create(ChangePasswordRequestSchema),
    },
  }));
  if (response.response.case !== 'success') {
    throw unexpectedResponse();
  }
}

/**
 * Invokes the BIP85-BIP39 workflow on the device, letting the user select the number of words
 * (12, 18, 24) and an index and display a derived BIP-39 mnemonic.
 */
export async function bip85AppBip39(channel: EncryptedChannel, info: Info): Promise<void> {
  requireVersion(info, { major: 9, minor: 17, patch: 0 });
  const response = await query(channel, create(RequestSchema, {
    request: {
      case: 'bip85',
      value: create(BIP85RequestSchema, { app: { case: 'bip39', value: {} } }),
    },
  }));
  if (response.response.case !== 'bip85' || response.response.value.app.case !== 'bip39') {
    throw unexpectedResponse();
  }
}
