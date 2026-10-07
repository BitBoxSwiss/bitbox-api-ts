// SPDX-License-Identifier: Apache-2.0

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PairedBitBox,
  type CardanoScriptConfig,
  type CardanoSignTransactionResult,
  type CardanoTransaction,
} from '../src/index.js';
import { connectSimulator } from '../src/internal/connect-simulator.js';
import { atLeast, parseSemver } from '../src/internal/hww.js';
import { NoiseConfigNoCache } from '../src/internal/noise-config.js';
import { completePairing, performHandshake } from '../src/internal/pairing.js';
import { restoreFromMnemonic } from '../src/internal/restore.js';
import {
  SimulatorServer,
  ensureSimulator,
  simulatorCases,
  simulatorSupported,
} from './simulator-util.js';

const ENABLED = simulatorSupported() && process.env.SKIP_SIMULATOR !== '1';

const ACCOUNT_XPUB0 = '9fc9550e8379cb97c2d2557d89574207c6cf4d4ff62b37e377f2b3b3c284935b677f0fe5a4a6928c7b982c0c149f140c26c0930b73c2fe16feddfa21625e0316';
const ACCOUNT_XPUB1 = '7ffd0bd7d54f1648ac59a357d3eb27b878c2f7c09739d3b7c7e6662d496dea16f10ef525258833d37db047cd530bf373ebcb283495aa4c768424a2af37cee661';
const MAIN_ADDRESS = 'addr1qxz808eh7aw8cwjhlxlzu4p3ct299qrzjlnp7pwvh7nc9hg0342h3nhc8vnf6c93wnxgqv3xztkfq7cnjegcqz30vg7s3sx0l4';
const TOKEN_RECIPIENT = 'addr1q9qfllpxg2vu4lq6rnpel4pvpp5xnv3kvvgtxk6k6wp4ff89xrhu8jnu3p33vnctc9eklee5dtykzyag5penc6dcmakqsqqgpt';
const PAYMENT_PUBLIC_KEY = '6b5d4134cfc66281827d51cb0196f1a951ce168c19ba1314233f43d39d91e2bc';
const STAKE_PUBLIC_KEY = 'ed0d6426efcae3b02b963db0997845ba43ed53c131aa2f0faa01976ddcdb3751';
const TOKEN_SIGNATURE = 'd10e71411879e9f2d1692f01753feeb48fac6eb30a66304801fd325f8849978d2fb703b98e0c4fe1ebf6d537966b5841a15141fc1b1491c9af0b4d8487f3750d';
const TOKEN_TAGGED_SIGNATURE = 'fc5728c98d02a3aa973419d3fc716bfa0bcacd029b454635414f901bb8d61ed09553753e04447ffb5cb9ebf5f902a79f1673452fe119b030e50ef142512bf70e';
const STAKE_DELEGATION_PAYMENT_SIGNATURE = '8d3d595565e03f38d03accbefa40173b14c65fa6ee71200a0cc302c26bd67df72bc977cf92e9d62dd6c5d1c2bdc26051ecd039d712ac567b720b4bb2f3933008';
const STAKE_DELEGATION_STAKE_SIGNATURE = 'f0304438e91ef63901373e821aab1437076134ec47f4e301971cd7073595b55f1175879e38344a7798816a664d42357aec3e7d6c0b4faa085c643609491dc80a';
const VOTE_ABSTAIN_PAYMENT_SIGNATURE = 'f5dfa646437e48f38c1dfbed29c93c86db1e9192163cc813f4828d1b9ddd39e414daadb5155919cba9bafaa54888b7bdb3f73bc437940c4fce04cd28ad03cf07';
const VOTE_ABSTAIN_STAKE_SIGNATURE = 'ccab7b7bee42330ce609a02a7cba8e181b35e2e83b5f2fa89dc5806dc3dafa4349494ec30eabb28cb061e14d2ef245a9a8709da7a9f6b39c29109322f8d26805';
const VOTE_KEY_HASH_PAYMENT_SIGNATURE = '4a572b0e6ae3067abcb7d22e0ad8b43d66a9c82d93852b325e434a970eef5f9ec18bf401f052bd9137fcf4555498d3e92a202fcdec3b03da0d033e7fa4cbe903';
const VOTE_KEY_HASH_STAKE_SIGNATURE = '54226dbfc02cd83bb011086cd6deb3b614b1c33285926904f46eb85ff61ea387885ef58dc193e442f128b9a693547757692d4f30e39db3311d649cb280a35d00';
const WITHDRAWAL_PAYMENT_SIGNATURE = '53ca2acac5a6c9720084ff5b7af67926c3f550f713a0b6fc6e2a8cd30d22c8ee91f306952bbb635c082317c61a48cb0c579d6ab5b9501e6bd161b5a69eb07006';
const WITHDRAWAL_STAKE_SIGNATURE = 'f4aae1a144dd4fd62a5af4b69c11f1a7a230b5abc4890bc2adb42f3e59b9bb8b6b77dbcf9411423b435a42377c1a8e0666a950d3788fee7f09aa653de12f5a06';

