// SPDX-License-Identifier: Apache-2.0

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  type ETHRequest,
  type ETHResponse,
  ETHResponseSchema,
} from '../src/proto/gen/eth_pb.js';
import {
  ErrorSchema,
  RequestSchema,
  ResponseSchema,
  type Response,
} from '../src/proto/gen/hww_pb.js';
import type { EncryptedChannel } from '../src/internal/pairing.js';

export type EthRequestCase = ETHRequest['request']['case'];

export type EthRequestOf<T extends EthRequestCase> = Extract<
  ETHRequest['request'],
  { case: T }
>;

export type ScriptedStep =
  | {
    kind: 'eth';
    expect: (req: ETHRequest['request']) => void;
    respond: ETHResponse['response'];
  }
  | {
    kind: 'eth-error';
    expect: (req: ETHRequest['request']) => void;
    code: number;
    message?: string;
  };

export class ScriptedChannel implements EncryptedChannel {
  private cursor = 0;
  readonly seen: ETHRequest['request'][] = [];

  constructor(private readonly steps: ScriptedStep[]) {}

  async query(plaintext: Uint8Array): Promise<Uint8Array> {
    if (this.cursor >= this.steps.length) {
      throw new Error(`script exhausted at request #${this.cursor}`);
    }
    const step = this.steps[this.cursor];
    this.cursor += 1;
    const decoded = fromBinary(RequestSchema, plaintext);
    if (decoded.request.case !== 'eth') {
      throw new Error(`expected eth request, got ${decoded.request.case ?? 'undefined'}`);
    }
    const ethRequest = decoded.request.value.request;
    if (ethRequest.case === undefined) {
      throw new Error('empty eth request oneof');
    }
    this.seen.push(ethRequest);
    if (step === undefined) {
      throw new Error('script step missing');
    }
    step.expect(ethRequest);
    if (step.kind === 'eth') {
      const ethResponse = create(ETHResponseSchema, { response: step.respond });
      const response: Response = create(ResponseSchema, {
        response: { case: 'eth', value: ethResponse },
      });
      return toBinary(ResponseSchema, response);
    }
    const err = create(ErrorSchema, { code: step.code, message: step.message ?? '' });
    const response: Response = create(ResponseSchema, {
      response: { case: 'error', value: err },
    });
    return toBinary(ResponseSchema, response);
  }

  remaining(): number {
    return this.steps.length - this.cursor;
  }
}
