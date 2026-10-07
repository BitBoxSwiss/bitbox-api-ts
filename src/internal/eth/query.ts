// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import {
  ETHRequestSchema,
  type ETHRequest,
  type ETHResponse,
} from '../../proto/gen/eth_pb.js';
import {
  RequestSchema,
  type Request,
} from '../../proto/gen/hww_pb.js';
import type { EncryptedChannel } from '../pairing.js';
import { query, unexpectedResponse } from '../proto-query.js';

export async function queryEth(
  channel: EncryptedChannel,
  ethRequest: ETHRequest['request'],
): Promise<ETHResponse['response']> {
  const ethReq = create(ETHRequestSchema, { request: ethRequest });
  const wrapped: Request = create(RequestSchema, {
    request: { case: 'eth', value: ethReq },
  });
  const response = await query(channel, wrapped);
  if (response.response.case !== 'eth') {
    throw unexpectedResponse();
  }
  if (response.response.value.response.case === undefined) {
    throw unexpectedResponse('BitBox returned an empty ETH response');
  }
  return response.response.value.response;
}
