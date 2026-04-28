// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import {
  ETHSignDataRequestChunkResponseSchema,
  ETHSignResponseSchema,
} from '../src/proto/gen/eth_pb.js';
import { handleEthDataStreaming } from '../src/internal/eth/streaming.js';
import { ScriptedChannel } from './eth-fake-channel.js';

function makeData(len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = i & 0xff;
  }
  return out;
}

describe('handleEthDataStreaming', () => {
  it('answers chunk requests in order and returns the terminal response', async () => {
    const data = makeData(10000);
    const sigBytes = new Uint8Array(65);
    sigBytes.fill(0x42);

    const channel = new ScriptedChannel([
      {
        kind: 'eth',
        expect: (req) => {
          expect(req.case).toBe('dataResponseChunk');
          if (req.case === 'dataResponseChunk') {
            expect(Array.from(req.value.chunk)).toEqual(Array.from(data.subarray(0, 4096)));
          }
        },
        respond: {
          case: 'dataRequestChunk',
          value: create(ETHSignDataRequestChunkResponseSchema, {
            offset: 4096,
            length: 4096,
          }),
        },
      },
      {
        kind: 'eth',
        expect: (req) => {
          expect(req.case).toBe('dataResponseChunk');
          if (req.case === 'dataResponseChunk') {
            expect(Array.from(req.value.chunk)).toEqual(
              Array.from(data.subarray(4096, 8192)),
            );
          }
        },
        respond: {
          case: 'dataRequestChunk',
          value: create(ETHSignDataRequestChunkResponseSchema, {
            offset: 8192,
            length: data.length - 8192,
          }),
        },
      },
      {
        kind: 'eth',
        expect: (req) => {
          expect(req.case).toBe('dataResponseChunk');
          if (req.case === 'dataResponseChunk') {
            expect(Array.from(req.value.chunk)).toEqual(Array.from(data.subarray(8192)));
          }
        },
        respond: {
          case: 'sign',
          value: create(ETHSignResponseSchema, { signature: sigBytes }),
        },
      },
    ]);

    const initial = {
      case: 'dataRequestChunk' as const,
      value: create(ETHSignDataRequestChunkResponseSchema, { offset: 0, length: 4096 }),
    };
    const final = await handleEthDataStreaming(channel, data, initial);
    expect(final.case).toBe('sign');
    if (final.case === 'sign') {
      expect(final.value.signature).toEqual(sigBytes);
    }
    expect(channel.remaining()).toBe(0);
  });

  it('rejects an out-of-bounds chunk request', async () => {
    const data = makeData(100);
    const channel = new ScriptedChannel([]);
    const initial = {
      case: 'dataRequestChunk' as const,
      value: create(ETHSignDataRequestChunkResponseSchema, {
        offset: 50,
        length: 200,
      }),
    };
    await expect(handleEthDataStreaming(channel, data, initial)).rejects.toMatchObject({
      code: 'unexpected-response',
    });
  });
});
