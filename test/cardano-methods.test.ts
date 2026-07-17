// SPDX-License-Identifier: Apache-2.0

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import {
  PairedBitBox,
  type CardanoDrepType,
  type CardanoTransaction,
} from '../src/index.js';
import type { Info } from '../src/internal/hww.js';
import type { EncryptedChannel } from '../src/internal/pairing.js';
import { PubResponseSchema } from '../src/proto/gen/common_pb.js';
import {
  CardanoNetwork as PbCardanoNetwork,
  CardanoResponseSchema,
  CardanoSignTransactionRequest_Certificate_VoteDelegation_CardanoDRepType as PbDRepType,
  CardanoSignTransactionResponse_ShelleyWitnessSchema,
  CardanoSignTransactionResponseSchema,
  CardanoXpubsResponseSchema,
  type CardanoRequest,
  type CardanoResponse,
} from '../src/proto/gen/cardano_pb.js';
import {
  RequestSchema,
  ResponseSchema,
  type Response,
} from '../src/proto/gen/hww_pb.js';
import { bytes } from './utils.js';

function info(
  version = '9.26.0',
  product: Info['product'] = 'bitbox02-multi',
): Info {
  return { version, product, unlocked: true, initialized: true };
}

function cardanoResponse(response: CardanoResponse['response']): Response {
  return create(ResponseSchema, {
    response: {
      case: 'cardano',
      value: create(CardanoResponseSchema, { response }),
    },
  });
}

class FakeCardanoChannel implements EncryptedChannel {
  readonly seen: CardanoRequest['request'][] = [];

  constructor(
    private readonly handle: (
      request: CardanoRequest['request'],
    ) => Response | Promise<Response>,
  ) {}

  async query(plaintext: Uint8Array): Promise<Uint8Array> {
    const decoded = fromBinary(RequestSchema, plaintext);
    if (decoded.request.case !== 'cardano') {
      throw new Error(`expected cardano request, got ${decoded.request.case ?? 'undefined'}`);
    }
    const cardanoRequest = decoded.request.value.request;
    if (cardanoRequest.case === undefined) {
      throw new Error('empty cardano request oneof');
    }
    this.seen.push(cardanoRequest);
    return toBinary(ResponseSchema, await this.handle(cardanoRequest));
  }
}

class EmptyCardanoResponseChannel implements EncryptedChannel {
  async query(_plaintext: Uint8Array): Promise<Uint8Array> {
    return toBinary(ResponseSchema, cardanoResponse({ case: undefined }));
  }
}

function signTransactionResponse(): Response {
  return cardanoResponse({
    case: 'signTransaction',
    value: create(CardanoSignTransactionResponseSchema),
  });
}

function minimalTransaction(overrides: Partial<CardanoTransaction> = {}): CardanoTransaction {
  return {
    network: 'mainnet',
    inputs: [],
    outputs: [],
    fee: 0n,
    ttl: 0n,
    certificates: [],
    withdrawals: [],
    validityIntervalStart: 0n,
    allowZeroTTL: false,
    tagCborSets: false,
    ...overrides,
  };
}

describe('cardanoSupported', () => {
  it('is true for multi-edition products', () => {
    expect(
      new PairedBitBox({
        channel: new EmptyCardanoResponseChannel(),
        info: info(),
        close(): void {},
      }).cardanoSupported(),
    ).toBe(true);
    expect(
      new PairedBitBox({
        channel: new EmptyCardanoResponseChannel(),
        info: info('9.26.0', 'bitbox02-nova-multi'),
        close(): void {},
      }).cardanoSupported(),
    ).toBe(true);
  });

  it('is false for non-multi products', () => {
    for (const product of ['unknown', 'bitbox02-btconly', 'bitbox02-nova-btconly'] as const) {
      expect(
        new PairedBitBox({
          channel: new EmptyCardanoResponseChannel(),
          info: info('9.26.0', product),
          close(): void {},
        }).cardanoSupported(),
      ).toBe(false);
    }
  });
});