const PAYMENT_KEYPATH = "m/1852'/1815'/0'/0/0";
const STAKE_KEYPATH = "m/1852'/1815'/0'/2/0";
const CHANGE_PAYMENT_KEYPATH = "m/1852'/1815'/0'/1/0";
const INPUT_PREV_HASH = hexToBytes('59864ee73ca5d91098a32b3ce9811bac1996dcbaefa6b6247dcaafb5779c2538');
const POOL_KEYHASH = hexToBytes('abababababababababababababababababababababababababababab');
const POLICY_ID = hexToBytes('1e349c9bdea19fd6c147626a5260bc44b71635f398b67c59881df209');
const DREP_CREDHASH = POOL_KEYHASH;

type VoteDelegation = Extract<
  CardanoTransaction['certificates'][number],
  { voteDelegation: unknown }
>['voteDelegation'];

type ExpectedWitness = {
  publicKey: string;
  signature: string;
};

function pkhSkh(keypathPayment: string, keypathStake: string): CardanoScriptConfig {
  return {
    pkhSkh: {
      keypathPayment,
      keypathStake,
    },
  };
}

function bytesHex(bytes: number[]): string {
  return bytesToHex(Uint8Array.from(bytes));
}

function xpubHexes(xpubs: number[][]): string[] {
  return xpubs.map(bytesHex);
}

function expectWitnesses(
  result: CardanoSignTransactionResult,
  expectedWitnesses: ExpectedWitness[],
): void {
  expect(result.shelleyWitnesses.map(witness => ({
    publicKey: bytesHex(witness.publicKey),
    signature: bytesHex(witness.signature),
  }))).toEqual(expectedWitnesses);
}

function tokenTransaction(
  changeAddress: string,
  changeConfig: CardanoScriptConfig,
  tagCborSets: boolean,
): CardanoTransaction {
  return {
    network: 'mainnet',
    inputs: [
      {
        keypath: PAYMENT_KEYPATH,
        prevOutHash: INPUT_PREV_HASH,
        prevOutIndex: 0,
      },
    ],
    outputs: [
      {
        encodedAddress: TOKEN_RECIPIENT,
        value: 1_000_000n,
        assetGroups: [
          {
            policyId: POLICY_ID,
            tokens: [
              {
                assetName: hexToBytes('504154415445'),
                value: 1n,
              },
              {
                assetName: hexToBytes('7eae28af2208be856f7a119668ae52a49b73725e326dc16579dcc373'),
                value: 3n,
              },
            ],
          },
        ],
      },
      {
        encodedAddress: changeAddress,
        value: 4_829_501n,
        scriptConfig: changeConfig,
      },
    ],
    fee: 170_499n,
    ttl: 41_115_811n,
    certificates: [],
    withdrawals: [],
    validityIntervalStart: 41_110_811n,
    allowZeroTTL: false,
    tagCborSets,
  };
}

