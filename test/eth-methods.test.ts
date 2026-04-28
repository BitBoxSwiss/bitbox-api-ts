// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { describe, expect, it } from 'vitest';
import {
  AntiKleptoSignerCommitmentSchema,
} from '../src/proto/gen/antiklepto_pb.js';
import { PubResponseSchema } from '../src/proto/gen/common_pb.js';
import {
  ETHPubRequest_OutputType,
  ETHSignDataRequestChunkResponseSchema,
  ETHSignResponseSchema,
  ETHTypedMessageValueResponseSchema,
  ETHTypedMessageValueResponse_RootObject as RootObject,
} from '../src/proto/gen/eth_pb.js';
import { taggedSha256 } from '../src/internal/eth/antiklepto.js';
import {
  ethAddress,
  ethSign1559Transaction,
  ethSignMessage,
  ethSignTransaction,
  ethSignTypedMessage,
  ethXpub,
} from '../src/internal/eth/methods.js';
import type { Eth1559Transaction, EthTransaction } from '../src/index.js';
import type { Info } from '../src/internal/hww.js';
import { ScriptedChannel } from './eth-fake-channel.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const UINT64_MAX = (1n << 64n) - 1n;

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

function bigIntToBytes32BE(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

type ProjectivePoint = typeof secp256k1.ProjectivePoint.BASE;

function antikleptoTweakScalar(signerCommitment: Uint8Array, hostNonce: Uint8Array): bigint {
  const data = new Uint8Array(signerCommitment.length + hostNonce.length);
  data.set(signerCommitment, 0);
  data.set(hostNonce, signerCommitment.length);
  const tweak = bytesToBigIntBE(taggedSha256(utf8('s2c/ecdsa/point'), data));
  expect(tweak).toBeGreaterThan(0n);
  expect(tweak).toBeLessThan(secp256k1.CURVE.n);
  return tweak;
}

function antikleptoSignature(
  commitmentPoint: ProjectivePoint,
  signerCommitment: Uint8Array,
  hostNonce: Uint8Array,
  recid: number,
): Uint8Array {
  const tweak = antikleptoTweakScalar(signerCommitment, hostNonce);
  const finalPoint = commitmentPoint.add(secp256k1.ProjectivePoint.BASE.multiply(tweak));
  const r = finalPoint.toRawBytes(false).slice(1, 33);
  const sig = new Uint8Array(65);
  sig.set(r, 0);
  sig.set(bigIntToBytes32BE(0x42n), 32);
  sig[64] = recid;
  return sig;
}

function info(version = '9.26.0'): Info {
  return { version, product: 'bitbox02-multi', unlocked: true, initialized: true };
}

describe('ethXpub', () => {
  it('queries with the XPUB output type and returns the device pub string', async () => {
    const channel = new ScriptedChannel([
      {
        kind: 'eth',
        expect: (req) => {
          expect(req.case).toBe('pub');
          if (req.case === 'pub') {
            expect(req.value.outputType).toBe(ETHPubRequest_OutputType.XPUB);
            expect(req.value.chainId).toBe(0n);
            expect(req.value.display).toBe(false);
            expect(req.value.keypath).toEqual([0x8000002c, 0x8000003c, 0x80000000]);
          }
        },
        respond: { case: 'pub', value: create(PubResponseSchema, { pub: 'xpub-test' }) },
      },
    ]);
    expect(await ethXpub(channel, "m/44'/60'/0'")).toBe('xpub-test');
  });
});

describe('ethAddress', () => {
  it('queries with the ADDRESS output type, chainId, and display flag', async () => {
    const channel = new ScriptedChannel([
      {
        kind: 'eth',
        expect: (req) => {
          expect(req.case).toBe('pub');
          if (req.case === 'pub') {
            expect(req.value.outputType).toBe(ETHPubRequest_OutputType.ADDRESS);
            expect(req.value.chainId).toBe(1n);
            expect(req.value.display).toBe(true);
          }
        },
        respond: {
          case: 'pub',
          value: create(PubResponseSchema, { pub: '0xdeadbeef' }),
        },
      },
    ]);
    expect(
      await ethAddress(channel, 1n, [0x8000002c, 0x8000003c, 0x80000000, 0, 0], true),
    ).toBe('0xdeadbeef');
  });

  it('rejects chainId outside uint64', async () => {
    const channel = new ScriptedChannel([]);
    await expect(ethAddress(channel, 1n << 64n, [0], false)).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });
});

// Inline helper: a channel that programmatically responds based on what it just
// received. This is needed for antiklepto flows where the device's responses depend
// on the host_nonce we computed for this call.
class DynamicEthChannel {
  constructor(
    private readonly handle: (
      req: import('../src/proto/gen/eth_pb.js').ETHRequest['request'],
    ) => Promise<import('../src/proto/gen/eth_pb.js').ETHResponse['response']> | import('../src/proto/gen/eth_pb.js').ETHResponse['response'],
  ) {}

  async query(plaintext: Uint8Array): Promise<Uint8Array> {
    const { fromBinary, toBinary, create } = await import('@bufbuild/protobuf');
    const { RequestSchema, ResponseSchema } = await import('../src/proto/gen/hww_pb.js');
    const { ETHResponseSchema } = await import('../src/proto/gen/eth_pb.js');
    const decoded = fromBinary(RequestSchema, plaintext);
    if (decoded.request.case !== 'eth') {
      throw new Error('not an eth request');
    }
    const inner = decoded.request.value.request;
    if (inner.case === undefined) {
      throw new Error('empty eth request');
    }
    const responseInner = await this.handle(inner);
    const ethResponse = create(ETHResponseSchema, { response: responseInner });
    const wrapped = create(ResponseSchema, {
      response: { case: 'eth' as const, value: ethResponse },
    });
    return toBinary(ResponseSchema, wrapped);
  }
}

describe('ethSignTransaction (dynamic antiklepto)', () => {
  it('legacy v shaping: chainId=1 recid=1 → v=[38]', async () => {
    // Realistic flow: device commits before host_nonce is sent. The fake device must
    // pre-compute commitment_R1 = k_device * G and use the same k_device when answering
    // antikleptoSignature.
    const k = bytesToBigIntBE(sha256(utf8('k-device-legacy'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);

    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'sign') {
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              1,
            ),
          }),
        };
      }
      throw new Error(`unexpected req: ${req.case}`);
    });

    const tx: EthTransaction = {
      nonce: new Uint8Array([0x01]),
      gasPrice: new Uint8Array([0x01, 0x00]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: new Uint8Array(20).fill(0xab),
      value: new Uint8Array([0x10]),
      data: new Uint8Array(0),
    };
    const sig = await ethSignTransaction(channel as any, info('9.26.0'), 1n, [0], tx, undefined);
    expect(Array.from(sig.v)).toEqual([1 + 27 + 1 * 2 + 8]); // 38
    expect(sig.r.length).toBe(32);
    expect(sig.s.length).toBe(32);
  });

  it('legacy v shaping: chainId=17000 recid=0 → v big-endian without leading zeros', async () => {
    const k = bytesToBigIntBE(sha256(utf8('k-device-holesky'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);

    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'sign') {
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              0,
            ),
          }),
        };
      }
      throw new Error(`unexpected req: ${req.case}`);
    });

    const tx: EthTransaction = {
      nonce: new Uint8Array([0x01]),
      gasPrice: new Uint8Array([0x01, 0x00]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: new Uint8Array(20).fill(0xab),
      value: new Uint8Array([0x10]),
      data: new Uint8Array(0),
    };
    const sig = await ethSignTransaction(channel as any, info('9.26.0'), 17000n, [0], tx, undefined);
    // v = 0 + 27 + 17000*2 + 8 = 34035 = 0x84F3
    expect(Array.from(sig.v)).toEqual([0x84, 0xf3]);
  });

  it('rejects chainId outside uint64', async () => {
    const channel = new ScriptedChannel([]);
    const tx: EthTransaction = {
      nonce: new Uint8Array(),
      gasPrice: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };
    await expect(
      ethSignTransaction(channel, info('9.26.0'), 1n << 64n, [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('rejects a legacy v value that would overflow uint64', async () => {
    const k = bytesToBigIntBE(sha256(utf8('k-device-legacy-overflow'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);
    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'sign') {
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              1,
            ),
          }),
        };
      }
      throw new Error(`unexpected req: ${req.case}`);
    });
    const tx: EthTransaction = {
      nonce: new Uint8Array(),
      gasPrice: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };

    await expect(
      ethSignTransaction(
        channel as any,
        info('9.26.0'),
        (UINT64_MAX - 35n) / 2n,
        [0],
        tx,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'chain-id-too-large' });
  });

  it('rejects a non-20-byte legacy recipient before querying', async () => {
    const channel = new ScriptedChannel([]);
    const tx: EthTransaction = {
      nonce: new Uint8Array(),
      gasPrice: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(19),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };

    await expect(
      ethSignTransaction(channel, info('9.26.0'), 1n, [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(channel.seen).toHaveLength(0);
  });

  it('rejects firmware <9.10.0', async () => {
    const channel = new ScriptedChannel([]);
    const tx: EthTransaction = {
      nonce: new Uint8Array(),
      gasPrice: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };
    await expect(
      ethSignTransaction(channel, info('9.9.0'), 1n, [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'version' });
  });

  it('rejects streaming on firmware <9.26.0', async () => {
    const channel = new ScriptedChannel([]);
    const tx: EthTransaction = {
      nonce: new Uint8Array(),
      gasPrice: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(7000),
    };
    await expect(
      ethSignTransaction(channel, info('9.25.0'), 1n, [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'version' });
  });

  it('streams transaction data when over 6144 bytes', async () => {
    const data = new Uint8Array(7000);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = i & 0xff;
    }
    const k = bytesToBigIntBE(sha256(utf8('k-device-stream'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);

    let chunkRequests = 0;
    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'sign') {
        expect(req.value.data.length).toBe(0);
        expect(req.value.dataLength).toBe(data.length);
        return {
          case: 'dataRequestChunk',
          value: create(ETHSignDataRequestChunkResponseSchema, {
            offset: 0,
            length: 4096,
          }),
        };
      }
      if (req.case === 'dataResponseChunk') {
        chunkRequests += 1;
        if (chunkRequests === 1) {
          return {
            case: 'dataRequestChunk',
            value: create(ETHSignDataRequestChunkResponseSchema, {
              offset: 4096,
              length: data.length - 4096,
            }),
          };
        }
        // After all data delivered, hand off to antiklepto flow.
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              0,
            ),
          }),
        };
      }
      throw new Error(`unexpected: ${req.case}`);
    });

    const tx: EthTransaction = {
      nonce: new Uint8Array([0x01]),
      gasPrice: new Uint8Array([0x01]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: new Uint8Array(20).fill(0xab),
      value: new Uint8Array([0x10]),
      data,
    };
    const sig = await ethSignTransaction(channel as any, info('9.26.0'), 1n, [0], tx, undefined);
    expect(sig.r.length).toBe(32);
    expect(chunkRequests).toBe(2);
  });

  it('maps a device user-abort error to bitbox-user-abort', async () => {
    const channel = new ScriptedChannel([
      {
        kind: 'eth-error',
        expect: (req) => expect(req.case).toBe('sign'),
        code: 104,
        message: 'aborted',
      },
    ]);
    const tx: EthTransaction = {
      nonce: new Uint8Array(),
      gasPrice: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };
    await expect(
      ethSignTransaction(channel, info('9.26.0'), 1n, [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'bitbox-user-abort' });
  });
});