describe('cardanoXpubs', () => {
  it('wraps xpub requests and returns byte arrays', async () => {
    const channel = new FakeCardanoChannel((request) => {
      expect(request.case).toBe('xpubs');
      if (request.case === 'xpubs') {
        expect(request.value.keypaths.map(k => k.keypath)).toEqual([
          [0x8000073c, 0x80000717, 0x80000000],
          [0x8000073c, 0x80000717, 0x80000001],
        ]);
      }
      return cardanoResponse({
        case: 'xpubs',
        value: create(CardanoXpubsResponseSchema, {
          xpubs: [
            bytes(1, 2, 3),
            bytes(4, 5, 6),
          ],
        }),
      });
    });
    const paired = new PairedBitBox({ channel, info: info(), close(): void {} });

    await expect(
      paired.cardanoXpubs(["m/1852'/1815'/0'", [0x8000073c, 0x80000717, 0x80000001]]),
    ).resolves.toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(channel.seen.map(request => request.case)).toEqual(['xpubs']);
  });

  it('rejects firmware before Cardano support was introduced', async () => {
    const channel = new FakeCardanoChannel(() => {
      throw new Error('unexpected device query');
    });
    const paired = new PairedBitBox({ channel, info: info('9.7.9'), close(): void {} });

    await expect(paired.cardanoXpubs(["m/1852'/1815'/0'"])).rejects.toMatchObject({
      code: 'version',
      message: 'firmware version >=9.8.0 required',
    });
    expect(channel.seen).toHaveLength(0);
  });
});

describe('cardanoAddress', () => {
  it('maps network, script config, and display flag', async () => {
    const channel = new FakeCardanoChannel((request) => {
      expect(request.case).toBe('address');
      if (request.case === 'address') {
        expect(request.value.network).toBe(PbCardanoNetwork.CardanoMainnet);
        expect(request.value.display).toBe(true);
        expect(request.value.scriptConfig?.config).toMatchObject({
          case: 'pkhSkh',
          value: {
            keypathPayment: [0x8000073c, 0x80000717, 0x80000000, 0, 0],
            keypathStake: [0x8000073c, 0x80000717, 0x80000000, 2, 0],
          },
        });
      }
      return cardanoResponse({
        case: 'pub',
        value: create(PubResponseSchema, {
          pub: 'addr1qxz808eh7aw8cwjhlxlzu4p3ct299qrzjlnp7pwvh7nc9hg0342',
        }),
      });
    });
    const paired = new PairedBitBox({ channel, info: info(), close(): void {} });

    await expect(
      paired.cardanoAddress(
        'mainnet',
        {
          pkhSkh: {
            keypathPayment: "m/1852'/1815'/0'/0/0",
            keypathStake: "m/1852'/1815'/0'/2/0",
          },
        },
        true,
      ),
    ).resolves.toBe('addr1qxz808eh7aw8cwjhlxlzu4p3ct299qrzjlnp7pwvh7nc9hg0342');
  });
});

