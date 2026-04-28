// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import {
  ETHSignDataResponseChunkRequestSchema,
  type ETHResponse,
} from '../../proto/gen/eth_pb.js';
import type { EncryptedChannel } from '../pairing.js';
import { queryEth, unexpectedResponse } from './query.js';

export async function handleEthDataStreaming(
  channel: EncryptedChannel,
  data: Uint8Array,
  initialResponse: ETHResponse['response'],
): Promise<ETHResponse['response']> {
  let response = initialResponse;
  while (response.case === 'dataRequestChunk') {
    const { offset, length } = response.value;
    const end = offset + length;
    if (offset > data.length || end > data.length) {
      throw unexpectedResponse('chunk request out of range');
    }
    const chunk = data.subarray(offset, end);
    response = await queryEth(channel, {
      case: 'dataResponseChunk',
      value: create(ETHSignDataResponseChunkRequestSchema, { chunk }),
    });
  }
  return response;
}