describe('ethSign1559Transaction', () => {
  it('accepts a chainId above uint32 and shapes v as [recid]', async () => {
    const chainId = 7_078_815_900;
    const k = bytesToBigIntBE(sha256(utf8('k-device-1559'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);

    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'signEip1559') {
        expect(req.value.chainId).toBe(BigInt(chainId));
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              1,
            ),
          }),
        };
      }
      throw new Error(`unexpected: ${req.case}`);
    });

    const tx: Eth1559Transaction = {
      chainId,
      nonce: new Uint8Array([0x01]),
      maxPriorityFeePerGas: new Uint8Array([0x01]),
      maxFeePerGas: new Uint8Array([0x02]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: new Uint8Array(20).fill(0xab),
      value: new Uint8Array([0x10]),
      data: new Uint8Array(0),
    };
    const sig = await ethSign1559Transaction(channel as any, info('9.26.0'), [0], tx, undefined);
    expect(Array.from(sig.v)).toEqual([1]);
  });

  it('rejects firmware <9.16.0', async () => {
    const channel = new ScriptedChannel([]);
    const tx: Eth1559Transaction = {
      chainId: 1,
      nonce: new Uint8Array(),
      maxPriorityFeePerGas: new Uint8Array(),
      maxFeePerGas: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };
    await expect(
      ethSign1559Transaction(channel, info('9.15.0'), [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'version' });
  });

  it('rejects an unsafe JS number chainId before querying', async () => {
    const channel = new ScriptedChannel([]);
    const tx: Eth1559Transaction = {
      chainId: Number.MAX_SAFE_INTEGER + 1,
      nonce: new Uint8Array(),
      maxPriorityFeePerGas: new Uint8Array(),
      maxFeePerGas: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(20),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };

    await expect(
      ethSign1559Transaction(channel, info('9.26.0'), [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(channel.seen).toHaveLength(0);
  });

  it('rejects a non-20-byte EIP1559 recipient before querying', async () => {
    const channel = new ScriptedChannel([]);
    const tx: Eth1559Transaction = {
      chainId: 1,
      nonce: new Uint8Array(),
      maxPriorityFeePerGas: new Uint8Array(),
      maxFeePerGas: new Uint8Array(),
      gasLimit: new Uint8Array(),
      recipient: new Uint8Array(21),
      value: new Uint8Array(),
      data: new Uint8Array(),
    };

    await expect(
      ethSign1559Transaction(channel, info('9.26.0'), [0], tx, undefined),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(channel.seen).toHaveLength(0);
  });
});

describe('ethSignMessage', () => {
  it('signs and shapes v as [recid+27]', async () => {
    const k = bytesToBigIntBE(sha256(utf8('k-device-msg'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);

    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'signMsg') {
        expect(req.value.chainId).toBe(1n);
        expect(Array.from(req.value.msg)).toEqual(Array.from(utf8('hello')));
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              1,
            ),
          }),
        };
      }
      throw new Error(`unexpected: ${req.case}`);
    });

    const sig = await ethSignMessage(channel as any, info('9.26.0'), 1n, [0], utf8('hello'));
    expect(Array.from(sig.v)).toEqual([1 + 27]);
  });
});