describe('cardanoSignTransaction', () => {
  it('maps transaction fields and returns Shelley witnesses as byte arrays', async () => {
    const tx: CardanoTransaction = {
      network: 'testnet',
      inputs: [
        {
          keypath: "m/1852'/1815'/0'/0/0",
          prevOutHash: bytes(0, 1, 2, 3),
          prevOutIndex: 7,
        },
      ],
      outputs: [
        {
          encodedAddress: 'addr_test1qpz4v60',
          value: 1_500_000n,
          scriptConfig: {
            pkhSkh: {
              keypathPayment: "m/1852'/1815'/0'/0/1",
              keypathStake: "m/1852'/1815'/0'/2/1",
            },
          },
          assetGroups: [
            {
              policyId: bytes(11, 12, 13),
              tokens: [
                { assetName: bytes(21, 22), value: 42n },
              ],
            },
          ],
        },
      ],
      fee: 170_000n,
      ttl: 4_000n,
      certificates: [
        { stakeRegistration: { keypath: "m/1852'/1815'/0'/2/0" } },
        { stakeDeregistration: { keypath: "m/1852'/1815'/0'/2/1" } },
        {
          stakeDelegation: {
            keypath: "m/1852'/1815'/0'/2/2",
            poolKeyhash: bytes(31, 32, 33),
          },
        },
        {
          voteDelegation: {
            keypath: "m/1852'/1815'/0'/2/3",
            type: 'scriptHash',
            drepCredhash: bytes(41, 42, 43),
          },
        },
      ],
      withdrawals: [
        { keypath: "m/1852'/1815'/0'/2/4", value: 5n },
      ],
      validityIntervalStart: 123n,
      allowZeroTTL: true,
      tagCborSets: true,
    };
    const channel = new FakeCardanoChannel((request) => {
      expect(request.case).toBe('signTransaction');
      if (request.case === 'signTransaction') {
        expect(request.value.network).toBe(PbCardanoNetwork.CardanoTestnet);
        expect(request.value.inputs).toMatchObject([
          {
            keypath: [0x8000073c, 0x80000717, 0x80000000, 0, 0],
            prevOutHash: bytes(0, 1, 2, 3),
            prevOutIndex: 7,
          },
        ]);
        expect(request.value.outputs[0]).toMatchObject({
          encodedAddress: 'addr_test1qpz4v60',
          value: 1_500_000n,
          assetGroups: [
            {
              policyId: bytes(11, 12, 13),
              tokens: [{ assetName: bytes(21, 22), value: 42n }],
            },
          ],
        });
        expect(request.value.outputs[0]?.scriptConfig?.config).toMatchObject({
          case: 'pkhSkh',
          value: {
            keypathPayment: [0x8000073c, 0x80000717, 0x80000000, 0, 1],
            keypathStake: [0x8000073c, 0x80000717, 0x80000000, 2, 1],
          },
        });
        expect(request.value.fee).toBe(170_000n);
        expect(request.value.ttl).toBe(4_000n);
        expect(request.value.validityIntervalStart).toBe(123n);
        expect(request.value.allowZeroTtl).toBe(true);
        expect(request.value.tagCborSets).toBe(true);
        expect(request.value.certificates.map(cert => cert.cert.case)).toEqual([
          'stakeRegistration',
          'stakeDeregistration',
          'stakeDelegation',
          'voteDelegation',
        ]);
        expect(request.value.certificates[0]?.cert).toMatchObject({
          case: 'stakeRegistration',
          value: { keypath: [0x8000073c, 0x80000717, 0x80000000, 2, 0] },
        });
        expect(request.value.certificates[2]?.cert).toMatchObject({
          case: 'stakeDelegation',
          value: {
            keypath: [0x8000073c, 0x80000717, 0x80000000, 2, 2],
            poolKeyhash: bytes(31, 32, 33),
          },
        });
        expect(request.value.certificates[3]?.cert).toMatchObject({
          case: 'voteDelegation',
          value: {
            keypath: [0x8000073c, 0x80000717, 0x80000000, 2, 3],
            type: PbDRepType.SCRIPT_HASH,
            drepCredhash: bytes(41, 42, 43),
          },
        });
        expect(request.value.withdrawals).toMatchObject([
          {
            keypath: [0x8000073c, 0x80000717, 0x80000000, 2, 4],
            value: 5n,
          },
        ]);
      }
      return cardanoResponse({
        case: 'signTransaction',
        value: create(CardanoSignTransactionResponseSchema, {
          shelleyWitnesses: [
            create(CardanoSignTransactionResponse_ShelleyWitnessSchema, {
              publicKey: bytes(51, 52),
              signature: bytes(61, 62),
            }),
          ],
        }),
      });
    });
    const paired = new PairedBitBox({ channel, info: info('9.22.0'), close(): void {} });

    await expect(paired.cardanoSignTransaction(tx)).resolves.toEqual({
      shelleyWitnesses: [
        {
          publicKey: [51, 52],
          signature: [61, 62],
        },
      ],
    });
  });

  it('maps all vote delegation drep types', async () => {
    const cases: Array<{
      type: CardanoDrepType;
      expected: PbDRepType;
      drepCredhash?: Uint8Array;
    }> = [
      { type: 'keyHash', expected: PbDRepType.KEY_HASH, drepCredhash: bytes(41, 42, 43) },
      { type: 'scriptHash', expected: PbDRepType.SCRIPT_HASH, drepCredhash: bytes(51, 52, 53) },
      { type: 'alwaysAbstain', expected: PbDRepType.ALWAYS_ABSTAIN },
      { type: 'alwaysNoConfidence', expected: PbDRepType.ALWAYS_NO_CONFIDENCE },
    ];

    for (const testCase of cases) {
      const channel = new FakeCardanoChannel((request) => {
        expect(request.case).toBe('signTransaction');
        if (request.case !== 'signTransaction') {
          throw new Error(`expected signTransaction request, got ${request.case ?? 'undefined'}`);
        }
        const cert = request.value.certificates[0]?.cert;
        expect(cert?.case).toBe('voteDelegation');
        if (cert?.case !== 'voteDelegation') {
          throw new Error(`expected voteDelegation certificate, got ${cert?.case ?? 'undefined'}`);
        }
        expect(cert.value).toMatchObject({
          keypath: [0x8000073c, 0x80000717, 0x80000000, 2, 0],
          type: testCase.expected,
        });
        expect(cert.value.drepCredhash).toEqual(testCase.drepCredhash);
        return signTransactionResponse();
      });
      const paired = new PairedBitBox({ channel, info: info('9.22.0'), close(): void {} });

      await expect(
        paired.cardanoSignTransaction(minimalTransaction({
          certificates: [
            {
              voteDelegation: {
                keypath: "m/1852'/1815'/0'/2/0",
                type: testCase.type,
                ...(testCase.drepCredhash === undefined
                  ? {}
                  : { drepCredhash: testCase.drepCredhash }),
              },
            },
          ],
        })),
      ).resolves.toEqual({ shelleyWitnesses: [] });
    }
  });

  it.each(['9.7.9', '9.21.0'])(
    'requires firmware 9.22.0 for tagged CBOR sets on firmware %s',
    async (version) => {
      const channel = new FakeCardanoChannel(() => {
        throw new Error('unexpected device query');
      });
      const paired = new PairedBitBox({ channel, info: info(version), close(): void {} });

      await expect(
        paired.cardanoSignTransaction(minimalTransaction({
          tagCborSets: true,
        })),
      ).rejects.toMatchObject({
        code: 'version',
        message: 'firmware version >=9.22.0 required',
      });
      expect(channel.seen).toHaveLength(0);
    },
  );

  it('requires firmware 9.8.0 when tagged CBOR sets are disabled', async () => {
    const channel = new FakeCardanoChannel(() => {
      throw new Error('unexpected device query');
    });
    const paired = new PairedBitBox({ channel, info: info('9.7.9'), close(): void {} });

    await expect(
      paired.cardanoSignTransaction(minimalTransaction({
        tagCborSets: false,
      })),
    ).rejects.toMatchObject({
      code: 'version',
      message: 'firmware version >=9.8.0 required',
    });
    expect(channel.seen).toHaveLength(0);
  });

  it('rejects unexpected Cardano responses', async () => {
    const channel = new EmptyCardanoResponseChannel();
    const paired = new PairedBitBox({ channel, info: info(), close(): void {} });

    await expect(
      paired.cardanoSignTransaction(minimalTransaction()),
    ).rejects.toMatchObject({
      code: 'unexpected-response',
      message: 'BitBox returned an unexpected response',
    });
  });
});
