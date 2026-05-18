// SPDX-License-Identifier: Apache-2.0

import { encode as rlpEncode } from '@ethereumjs/rlp';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PairedBitBox,
  type Eth1559Transaction,
  type EthSignature,
  type EthTransaction,
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

const SIMULATOR_ETH_ADDRESS = '0x416e88840eb6353e49252da2a2c140ea1f969d1a';
const ETH_KEYPATH = "m/44'/60'/0'/0/0";
const ETH_XPUB_KEYPATH = "m/44'/60'/0'/0";

const RECIPIENT = new Uint8Array([
  0x04, 0xf2, 0x64, 0xcf, 0x34, 0x44, 0x03, 0x13, 0xb4, 0xa0,
  0x19, 0x2a, 0x35, 0x28, 0x14, 0xfb, 0xe9, 0x27, 0xb8, 0x85,
]);

const EIP712_MSG = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Attachment: [
      { name: 'contents', type: 'string' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
      { name: 'age', type: 'uint8' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
      { name: 'attachments', type: 'Attachment[]' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: {
      name: 'Cow',
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
      age: 20,
    },
    to: {
      name: 'Bob',
      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      age: '0x1e',
    },
    contents: 'Hello, Bob!',
    attachments: [{ contents: 'attachment1' }, { contents: 'attachment2' }],
  },
};

function toCompactSignature({ r, s }: Pick<EthSignature, 'r' | 's'>): Uint8Array {
  if (r.length !== 32 || s.length !== 32) {
    throw new Error('expected 32-byte r and s');
  }
  return concatBytes(Uint8Array.from(r), Uint8Array.from(s));
}

function signatureBytes(signature: EthSignature): Uint8Array {
  if (signature.v.length !== 1) {
    throw new Error('expected 1-byte v');
  }
  return concatBytes(toCompactSignature(signature), Uint8Array.from(signature.v));
}

function legacySighash(chainId: bigint, tx: EthTransaction): Uint8Array {
  const encoded = rlpEncode([
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.recipient,
    tx.value,
    tx.data,
    chainId,
    0n,
    0n,
  ]);
  return keccak_256(encoded);
}

function eip1559Sighash(tx: Eth1559Transaction): Uint8Array {
  const chainId = typeof tx.chainId === 'bigint' ? tx.chainId : BigInt(tx.chainId);
  const rlp = rlpEncode([
    chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    tx.recipient,
    tx.value,
    tx.data,
    [],
  ]);
  return keccak_256(concatBytes(new Uint8Array([0x02]), rlp));
}

function eip712BytesSighash(hexBytes: string): Uint8Array {
  const data = hexToBytes(hexBytes);
  const domainTypeHash = keccak_256(utf8ToBytes('EIP712Domain(string name)'));
  const nameHash = keccak_256(utf8ToBytes('Test'));
  const domainSeparator = keccak_256(concatBytes(domainTypeHash, nameHash));

  const typeHash = keccak_256(utf8ToBytes('Msg(bytes data)'));
  const dataHash = keccak_256(data);
  const structHash = keccak_256(concatBytes(typeHash, dataHash));

  return keccak_256(concatBytes(new Uint8Array([0x19, 0x01]), domainSeparator, structHash));
}

function personalMessageSighash(msg: Uint8Array): Uint8Array {
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`);
  return keccak_256(concatBytes(prefix, msg));
}

function recoverAddress(hash: Uint8Array, compactSig: Uint8Array, recoveryId: number): string {
  const sig = secp256k1.Signature.fromCompact(compactSig).addRecoveryBit(recoveryId);
  const pub = sig.recoverPublicKey(hash).toRawBytes(false);
  const addr = keccak_256(pub.slice(1)).slice(-20);
  return `0x${bytesToHex(addr)}`;
}

function expectSignatureFromSimulatorAddress(
  hash: Uint8Array,
  signature: EthSignature,
): void {
  const compact = toCompactSignature(signature);
  const candidates = [recoverAddress(hash, compact, 0), recoverAddress(hash, compact, 1)];
  expect(candidates).toContain(SIMULATOR_ETH_ADDRESS);
}

describe.skipIf(!ENABLED).sequential.each(simulatorCases())('simulator eth $name', (simulator) => {
  let server: SimulatorServer | undefined;
  let paired: PairedBitBox | undefined;
  const version = parseSemver(simulator.version);
  const atLeast926 = atLeast(version, { major: 9, minor: 26, patch: 0 });

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

  it('ethAddress returns simulator address', async () => {
    const address = await paired!.ethAddress(1n, ETH_KEYPATH, false);
    expect(address.toLowerCase()).toBe(SIMULATOR_ETH_ADDRESS);
    expect(address).toBe('0x416E88840Eb6353E49252Da2a2c140eA1f969D1a');
  }, 15_000);

  it('ethXpub returns simulator xpub', async () => {
    const xpub = await paired!.ethXpub(ETH_XPUB_KEYPATH);
    // BIP32 mainnet xpubs start with "xpub" and base58check to ~111 chars.
    expect(xpub).toMatch(/^xpub[1-9A-HJ-NP-Za-km-z]{106,112}$/);
  }, 15_000);

  it('ethSignTransaction signs non-streaming legacy transaction', async () => {
    expect(paired!.ethSupported()).toBe(true);
    const tx: EthTransaction = {
      nonce: new Uint8Array([0x01]),
      gasPrice: new Uint8Array([0x01]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: RECIPIENT,
      value: new Uint8Array([0x01]),
      data: new Uint8Array(100).fill(0xab),
    };
    const sig = await paired!.ethSignTransaction(1n, ETH_KEYPATH, tx);
    expect(signatureBytes(sig)).toHaveLength(65);
    expectSignatureFromSimulatorAddress(legacySighash(1n, tx), sig);
  }, 30_000);

  it.skipIf(!atLeast926)('ethSignTransaction signs streaming legacy transaction', async () => {
    const tx: EthTransaction = {
      nonce: new Uint8Array([0x01]),
      gasPrice: new Uint8Array([0x01]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: RECIPIENT,
      value: new Uint8Array([0x01]),
      data: new Uint8Array(10000).fill(0xab),
    };
    const sig = await paired!.ethSignTransaction(1n, ETH_KEYPATH, tx);
    expectSignatureFromSimulatorAddress(legacySighash(1n, tx), sig);
  }, 60_000);

  it('ethSign1559Transaction signs non-streaming transaction', async () => {
    expect(paired!.ethSupported()).toBe(true);
    const tx: Eth1559Transaction = {
      chainId: 1n,
      nonce: new Uint8Array([0x01]),
      maxPriorityFeePerGas: new Uint8Array([0x01]),
      maxFeePerGas: new Uint8Array([0x01]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: RECIPIENT,
      value: new Uint8Array([0x01]),
      data: new Uint8Array(100).fill(0xab),
    };
    const sig = await paired!.ethSign1559Transaction(ETH_KEYPATH, tx);
    expectSignatureFromSimulatorAddress(eip1559Sighash(tx), sig);
  }, 30_000);

  it.skipIf(!atLeast926)('ethSign1559Transaction signs streaming transaction', async () => {
    const tx: Eth1559Transaction = {
      chainId: 1n,
      nonce: new Uint8Array([0x01]),
      maxPriorityFeePerGas: new Uint8Array([0x01]),
      maxFeePerGas: new Uint8Array([0x01]),
      gasLimit: new Uint8Array([0x52, 0x08]),
      recipient: RECIPIENT,
      value: new Uint8Array([0x01]),
      data: new Uint8Array(8000).fill(0xcd),
    };
    const sig = await paired!.ethSign1559Transaction(ETH_KEYPATH, tx);
    expectSignatureFromSimulatorAddress(eip1559Sighash(tx), sig);
  }, 60_000);

  it('ethSignTypedMessage with anti-klepto enabled is nondeterministic', async () => {
    const sig1 = await paired!.ethSignTypedMessage(1n, ETH_KEYPATH, EIP712_MSG, true);
    const sig2 = await paired!.ethSignTypedMessage(1n, ETH_KEYPATH, EIP712_MSG, true);
    expect(signatureBytes(sig1)).toHaveLength(65);
    expect(signatureBytes(sig2)).toHaveLength(65);
    expect(bytesToHex(signatureBytes(sig1))).not.toBe(bytesToHex(signatureBytes(sig2)));
  }, 60_000);

  it.skipIf(!atLeast926)('ethSignTypedMessage with anti-klepto disabled is deterministic', async () => {
    const sig1 = await paired!.ethSignTypedMessage(1n, ETH_KEYPATH, EIP712_MSG, false);
    const sig2 = await paired!.ethSignTypedMessage(1n, ETH_KEYPATH, EIP712_MSG, false);
    expect(bytesToHex(signatureBytes(sig1))).toBe(bytesToHex(signatureBytes(sig2)));
  }, 60_000);

  it.skipIf(atLeast926)('ethSignTypedMessage with anti-klepto disabled rejects before 9.26', async () => {
    await expect(
      paired!.ethSignTypedMessage(1n, ETH_KEYPATH, EIP712_MSG, false),
    ).rejects.toMatchObject({ code: 'version' });
  }, 15_000);

  it.skipIf(!atLeast926)('ethSignTypedMessage streams bytes field', async () => {
    const largeBytesHex = 'aa'.repeat(10000);
    const msg = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
        ],
        Msg: [
          { name: 'data', type: 'bytes' },
        ],
      },
      primaryType: 'Msg',
      domain: {
        name: 'Test',
      },
      message: {
        data: `0x${largeBytesHex}`,
      },
    };
    const sig = await paired!.ethSignTypedMessage(1n, ETH_KEYPATH, msg, false);
    expectSignatureFromSimulatorAddress(eip712BytesSighash(largeBytesHex), sig);
  }, 60_000);

  it('ethSignMessage signs personal message', async () => {
    const msg = utf8ToBytes('Hello BitBox');
    const sig = await paired!.ethSignMessage(1n, ETH_KEYPATH, msg);
    expectSignatureFromSimulatorAddress(personalMessageSighash(msg), sig);
  }, 30_000);
});