describe('ethSignTypedMessage', () => {
  const TYPED_MSG = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      Mail: [{ name: 'contents', type: 'string' }],
    },
    primaryType: 'Mail',
    domain: { name: 'Test', chainId: 1 },
    message: { contents: 'hi' },
  };

  function makeTypedChannel(
    valuePathSequence: Array<{
      rootObject: number;
      path: number[];
    }>,
    finalRecid: number,
  ): DynamicEthChannel {
    const k = bytesToBigIntBE(sha256(utf8('k-device-typed'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);
    let valueRequestIndex = 0;

    return new DynamicEthChannel(async (req) => {
      if (req.case === 'signTypedMsg') {
        if (valuePathSequence.length > 0) {
          const next = valuePathSequence[0]!;
          return {
            case: 'typedMsgValue',
            value: create(ETHTypedMessageValueResponseSchema, next),
          };
        }
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'typedMsgValue') {
        valueRequestIndex += 1;
        if (valueRequestIndex < valuePathSequence.length) {
          const next = valuePathSequence[valueRequestIndex]!;
          return {
            case: 'typedMsgValue',
            value: create(ETHTypedMessageValueResponseSchema, next),
          };
        }
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              finalRecid,
            ),
          }),
        };
      }
      throw new Error(`unexpected: ${req.case}`);
    });
  }

  it('drives the value request loop and shapes v as [recid+27]', async () => {
    const channel = makeTypedChannel(
      [
        { rootObject: RootObject.DOMAIN, path: [0] },
        { rootObject: RootObject.MESSAGE, path: [0] },
      ],
      0,
    );
    const sig = await ethSignTypedMessage(
      channel as any,
      info('9.26.0'),
      1n,
      [0],
      TYPED_MSG,
      true,
    );
    expect(Array.from(sig.v)).toEqual([0 + 27]);
  });

  it('rejects useAntiklepto=false on firmware <9.26.0', async () => {
    const channel = new ScriptedChannel([]);
    await expect(
      ethSignTypedMessage(channel, info('9.25.0'), 1n, [0], TYPED_MSG, false),
    ).rejects.toMatchObject({ code: 'version' });
  });

  it('rejects firmware <9.12.0', async () => {
    const channel = new ScriptedChannel([]);
    await expect(
      ethSignTypedMessage(channel, info('9.11.0'), 1n, [0], TYPED_MSG, true),
    ).rejects.toMatchObject({ code: 'version' });
  });

  it('rejects a malformed typed message before querying', async () => {
    const channel = new ScriptedChannel([]);
    const msg = {
      ...TYPED_MSG,
      types: { EIP712Domain: [{ name: 'chainId' }] },
    };

    await expect(
      ethSignTypedMessage(channel, info('9.26.0'), 1n, [0], msg, true),
    ).rejects.toMatchObject({ code: 'eth-typed-message' });
    expect(channel.seen).toHaveLength(0);
  });

  it('rejects a string value larger than 6144 bytes', async () => {
    const longContents = 'x'.repeat(7000);
    const longMsg = { ...TYPED_MSG, message: { contents: longContents } };
    const channel = makeTypedChannel([{ rootObject: RootObject.MESSAGE, path: [0] }], 0);
    await expect(
      ethSignTypedMessage(channel as any, info('9.26.0'), 1n, [0], longMsg, true),
    ).rejects.toMatchObject({ code: 'eth-typed-message' });
  });

  it('streams large non-string values via dataRequestChunk', async () => {
    // Use bytes type so streaming applies (bytes > 6144 doesn't error, it streams).
    const longHex = '0x' + 'ab'.repeat(7000);
    const longMsg = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Big: [{ name: 'blob', type: 'bytes' }],
      },
      primaryType: 'Big',
      domain: { name: 'T' },
      message: { blob: longHex },
    };

    const k = bytesToBigIntBE(sha256(utf8('k-typed-stream'))) % secp256k1.CURVE.n;
    const commitmentPoint = secp256k1.ProjectivePoint.BASE.multiply(k);
    const signerCommitment = commitmentPoint.toRawBytes(true);

    let phase: 'init' | 'gotValueReq' | 'streaming' = 'init';
    let chunksDelivered = 0;
    const channel = new DynamicEthChannel(async (req) => {
      if (req.case === 'signTypedMsg') {
        return {
          case: 'typedMsgValue',
          value: create(ETHTypedMessageValueResponseSchema, {
            rootObject: RootObject.MESSAGE,
            path: [0],
          }),
        };
      }
      if (req.case === 'typedMsgValue') {
        if (phase === 'init') {
          phase = 'gotValueReq';
          // Now ask for the data in chunks.
          return {
            case: 'dataRequestChunk',
            value: create(ETHSignDataRequestChunkResponseSchema, {
              offset: 0,
              length: 4096,
            }),
          };
        }
      }
      if (req.case === 'dataResponseChunk') {
        chunksDelivered += 1;
        if (chunksDelivered === 1) {
          return {
            case: 'dataRequestChunk',
            value: create(ETHSignDataRequestChunkResponseSchema, {
              offset: 4096,
              length: 7000 - 4096,
            }),
          };
        }
        return {
          case: 'antikleptoSignerCommitment',
          value: create(AntiKleptoSignerCommitmentSchema, { commitment: signerCommitment }),
        };
      }
      if (req.case === 'antikleptoSignature') {
        return {
          case: 'sign',
          value: create(ETHSignResponseSchema, {
            signature: antikleptoSignature(
              commitmentPoint,
              signerCommitment,
              req.value.hostNonce,
              0,
            ),
          }),
        };
      }
      throw new Error(`unexpected: ${req.case} (phase ${phase})`);
    });

    const sig = await ethSignTypedMessage(
      channel as any,
      info('9.26.0'),
      1n,
      [0],
      longMsg,
      true,
    );
    expect(sig.r.length).toBe(32);
    expect(chunksDelivered).toBe(2);
  });
});
