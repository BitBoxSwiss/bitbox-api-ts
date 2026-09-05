// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import {
  BTCRequestSchema,
  type BTCRequest,
  type BTCResponse,
  type BTCSignNextResponse,
} from '../../proto/gen/btc_pb.js';
import {
  RequestSchema,
  type Request,
} from '../../proto/gen/hww_pb.js';
import type { EncryptedChannel } from '../pairing.js';
import { query, unexpectedResponse } from '../proto-query.js';

export async function queryBtc(
  channel: EncryptedChannel,
  btcRequest: BTCRequest['request'],
): Promise<BTCResponse['response']> {
  const wrapped = create(RequestSchema, {
    request: {
      case: 'btc',
      value: create(BTCRequestSchema, { request: btcRequest }),
    },
  });
  const response = await query(channel, wrapped);
  if (response.response.case !== 'btc') {
    throw unexpectedResponse();
  }
  if (response.response.value.response.case === undefined) {
    throw unexpectedResponse('BitBox returned an empty Bitcoin response');
  }
  return response.response.value.response;
}

export async function queryBtcSignNext(
  channel: EncryptedChannel,
  request: Request['request'],
): Promise<BTCSignNextResponse> {
  const response = await query(channel, create(RequestSchema, { request }));
  if (response.response.case !== 'btcSignNext') {
    throw unexpectedResponse();
  }
  return response.response.value;
}

export async function queryNestedBtcSignNext(
  channel: EncryptedChannel,
  request: BTCRequest['request'],
): Promise<BTCSignNextResponse> {
  const response = await queryBtc(channel, request);
  if (response.case !== 'signNext') {
    throw unexpectedResponse();
  }
  return response.value;
}
