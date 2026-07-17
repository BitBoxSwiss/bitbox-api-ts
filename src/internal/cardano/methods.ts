// SPDX-License-Identifier: Apache-2.0

import { create } from '@bufbuild/protobuf';
import type {
  CardanoAssetGroup,
  CardanoAssetGroupToken,
  CardanoCertificate,
  CardanoDrepType,
  CardanoInput,
  CardanoNetwork,
  CardanoOutput,
  CardanoScriptConfig,
  CardanoSignTransactionResult,
  CardanoTransaction,
  CardanoWithdrawal,
  CardanoXpubs,
  Keypath,
} from '../../index.js';
import {
  KeypathSchema,
} from '../../proto/gen/common_pb.js';
import {
  CardanoAddressRequestSchema,
  CardanoNetwork as PbCardanoNetwork,
  CardanoScriptConfigSchema,
  CardanoScriptConfig_PkhSkhSchema,
  CardanoSignTransactionRequestSchema,
  CardanoSignTransactionRequest_AssetGroupSchema,
  CardanoSignTransactionRequest_AssetGroup_TokenSchema,
  CardanoSignTransactionRequest_CertificateSchema,
  CardanoSignTransactionRequest_Certificate_StakeDelegationSchema,
  CardanoSignTransactionRequest_Certificate_VoteDelegationSchema,
  CardanoSignTransactionRequest_Certificate_VoteDelegation_CardanoDRepType as PbDRepType,
  CardanoSignTransactionRequest_InputSchema,
  CardanoSignTransactionRequest_OutputSchema,
  CardanoSignTransactionRequest_WithdrawalSchema,
  CardanoXpubsRequestSchema,
  type CardanoScriptConfig as PbCardanoScriptConfig,
  type CardanoSignTransactionRequest_Certificate,
} from '../../proto/gen/cardano_pb.js';
import { invalidTypeError } from '../errors.js';
import type { Info } from '../hww.js';
import type { EncryptedChannel } from '../pairing.js';
import { unexpectedResponse } from '../proto-query.js';
import { parseKeypath } from '../keypath.js';
import { validateUint32, validateUint64 } from '../utils.js';
import { requireVersion } from '../version.js';
import { queryCardano } from './query.js';

const CARDANO_TRANSACTION_DETAIL = 'wrong type for CardanoTransaction';

function mapNetwork(network: CardanoNetwork): PbCardanoNetwork {
  switch (network) {
    case 'mainnet':
      return PbCardanoNetwork.CardanoMainnet;
    case 'testnet':
      return PbCardanoNetwork.CardanoTestnet;
    default:
      throw invalidTypeError('wrong type for CardanoNetwork');
  }
}

function mapScriptConfig(config: CardanoScriptConfig): PbCardanoScriptConfig {
  return create(CardanoScriptConfigSchema, {
    config: {
      case: 'pkhSkh',
      value: create(CardanoScriptConfig_PkhSkhSchema, {
        keypathPayment: parseKeypath(config.pkhSkh.keypathPayment),
        keypathStake: parseKeypath(config.pkhSkh.keypathStake),
      }),
    },
  });
}

function mapDrepType(value: CardanoDrepType): PbDRepType {
  switch (value) {
    case 'keyHash':
      return PbDRepType.KEY_HASH;
    case 'scriptHash':
      return PbDRepType.SCRIPT_HASH;
    case 'alwaysAbstain':
      return PbDRepType.ALWAYS_ABSTAIN;
    case 'alwaysNoConfidence':
      return PbDRepType.ALWAYS_NO_CONFIDENCE;
    default:
      throw invalidTypeError('wrong type for CardanoDrepType');
  }
}

function mapKeypathMessage(keypath: Keypath) {
  return create(KeypathSchema, {
    keypath: parseKeypath(keypath),
  });
}

function mapCertificate(cert: CardanoCertificate): CardanoSignTransactionRequest_Certificate {
  if ('stakeRegistration' in cert) {
    return create(CardanoSignTransactionRequest_CertificateSchema, {
      cert: {
        case: 'stakeRegistration',
        value: mapKeypathMessage(cert.stakeRegistration.keypath),
      },
    });
  }
  if ('stakeDeregistration' in cert) {
    return create(CardanoSignTransactionRequest_CertificateSchema, {
      cert: {
        case: 'stakeDeregistration',
        value: mapKeypathMessage(cert.stakeDeregistration.keypath),
      },
    });
  }
  if ('stakeDelegation' in cert) {
    return create(CardanoSignTransactionRequest_CertificateSchema, {
      cert: {
        case: 'stakeDelegation',
        value: create(CardanoSignTransactionRequest_Certificate_StakeDelegationSchema, {
          keypath: parseKeypath(cert.stakeDelegation.keypath),
          poolKeyhash: cert.stakeDelegation.poolKeyhash,
        }),
      },
    });
  }
  if ('voteDelegation' in cert) {
    const voteDelegation = cert.voteDelegation;
    const value = {
      keypath: parseKeypath(voteDelegation.keypath),
      type: mapDrepType(voteDelegation.type),
      ...(voteDelegation.drepCredhash === undefined
        ? {}
        : { drepCredhash: voteDelegation.drepCredhash }),
    };
    return create(CardanoSignTransactionRequest_CertificateSchema, {
      cert: {
        case: 'voteDelegation',
        value: create(CardanoSignTransactionRequest_Certificate_VoteDelegationSchema, value),
      },
    });
  }
  throw invalidTypeError('wrong type for CardanoCertificate');
}

