// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import { secp256k1 } from '@noble/curves/secp256k1';
import bs58check from 'bs58check';
import type {
  BtcCoin,
  BtcFormatUnit,
  BtcRegisterXPubType,
  BtcScriptConfig,
  BtcScriptConfigWithKeypath,
  BtcXPubsType,
  Keypath,
  XPubType,
} from '../../index.js';
import {
  BTCCoin,
  BTCPubRequest_XPubType,
  BTCRegisterScriptConfigRequest_XPubType,
  BTCScriptConfig_MultisigSchema,
  BTCScriptConfig_Multisig_ScriptType,
  BTCScriptConfig_PolicySchema,
  BTCScriptConfig_SimpleType,
  BTCScriptConfigSchema,
  BTCScriptConfigWithKeypathSchema,
  BTCSignInitRequest_FormatUnit,
  BTCXpubsRequest_XPubType,
  type BTCScriptConfig,
  type BTCScriptConfigWithKeypath,
} from '../../proto/gen/btc_pb.js';
import {
  KeyOriginInfoSchema,
  XPubSchema,
} from '../../proto/gen/common_pb.js';
import { invalidTypeError } from '../errors.js';
import { parseKeypath } from '../keypath.js';
import { hexToBytes, validateUint32 } from '../utils.js';

const XPUB_MAINNET_VERSION = 0x0488b21e;
const XPUB_TESTNET_VERSION = 0x043587cf;

function invalid(detail: string): never {
  throw invalidTypeError(detail);
}

export function mapCoin(coin: BtcCoin): BTCCoin {
  switch (coin) {
    case 'btc': return BTCCoin.BTC;
    case 'tbtc': return BTCCoin.TBTC;
    case 'ltc': return BTCCoin.LTC;
    case 'tltc': return BTCCoin.TLTC;
    case 'rbtc': return BTCCoin.RBTC;
    default: return invalid('wrong type for BtcCoin');
  }
}

export function mapXpubType(xpubType: XPubType): BTCPubRequest_XPubType {
  switch (xpubType) {
    case 'tpub': return BTCPubRequest_XPubType.TPUB;
    case 'xpub': return BTCPubRequest_XPubType.XPUB;
    case 'ypub': return BTCPubRequest_XPubType.YPUB;
    case 'zpub': return BTCPubRequest_XPubType.ZPUB;
    case 'vpub': return BTCPubRequest_XPubType.VPUB;
    case 'upub': return BTCPubRequest_XPubType.UPUB;
    case 'Vpub': return BTCPubRequest_XPubType.CAPITAL_VPUB;
    case 'Zpub': return BTCPubRequest_XPubType.CAPITAL_ZPUB;
    case 'Upub': return BTCPubRequest_XPubType.CAPITAL_UPUB;
    case 'Ypub': return BTCPubRequest_XPubType.CAPITAL_YPUB;
    default: return invalid('wrong type for XPubType');
  }
}

export function mapXpubsType(xpubType: BtcXPubsType): BTCXpubsRequest_XPubType {
  switch (xpubType) {
    case 'xpub': return BTCXpubsRequest_XPubType.XPUB;
    case 'tpub': return BTCXpubsRequest_XPubType.TPUB;
    default: return invalid('wrong type for BTCXPubsType');
  }
}

export function mapFormatUnit(formatUnit: BtcFormatUnit): BTCSignInitRequest_FormatUnit {
  switch (formatUnit) {
    case 'default': return BTCSignInitRequest_FormatUnit.DEFAULT;
    case 'sat': return BTCSignInitRequest_FormatUnit.SAT;
    default: return invalid('wrong type for BtcFormatUnit');
  }
}

export function mapRegisterXpubType(
  xpubType: BtcRegisterXPubType,
): BTCRegisterScriptConfigRequest_XPubType {
  switch (xpubType) {
    case 'autoElectrum': return BTCRegisterScriptConfigRequest_XPubType.AUTO_ELECTRUM;
    case 'autoXpubTpub': return BTCRegisterScriptConfigRequest_XPubType.AUTO_XPUB_TPUB;
    default: return invalid('wrong type for BtcRegisterXPubType');
  }
}

// bitcoinjs-lib does not expose BIP32 parsing, while the firmware protobuf needs
// the individual fields rather than the Base58Check-encoded xpub.
function parseXpub(value: unknown) {
  if (typeof value !== 'string') {
    return invalid('wrong type for BtcScriptConfig');
  }
  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(value);
  } catch {
    return invalid('wrong type for BtcScriptConfig');
  }
  if (decoded.length !== 78) {
    return invalid('wrong type for BtcScriptConfig');
  }
  const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const version = view.getUint32(0, false);
  const publicKey = decoded.slice(45, 78);
  if (version !== XPUB_MAINNET_VERSION && version !== XPUB_TESTNET_VERSION) {
    return invalid('wrong type for BtcScriptConfig');
  }
  try {
    secp256k1.ProjectivePoint.fromHex(publicKey);
  } catch {
    return invalid('wrong type for BtcScriptConfig');
  }
  return create(XPubSchema, {
    depth: decoded.slice(4, 5),
    parentFingerprint: decoded.slice(5, 9),
    childNum: view.getUint32(9, false),
    chainCode: decoded.slice(13, 45),
    publicKey,
  });
}

