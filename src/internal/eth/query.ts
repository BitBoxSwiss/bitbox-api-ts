// SPDX-License-Identifier: Apache-2.0

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  ETHRequestSchema,
  type ETHRequest,
  type ETHResponse,
} from '../../proto/gen/eth_pb.js';
import {
  RequestSchema,
  ResponseSchema,
  type Request,
  type Response,
} from '../../proto/gen/hww_pb.js';
import type { EncryptedChannel } from '../pairing.js';

class TypedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const DEVICE_ERROR_CODES: Record<number, string> = {
  101: 'bitbox-invalid-input',
  102: 'bitbox-memory',
  103: 'bitbox-generic',
  104: 'bitbox-user-abort',
  105: 'bitbox-invalid-state',
  106: 'bitbox-disabled',
  107: 'bitbox-duplicate',
  108: 'bitbox-noise-encrypt',
  109: 'bitbox-noise-decrypt',
};

export async function query(
  channel: EncryptedChannel,
  request: Request,
): Promise<Response> {
  const encoded = toBinary(RequestSchema, request);
  const responseBytes = await channel.query(encoded);
  let decoded: Response;
  try {
    decoded = fromBinary(ResponseSchema, responseBytes);
  } catch {
    throw new TypedError('protobuf-decode', 'protobuf message could not be decoded');
  }
  if (decoded.response.case === 'error') {
    const { code, message } = decoded.response.value;
    const mapped = DEVICE_ERROR_CODES[code] ?? 'bitbox-unknown';
    throw new TypedError(mapped, message || `device error ${code}`);
  }
  return decoded;
}

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
    throw new TypedError('unexpected-response', 'BitBox returned an unexpected response');
  }
  if (response.response.value.response.case === undefined) {
    throw new TypedError('unexpected-response', 'BitBox returned an empty ETH response');
  }
  return response.response.value.response;
}

export function unexpectedResponse(message = 'BitBox returned an unexpected response'): TypedError {
  return new TypedError('unexpected-response', message);
}