function stakeDelegationTransaction(
  changeAddress: string,
  changeConfig: CardanoScriptConfig,
): CardanoTransaction {
  return {
    network: 'mainnet',
    inputs: [
      {
        keypath: PAYMENT_KEYPATH,
        prevOutHash: INPUT_PREV_HASH,
        prevOutIndex: 0,
      },
    ],
    outputs: [
      {
        encodedAddress: changeAddress,
        value: 2_741_512n,
        scriptConfig: changeConfig,
      },
    ],
    fee: 191_681n,
    ttl: 41_539_125n,
    certificates: [
      { stakeRegistration: { keypath: STAKE_KEYPATH } },
      {
        stakeDelegation: {
          keypath: STAKE_KEYPATH,
          poolKeyhash: POOL_KEYHASH,
        },
      },
    ],
    withdrawals: [],
    validityIntervalStart: 41_110_811n,
    allowZeroTTL: false,
    tagCborSets: false,
  };
}

function voteDelegationTransaction(
  changeAddress: string,
  changeConfig: CardanoScriptConfig,
  voteDelegation: VoteDelegation,
): CardanoTransaction {
  return {
    network: 'mainnet',
    inputs: [
      {
        keypath: PAYMENT_KEYPATH,
        prevOutHash: INPUT_PREV_HASH,
        prevOutIndex: 0,
      },
    ],
    outputs: [
      {
        encodedAddress: changeAddress,
        value: 2_741_512n,
        scriptConfig: changeConfig,
      },
    ],
    fee: 191_681n,
    ttl: 41_539_125n,
    certificates: [{ voteDelegation }],
    withdrawals: [],
    validityIntervalStart: 41_110_811n,
    allowZeroTTL: false,
    tagCborSets: false,
  };
}

function withdrawalTransaction(
  changeAddress: string,
  changeConfig: CardanoScriptConfig,
): CardanoTransaction {
  return {
    network: 'mainnet',
    inputs: [
      {
        keypath: PAYMENT_KEYPATH,
        prevOutHash: INPUT_PREV_HASH,
        prevOutIndex: 0,
      },
    ],
    outputs: [
      {
        encodedAddress: changeAddress,
        value: 4_817_591n,
        scriptConfig: changeConfig,
      },
    ],
    fee: 175_157n,
    ttl: 41_788_708n,
    certificates: [],
    withdrawals: [
      {
        keypath: STAKE_KEYPATH,
        value: 1_234_567n,
      },
    ],
    validityIntervalStart: 0n,
    allowZeroTTL: false,
    tagCborSets: false,
  };
}