function parseRootFingerprint(value: unknown): Uint8Array {
  if (value === undefined) {
    return new Uint8Array();
  }
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{8}$/.test(value)) {
    return invalid('wrong type for BtcScriptConfig');
  }
  return hexToBytes(value);
}

function parseOptionalKeypath(value: unknown): number[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== 'string' && !Array.isArray(value)) {
    return invalid('wrong type for BtcScriptConfig');
  }
  return parseKeypath(value as Keypath);
}

function mapSimpleType(value: unknown): BTCScriptConfig_SimpleType {
  switch (value) {
    case 'p2wpkhP2sh': return BTCScriptConfig_SimpleType.P2WPKH_P2SH;
    case 'p2wpkh': return BTCScriptConfig_SimpleType.P2WPKH;
    case 'p2tr': return BTCScriptConfig_SimpleType.P2TR;
    default: return invalid('wrong type for BtcScriptConfig');
  }
}

export function mapScriptConfig(config: BtcScriptConfig): BTCScriptConfig {
  if (config === null || typeof config !== 'object') {
    return invalid('wrong type for BtcScriptConfig');
  }
  const value = config as unknown as Record<string, unknown>;
  if ('simpleType' in value) {
    return create(BTCScriptConfigSchema, {
      config: { case: 'simpleType', value: mapSimpleType(value.simpleType) },
    });
  }
  if ('multisig' in value) {
    const multisig = value.multisig;
    if (multisig === null || typeof multisig !== 'object') {
      return invalid('wrong type for BtcScriptConfig');
    }
    const ms = multisig as Record<string, unknown>;
    if (!Array.isArray(ms.xpubs)) {
      return invalid('wrong type for BtcScriptConfig');
    }
    let scriptType: BTCScriptConfig_Multisig_ScriptType;
    switch (ms.scriptType) {
      case 'p2wsh': scriptType = BTCScriptConfig_Multisig_ScriptType.P2WSH; break;
      case 'p2wshP2sh': scriptType = BTCScriptConfig_Multisig_ScriptType.P2WSH_P2SH; break;
      default: return invalid('wrong type for BtcScriptConfig');
    }
    return create(BTCScriptConfigSchema, {
      config: {
        case: 'multisig',
        value: create(BTCScriptConfig_MultisigSchema, {
          threshold: validateUint32(
            ms.threshold as number,
            'wrong type for BtcScriptConfig',
          ),
          xpubs: ms.xpubs.map(parseXpub),
          ourXpubIndex: validateUint32(
            ms.ourXpubIndex as number,
            'wrong type for BtcScriptConfig',
          ),
          scriptType,
        }),
      },
    });
  }
  if ('policy' in value) {
    const policy = value.policy;
    if (policy === null || typeof policy !== 'object') {
      return invalid('wrong type for BtcScriptConfig');
    }
    const p = policy as Record<string, unknown>;
    if (typeof p.policy !== 'string' || !Array.isArray(p.keys)) {
      return invalid('wrong type for BtcScriptConfig');
    }
    return create(BTCScriptConfigSchema, {
      config: {
        case: 'policy',
        value: create(BTCScriptConfig_PolicySchema, {
          policy: p.policy,
          keys: p.keys.map((key) => {
            if (key === null || typeof key !== 'object') {
              return invalid('wrong type for BtcScriptConfig');
            }
            const k = key as Record<string, unknown>;
            return create(KeyOriginInfoSchema, {
              rootFingerprint: parseRootFingerprint(k.rootFingerprint),
              keypath: parseOptionalKeypath(k.keypath),
              xpub: parseXpub(k.xpub),
            });
          }),
        }),
      },
    });
  }
  return invalid('wrong type for BtcScriptConfig');
}

export function mapScriptConfigWithKeypath(
  value: BtcScriptConfigWithKeypath,
): BTCScriptConfigWithKeypath {
  if (value === null || typeof value !== 'object') {
    return invalid('wrong type for BtcScriptConfigWithKeypath');
  }
  const input = value as unknown as Record<string, unknown>;
  if (typeof input.keypath !== 'string' && !Array.isArray(input.keypath)) {
    return invalid('wrong type for BtcScriptConfigWithKeypath');
  }
  return create(BTCScriptConfigWithKeypathSchema, {
    scriptConfig: mapScriptConfig(input.scriptConfig as BtcScriptConfig),
    keypath: parseKeypath(input.keypath as Keypath),
  });
}

export function makeSimpleScriptConfigWithKeypath(
  simpleType: BTCScriptConfig_SimpleType,
  keypath: number[],
): BTCScriptConfigWithKeypath {
  return create(BTCScriptConfigWithKeypathSchema, {
    scriptConfig: create(BTCScriptConfigSchema, {
      config: { case: 'simpleType', value: simpleType },
    }),
    keypath,
  });
}