function mapInput(input: CardanoInput) {
  return create(CardanoSignTransactionRequest_InputSchema, {
    keypath: parseKeypath(input.keypath),
    prevOutHash: input.prevOutHash,
    prevOutIndex: validateUint32(input.prevOutIndex, CARDANO_TRANSACTION_DETAIL),
  });
}

function mapToken(token: CardanoAssetGroupToken) {
  return create(CardanoSignTransactionRequest_AssetGroup_TokenSchema, {
    assetName: token.assetName,
    value: validateUint64(token.value, CARDANO_TRANSACTION_DETAIL),
  });
}

function mapAssetGroup(assetGroup: CardanoAssetGroup) {
  return create(CardanoSignTransactionRequest_AssetGroupSchema, {
    policyId: assetGroup.policyId,
    tokens: assetGroup.tokens.map(mapToken),
  });
}

function mapOutput(output: CardanoOutput) {
  return create(CardanoSignTransactionRequest_OutputSchema, {
    encodedAddress: output.encodedAddress,
    value: validateUint64(output.value, CARDANO_TRANSACTION_DETAIL),
    assetGroups: output.assetGroups?.map(mapAssetGroup) ?? [],
    ...(output.scriptConfig === undefined
      ? {}
      : { scriptConfig: mapScriptConfig(output.scriptConfig) }),
  });
}

function mapWithdrawal(withdrawal: CardanoWithdrawal) {
  return create(CardanoSignTransactionRequest_WithdrawalSchema, {
    keypath: parseKeypath(withdrawal.keypath),
    value: validateUint64(withdrawal.value, CARDANO_TRANSACTION_DETAIL),
  });
}

function mapTransaction(transaction: CardanoTransaction) {
  return create(CardanoSignTransactionRequestSchema, {
    network: mapNetwork(transaction.network),
    inputs: transaction.inputs.map(mapInput),
    outputs: transaction.outputs.map(mapOutput),
    fee: validateUint64(transaction.fee, CARDANO_TRANSACTION_DETAIL),
    ttl: validateUint64(transaction.ttl, CARDANO_TRANSACTION_DETAIL),
    certificates: transaction.certificates.map(mapCertificate),
    withdrawals: transaction.withdrawals.map(mapWithdrawal),
    validityIntervalStart: validateUint64(
      transaction.validityIntervalStart,
      CARDANO_TRANSACTION_DETAIL,
    ),
    allowZeroTtl: transaction.allowZeroTTL,
    tagCborSets: transaction.tagCborSets,
  });
}

function requireCardanoVersion(info: Info): void {
  requireVersion(info, { major: 9, minor: 8, patch: 0 });
}

export async function cardanoXpubs(
  channel: EncryptedChannel,
  info: Info,
  keypaths: Keypath[],
): Promise<CardanoXpubs> {
  requireCardanoVersion(info);
  const response = await queryCardano(channel, {
    case: 'xpubs',
    value: create(CardanoXpubsRequestSchema, {
      keypaths: keypaths.map(mapKeypathMessage),
    }),
  });
  if (response.case !== 'xpubs') {
    throw unexpectedResponse();
  }
  return response.value.xpubs.map(bytes => Array.from(bytes));
}

export async function cardanoAddress(
  channel: EncryptedChannel,
  info: Info,
  network: CardanoNetwork,
  scriptConfig: CardanoScriptConfig,
  display: boolean,
): Promise<string> {
  requireCardanoVersion(info);
  const response = await queryCardano(channel, {
    case: 'address',
    value: create(CardanoAddressRequestSchema, {
      network: mapNetwork(network),
      scriptConfig: mapScriptConfig(scriptConfig),
      display,
    }),
  });
  if (response.case !== 'pub') {
    throw unexpectedResponse();
  }
  return response.value.pub;
}

export async function cardanoSignTransaction(
  channel: EncryptedChannel,
  info: Info,
  transaction: CardanoTransaction,
): Promise<CardanoSignTransactionResult> {
  if (transaction.tagCborSets) {
    requireVersion(info, { major: 9, minor: 22, patch: 0 });
  } else {
    requireCardanoVersion(info);
  }
  const response = await queryCardano(channel, {
    case: 'signTransaction',
    value: mapTransaction(transaction),
  });
  if (response.case !== 'signTransaction') {
    throw unexpectedResponse();
  }
  return {
    shelleyWitnesses: response.value.shelleyWitnesses.map(witness => ({
      publicKey: Array.from(witness.publicKey),
      signature: Array.from(witness.signature),
    })),
  };
}