describe.skipIf(!ENABLED).sequential.each(simulatorCases())('simulator cardano $name', (simulator) => {
  let server: SimulatorServer | undefined;
  let paired: PairedBitBox | undefined;
  let changeAddress: string | undefined;
  const version = parseSemver(simulator.version);
  const atLeast921 = atLeast(version, { major: 9, minor: 21, patch: 0 });
  const atLeast922 = atLeast(version, { major: 9, minor: 22, patch: 0 });
  const changeConfig = pkhSkh(CHANGE_PAYMENT_KEYPATH, STAKE_KEYPATH);

  beforeAll(async () => {
    const binary = await ensureSimulator(simulator);
    server = new SimulatorServer(binary);
    const session = await connectSimulator(undefined, undefined, new NoiseConfigNoCache());
    try {
      expect(session.hww.info.version).toBe(simulator.version);
      const pairing = await performHandshake(session.hww, session.config);
      const channel = await completePairing(pairing);
      await restoreFromMnemonic(channel);
      paired = new PairedBitBox({ channel, info: session.hww.info, close: session.close });
    } catch (err) {
      session.close();
      throw err;
    }
  }, 120_000);

  afterAll(async () => {
    paired?.close();
    await server?.stop();
  }, 30_000);

  async function simulatorChangeAddress(): Promise<string> {
    changeAddress ??= await paired!.cardanoAddress('mainnet', changeConfig, false);
    return changeAddress;
  }

  it('cardanoXpubs returns simulator account xpubs', async () => {
    expect(paired!.cardanoSupported()).toBe(true);
    const xpubs = await paired!.cardanoXpubs([
      "m/1852'/1815'/0'",
      "m/1852'/1815'/1'",
    ]);

    expect(xpubHexes(xpubs)).toEqual([ACCOUNT_XPUB0, ACCOUNT_XPUB1]);
  }, 15_000);

  it('cardanoAddress returns simulator address', async () => {
    await expect(
      paired!.cardanoAddress(
        'mainnet',
        pkhSkh(PAYMENT_KEYPATH, STAKE_KEYPATH),
        false,
      ),
    ).resolves.toBe(MAIN_ADDRESS);
  }, 15_000);

  it('cardanoSignTransaction signs a transaction with tokens', async () => {
    const result = await paired!.cardanoSignTransaction(
      tokenTransaction(await simulatorChangeAddress(), changeConfig, false),
    );

    expectWitnesses(result, [
      {
        publicKey: PAYMENT_PUBLIC_KEY,
        signature: TOKEN_SIGNATURE,
      },
    ]);
  }, 30_000);

  it('cardanoSignTransaction signs stake delegation', async () => {
    const result = await paired!.cardanoSignTransaction(
      stakeDelegationTransaction(await simulatorChangeAddress(), changeConfig),
    );

    expectWitnesses(result, [
      {
        publicKey: PAYMENT_PUBLIC_KEY,
        signature: STAKE_DELEGATION_PAYMENT_SIGNATURE,
      },
      {
        publicKey: STAKE_PUBLIC_KEY,
        signature: STAKE_DELEGATION_STAKE_SIGNATURE,
      },
    ]);
  }, 30_000);

  it.skipIf(!atLeast921)('cardanoSignTransaction signs vote delegation to abstain', async () => {
    const result = await paired!.cardanoSignTransaction(
      voteDelegationTransaction(await simulatorChangeAddress(), changeConfig, {
        keypath: STAKE_KEYPATH,
        type: 'alwaysAbstain',
      }),
    );

    expectWitnesses(result, [
      {
        publicKey: PAYMENT_PUBLIC_KEY,
        signature: VOTE_ABSTAIN_PAYMENT_SIGNATURE,
      },
      {
        publicKey: STAKE_PUBLIC_KEY,
        signature: VOTE_ABSTAIN_STAKE_SIGNATURE,
      },
    ]);
  }, 30_000);

  it.skipIf(!atLeast921)('cardanoSignTransaction signs vote delegation to key hash', async () => {
    const result = await paired!.cardanoSignTransaction(
      voteDelegationTransaction(await simulatorChangeAddress(), changeConfig, {
        keypath: STAKE_KEYPATH,
        type: 'keyHash',
        drepCredhash: DREP_CREDHASH,
      }),
    );

    expectWitnesses(result, [
      {
        publicKey: PAYMENT_PUBLIC_KEY,
        signature: VOTE_KEY_HASH_PAYMENT_SIGNATURE,
      },
      {
        publicKey: STAKE_PUBLIC_KEY,
        signature: VOTE_KEY_HASH_STAKE_SIGNATURE,
      },
    ]);
  }, 30_000);

  it('cardanoSignTransaction signs withdrawals', async () => {
    const result = await paired!.cardanoSignTransaction(
      withdrawalTransaction(await simulatorChangeAddress(), changeConfig),
    );

    expectWitnesses(result, [
      {
        publicKey: PAYMENT_PUBLIC_KEY,
        signature: WITHDRAWAL_PAYMENT_SIGNATURE,
      },
      {
        publicKey: STAKE_PUBLIC_KEY,
        signature: WITHDRAWAL_STAKE_SIGNATURE,
      },
    ]);
  }, 30_000);

  it('cardanoSignTransaction handles tagged CBOR sets according to firmware version', async () => {
    const transaction = tokenTransaction(await simulatorChangeAddress(), changeConfig, true);
    if (!atLeast922) {
      await expect(paired!.cardanoSignTransaction(transaction)).rejects.toMatchObject({
        code: 'version',
        message: 'firmware version >=9.22.0 required',
      });
      return;
    }

    const result = await paired!.cardanoSignTransaction(transaction);
    expectWitnesses(result, [
      {
        publicKey: PAYMENT_PUBLIC_KEY,
        signature: TOKEN_TAGGED_SIGNATURE,
      },
    ]);
  }, 30_000);
});
