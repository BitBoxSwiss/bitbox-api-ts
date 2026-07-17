// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import {
  CardanoRequestSchema,
  type CardanoRequest,
  type CardanoResponse,
} from '../../proto/gen/cardano_pb.js';
import {
  RequestSchema,
  type Request,
} from '../../proto/gen/hww_pb.js';
import type { EncryptedChannel } from '../pairing.js';
import { query, unexpectedResponse } from '../proto-query.js';

export async function queryCardano(
  channel: EncryptedChannel,
  cardanoRequest: CardanoRequest['request'],
): Promise<CardanoResponse['response']> {
  const cardanoReq = create(CardanoRequestSchema, { request: cardanoRequest });
  const wrapped: Request = create(RequestSchema, {
    request: { case: 'cardano', value: cardanoReq },
  });
  const response = await query(channel, wrapped);
  if (response.response.case !== 'cardano') {
    throw unexpectedResponse();
  }
  if (response.response.value.response.case === undefined) {
    throw unexpectedResponse('BitBox returned an empty Cardano response');
  }
  return response.response.value.response;
}
