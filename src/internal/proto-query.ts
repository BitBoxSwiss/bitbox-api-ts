// SPDX-License-Identifier: Apache-2.0

import { fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  RequestSchema,
  ResponseSchema,
  type Request,
  type Response,
} from '../proto/gen/hww_pb.js';
import type { EncryptedChannel } from './pairing.js';
import {
  CODE_PROTOBUF_DECODE,
  CODE_UNEXPECTED_RESPONSE,
  deviceErrorFor,
  makeError,
} from './errors.js';

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
    throw makeError(CODE_PROTOBUF_DECODE, 'protobuf message could not be decoded');
  }
  if (decoded.response.case === undefined) {
    throw makeError(CODE_PROTOBUF_DECODE, 'protobuf message could not be decoded');
  }
  if (decoded.response.case === 'error') {
    const { code: numericCode } = decoded.response.value;
    const { code, message } = deviceErrorFor(numericCode);
    throw makeError(code, message);
  }
  return decoded;
}

export function unexpectedResponse(message = 'BitBox returned an unexpected response'): Error {
  return makeError(CODE_UNEXPECTED_RESPONSE, message);
}
