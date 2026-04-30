// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import { RequestSchema } from '../proto/gen/hww_pb.js';
import { RestoreFromMnemonicRequestSchema } from '../proto/gen/mnemonic_pb.js';
import { query } from './eth/query.js';
import { CODE_UNEXPECTED_RESPONSE, makeError } from './errors.js';
import type { EncryptedChannel } from './pairing.js';

const UINT32_MAX = 0xffffffff;

export async function restoreFromMnemonic(channel: EncryptedChannel): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const timestamp = nowSec >= 0 && nowSec <= UINT32_MAX ? nowSec : 0;
  // getTimezoneOffset returns minutes WEST of UTC; firmware expects seconds EAST of UTC.
  const timezoneOffset = -new Date().getTimezoneOffset() * 60;

  const request = create(RequestSchema, {
    request: {
      case: 'restoreFromMnemonic',
      value: create(RestoreFromMnemonicRequestSchema, {
        timestamp,
        timezoneOffset,
      }),
    },
  });
  const response = await query(channel, request);
  if (response.response.case !== 'success') {
    throw makeError(CODE_UNEXPECTED_RESPONSE, 'unexpected response to restoreFromMnemonic');
  }
}
