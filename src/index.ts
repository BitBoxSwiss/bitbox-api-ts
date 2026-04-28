// SPDX-License-Identifier: Apache-2.0

import {
  connectAuto,
  connectBridge,
  connectWebHID,
} from './internal/connect.js';
import {
  ethAddress as ethAddressImpl,
  ethSign1559Transaction as ethSign1559TransactionImpl,
  ethSignMessage as ethSignMessageImpl,
  ethSignTransaction as ethSignTransactionImpl,
  ethSignTypedMessage as ethSignTypedMessageImpl,
  ethXpub as ethXpubImpl,
} from './internal/eth/methods.js';
import type { HwwCommunication, Info } from './internal/hww.js';
import type { NoiseConfig } from './internal/noise-config.js';
import {
  completePairing,
  performHandshake,
  type EncryptedChannel,
  type PairingState,
} from './internal/pairing.js';

const ERROR_CODE_UNKNOWN_JS = 'unknown-js';
const ERROR_CODE_UNSUPPORTED = 'unsupported';
const ERROR_CODE_NOT_IMPLEMENTED = 'not-implemented';
const ERROR_CODE_USER_ABORT = 'user-abort';
const ERROR_CODE_BITBOX_USER_ABORT = 'bitbox-user-abort';

function unsupportedError(method: string): Error {
  return {
    code: ERROR_CODE_UNSUPPORTED,
    message: `${method} is not supported in bitbox-api-ts`,
  };
}

function notImplementedError(method: string): Error {
  return {
    code: ERROR_CODE_NOT_IMPLEMENTED,
    message: `${method} is not yet implemented in bitbox-api-ts`,
  };
}

export type OnCloseCb = undefined | (() => void);

export type Product =
  | 'unknown'
  | 'bitbox02-multi'
  | 'bitbox02-btconly'
  | 'bitbox02-nova-multi'
  | 'bitbox02-nova-btconly';

export type BtcCoin = 'btc' | 'tbtc' | 'ltc' | 'tltc' | 'rbtc';
export type BtcFormatUnit = 'default' | 'sat';
export type XPubType =
  | 'tpub'
  | 'xpub'
  | 'ypub'
  | 'zpub'
  | 'vpub'
  | 'upub'
  | 'Vpub'
  | 'Zpub'
  | 'Upub'
  | 'Ypub';
export type BtcXPubsType = 'tpub' | 'xpub';
export type Keypath = string | number[];
export type XPub = string;

export type DeviceInfo = {
  name: string;
  initialized: boolean;
  version: string;
  mnemonicPassphraseEnabled: boolean;
  securechipModel: string;
  monotonicIncrementsRemaining: number;
};

export type BtcSimpleType = 'p2wpkhP2sh' | 'p2wpkh' | 'p2tr';

export type KeyOriginInfo = {
  rootFingerprint?: string;
  keypath?: Keypath;
  xpub: XPub;
};

export type BtcRegisterXPubType = 'autoElectrum' | 'autoXpubTpub';
export type BtcMultisigScriptType = 'p2wsh' | 'p2wshP2sh';

export type BtcMultisig = {
  threshold: number;
  xpubs: XPub[];
  ourXpubIndex: number;
  scriptType: BtcMultisigScriptType;
};

export type BtcPolicy = { policy: string; keys: KeyOriginInfo[] };

export type BtcScriptConfig =
  | { simpleType: BtcSimpleType }
  | { multisig: BtcMultisig }
  | { policy: BtcPolicy };

export type BtcScriptConfigWithKeypath = {
  scriptConfig: BtcScriptConfig;
  keypath: Keypath;
};

export type BtcSignMessageSignature = {
  sig: Uint8Array;
  recid: bigint;
  electrumSig65: Uint8Array;
};

export type BtcXpubs = string[];

export type EthTransaction = {
  nonce: Uint8Array;
  gasPrice: Uint8Array;
  gasLimit: Uint8Array;
  recipient: Uint8Array;
  value: Uint8Array;
  data: Uint8Array;
};

export type Eth1559Transaction = {
  chainId: number;
  nonce: Uint8Array;
  maxPriorityFeePerGas: Uint8Array;
  maxFeePerGas: Uint8Array;
  gasLimit: Uint8Array;
  recipient: Uint8Array;
  value: Uint8Array;
  data: Uint8Array;
};

export type EthSignature = {
  r: Uint8Array;
  s: Uint8Array;
  v: Uint8Array;
};

export type EthAddressCase = 'upper' | 'lower' | 'mixed';

export type CardanoXpub = Uint8Array;
export type CardanoXpubs = CardanoXpub[];
export type CardanoNetwork = 'mainnet' | 'testnet';

export type CardanoScriptConfig = {
  pkhSkh: {
    keypathPayment: Keypath;
    keypathStake: Keypath;
  };
};

export type CardanoInput = {
  keypath: Keypath;
  prevOutHash: Uint8Array;
  prevOutIndex: number;
};

export type CardanoAssetGroupToken = {
  assetName: Uint8Array;
  value: bigint;
};

export type CardanoAssetGroup = {
  policyId: Uint8Array;
  tokens: CardanoAssetGroupToken[];
};

export type CardanoOutput = {
  encodedAddress: string;
  value: bigint;
  scriptConfig?: CardanoScriptConfig;
  assetGroups?: CardanoAssetGroup[];
};

export type CardanoDrepType =
  | 'keyHash'
  | 'scriptHash'
  | 'alwaysAbstain'
  | 'alwaysNoConfidence';

export type CardanoCertificate =
  | { stakeRegistration: { keypath: Keypath } }
  | { stakeDeregistration: { keypath: Keypath } }
  | { stakeDelegation: { keypath: Keypath; poolKeyhash: Uint8Array } }
  | { voteDelegation: { keypath: Keypath; type: CardanoDrepType; drepCredhash?: Uint8Array } };

export type CardanoWithdrawal = {
  keypath: Keypath;
  value: bigint;
};

export type CardanoTransaction = {
  network: CardanoNetwork;
  inputs: CardanoInput[];
  outputs: CardanoOutput[];
  fee: bigint;
  ttl: bigint;
  certificates: CardanoCertificate[];
  withdrawals: CardanoWithdrawal[];
  validityIntervalStart: bigint;
  allowZeroTTL: boolean;
  tagCborSets: boolean;
};

export type CardanoShelleyWitness = {
  signature: Uint8Array;
  publicKey: Uint8Array;
};

export type CardanoSignTransactionResult = {
  shelleyWitnesses: CardanoShelleyWitness[];
};

export type Error = {
  code: string;
  message: string;
  err?: any;
};

/**
 * Connect to a BitBox02 using WebHID. WebHID is mainly supported by Chrome.
 */
export async function bitbox02ConnectWebHID(on_close_cb: OnCloseCb): Promise<BitBox> {
  try {
    return await connectWebHID(on_close_cb);
  } catch (err) {
    throw ensureError(err);
  }
}

/**
 * Connect to a BitBox02 by using the BitBoxBridge service.
 */
export async function bitbox02ConnectBridge(on_close_cb: OnCloseCb): Promise<BitBox> {
  try {
    return await connectBridge(on_close_cb);
  } catch (err) {
    throw ensureError(err);
  }
}

/**
 * Connect to a BitBox02 using WebHID if available. If WebHID is not available, we attempt to
 * connect using the BitBoxBridge.
 */
export async function bitbox02ConnectAuto(on_close_cb: OnCloseCb): Promise<BitBox> {
  try {
    return await connectAuto(on_close_cb);
  } catch (err) {
    throw ensureError(err);
  }
}

/**
 * Run any exception raised by this library through this function to get a typed error.
 *
 * If the input already looks like a typed `{ code: string, message: string }`, it is returned
 * as-is. Otherwise it is wrapped as `{ code: 'unknown-js', message: 'Unknown Javascript error',
 * err: <original> }`.
 */
export function ensureError(err: any): Error {
  if (
    err !== null &&
    typeof err === 'object' &&
    typeof err.code === 'string' &&
    typeof err.message === 'string'
  ) {
    return err as Error;
  }
  return {
    code: ERROR_CODE_UNKNOWN_JS,
    message: 'Unknown Javascript error',
    err,
  };
}

/** Returns true if the user cancelled an operation. */
export function isUserAbort(err: Error): boolean {
  return err.code === ERROR_CODE_USER_ABORT || err.code === ERROR_CODE_BITBOX_USER_ABORT;
}

/**
 * Identifies the case of the recipient address given as hexadecimal string.
 * Returns 'upper' if every alphabetic char is uppercase, 'lower' if every
 * alphabetic char is lowercase, 'mixed' otherwise. Non-alphabetic characters
 * are ignored.
 */
export function ethIdentifyCase(recipientAddress: string): EthAddressCase {
  let hasUpper = false;
  let hasLower = false;
  for (const c of recipientAddress) {
    if (c >= 'A' && c <= 'Z') {
      hasUpper = true;
    } else if (c >= 'a' && c <= 'z') {
      hasLower = true;
    }
    if (hasUpper && hasLower) {
      return 'mixed';
    }
  }
  if (hasLower) {
    return 'lower';
  }
  return 'upper';
}

/**
 * BitBox client. Instantiate it using `bitbox02ConnectAuto()`.
 */
export class BitBox {
  /** No-op; retained for ABI compatibility with the wasm-bindgen output. */
  free(): void {}

  /**
   * Invokes the device unlock and pairing. After this, stop using this instance and continue
   * with the returned instance of type `PairingBitBox`.
   */
  async unlockAndPair(): Promise<PairingBitBox> {
    const state = BITBOX_STATE.get(this);
    if (state === undefined) {
      throw notImplementedError('unlockAndPair');
    }
    try {
      const pairing = await performHandshake(state.hww, state.config);
      BITBOX_STATE.delete(this);
      return makePairingBitBox(pairing, state.close);
    } catch (err) {
      throw ensureError(err);
    }
  }
}

type BitBoxState = {
  hww: HwwCommunication;
  close: () => void;
  config: NoiseConfig;
};

const BITBOX_STATE = new WeakMap<BitBox, BitBoxState>();

/** @internal */
export function makeBitBox(
  hww: HwwCommunication,
  close: () => void,
  config: NoiseConfig,
): BitBox {
  const bitbox = new BitBox();
  BITBOX_STATE.set(bitbox, { hww, close, config });
  return bitbox;
}

/**
 * BitBox in the pairing state. Use `getPairingCode()` to display the pairing code to the user and
 * `waitConfirm()` to proceed to the paired state.
 */
export class PairingBitBox {
  /** No-op; retained for ABI compatibility with the wasm-bindgen output. */
  free(): void {}

  /**
   * If a pairing code confirmation is required, this returns the pairing code. You must display
   * it to the user and then call `waitConfirm()` to wait until the user confirms the code on
   * the BitBox.
   *
   * If the BitBox was paired before and the pairing was persisted, the pairing step is
   * skipped. In this case, `undefined` is returned. Also in this case, call `waitConfirm()` to
   * establish the encrypted connection.
   */
  getPairingCode(): string | undefined {
    return PAIRING_STATE.get(this)?.state.pairingCode;
  }

  /**
   * Proceed to the paired state. After this, stop using this instance and continue with the
   * returned instance of type `PairedBitBox`.
   */
  async waitConfirm(): Promise<PairedBitBox> {
    const state = PAIRING_STATE.get(this);
    if (state === undefined) {
      throw notImplementedError('waitConfirm');
    }
    try {
      const channel = await completePairing(state.state);
      PAIRING_STATE.delete(this);
      return makePairedBitBox(channel, state.state.hww.info, state.close);
    } catch (err) {
      throw ensureError(err);
    }
  }
}

type PairingBitBoxState = {
  state: PairingState;
  close: () => void;
};

const PAIRING_STATE = new WeakMap<PairingBitBox, PairingBitBoxState>();

function makePairingBitBox(state: PairingState, close: () => void): PairingBitBox {
  const pairing = new PairingBitBox();
  PAIRING_STATE.set(pairing, { state, close });
  return pairing;
}

function requirePaired(paired: PairedBitBox, method: string): PairedBitBoxState {
  const state = PAIRED_STATE.get(paired);
  if (state === undefined) {
    throw notImplementedError(method);
  }
  return state;
}

/**
 * Paired BitBox. This is where you can invoke most API functions like getting xpubs, displaying
 * receive addresses, etc.
 */
export class PairedBitBox {
  /** No-op; retained for ABI compatibility with the wasm-bindgen output. */
  free(): void {}

  /**
   * Closes the BitBox connection. This also invokes the `on_close_cb` callback which was
   * provided to the connect method creating the connection. Guarded against double-invocation.
   */
  close(): void {
    const state = PAIRED_STATE.get(this);
    if (state === undefined || state.closed) {
      return;
    }
    state.closed = true;
    state.close();
  }

  deviceInfo(): Promise<DeviceInfo> {
    return Promise.reject(notImplementedError('deviceInfo'));
  }

  /** Returns which product we are connected to. */
  product(): Product {
    const state = PAIRED_STATE.get(this);
    if (state === undefined) {
      throw notImplementedError('product');
    }
    return state.info.product;
  }

  /** Returns the firmware version, e.g. "9.18.0". */
  version(): string {
    const state = PAIRED_STATE.get(this);
    if (state === undefined) {
      throw notImplementedError('version');
    }
    return state.info.version;
  }

  /** Returns the hex-encoded 4-byte root fingerprint. */
  rootFingerprint(): Promise<string> {
    return Promise.reject(notImplementedError('rootFingerprint'));
  }

  /** Show recovery words on the Bitbox. */
  showMnemonic(): Promise<void> {
    return Promise.reject(notImplementedError('showMnemonic'));
  }

  /** Invokes the password change workflow on the device. */
  changePassword(): Promise<void> {
    return Promise.reject(notImplementedError('changePassword'));
  }

  btcXpub(
    _coin: BtcCoin,
    _keypath: Keypath,
    _xpub_type: XPubType,
    _display: boolean,
  ): Promise<string> {
    return Promise.reject(unsupportedError('btcXpub'));
  }

  btcXpubs(
    _coin: BtcCoin,
    _keypaths: Keypath[],
    _xpub_type: BtcXPubsType,
  ): Promise<BtcXpubs> {
    return Promise.reject(unsupportedError('btcXpubs'));
  }

  btcIsScriptConfigRegistered(
    _coin: BtcCoin,
    _script_config: BtcScriptConfig,
    _keypath_account?: Keypath,
  ): Promise<boolean> {
    return Promise.reject(unsupportedError('btcIsScriptConfigRegistered'));
  }

  btcRegisterScriptConfig(
    _coin: BtcCoin,
    _script_config: BtcScriptConfig,
    _keypath_account: Keypath | undefined,
    _xpub_type: BtcRegisterXPubType,
    _name?: string,
  ): Promise<void> {
    return Promise.reject(unsupportedError('btcRegisterScriptConfig'));
  }

  btcAddress(
    _coin: BtcCoin,
    _keypath: Keypath,
    _script_config: BtcScriptConfig,
    _display: boolean,
  ): Promise<string> {
    return Promise.reject(unsupportedError('btcAddress'));
  }

  btcSignPSBT(
    _coin: BtcCoin,
    _psbt: string,
    _force_script_config: BtcScriptConfigWithKeypath | undefined,
    _format_unit: BtcFormatUnit,
  ): Promise<string> {
    return Promise.reject(unsupportedError('btcSignPSBT'));
  }

  btcSignMessage(
    _coin: BtcCoin,
    _script_config: BtcScriptConfigWithKeypath,
    _msg: Uint8Array,
  ): Promise<BtcSignMessageSignature> {
    return Promise.reject(unsupportedError('btcSignMessage'));
  }

  /** Does this device support ETH functionality? Currently this means BitBox02 Multi. */
  ethSupported(): boolean {
    const product = PAIRED_STATE.get(this)?.info.product;
    return product === 'bitbox02-multi' || product === 'bitbox02-nova-multi';
  }

  async ethXpub(keypath: Keypath): Promise<string> {
    const state = requirePaired(this, 'ethXpub');
    try {
      return await ethXpubImpl(state.channel, keypath);
    } catch (err) {
      throw ensureError(err);
    }
  }

  async ethAddress(chain_id: bigint, keypath: Keypath, display: boolean): Promise<string> {
    const state = requirePaired(this, 'ethAddress');
    try {
      return await ethAddressImpl(state.channel, chain_id, keypath, display);
    } catch (err) {
      throw ensureError(err);
    }
  }

  async ethSignTransaction(
    chain_id: bigint,
    keypath: Keypath,
    tx: EthTransaction,
    address_case?: EthAddressCase,
  ): Promise<EthSignature> {
    const state = requirePaired(this, 'ethSignTransaction');
    try {
      return await ethSignTransactionImpl(
        state.channel,
        state.info,
        chain_id,
        keypath,
        tx,
        address_case,
      );
    } catch (err) {
      throw ensureError(err);
    }
  }

  async ethSign1559Transaction(
    keypath: Keypath,
    tx: Eth1559Transaction,
    address_case?: EthAddressCase,
  ): Promise<EthSignature> {
    const state = requirePaired(this, 'ethSign1559Transaction');
    try {
      return await ethSign1559TransactionImpl(
        state.channel,
        state.info,
        keypath,
        tx,
        address_case,
      );
    } catch (err) {
      throw ensureError(err);
    }
  }

  async ethSignMessage(
    chain_id: bigint,
    keypath: Keypath,
    msg: Uint8Array,
  ): Promise<EthSignature> {
    const state = requirePaired(this, 'ethSignMessage');
    try {
      return await ethSignMessageImpl(state.channel, state.info, chain_id, keypath, msg);
    } catch (err) {
      throw ensureError(err);
    }
  }

  async ethSignTypedMessage(
    chain_id: bigint,
    keypath: Keypath,
    msg: any,
    use_antiklepto?: boolean,
  ): Promise<EthSignature> {
    const state = requirePaired(this, 'ethSignTypedMessage');
    try {
      return await ethSignTypedMessageImpl(
        state.channel,
        state.info,
        chain_id,
        keypath,
        msg,
        use_antiklepto,
      );
    } catch (err) {
      throw ensureError(err);
    }
  }

  /** Does this device support Cardano functionality? Currently this means BitBox02 Multi. */
  cardanoSupported(): boolean {
    return false;
  }

  cardanoXpubs(_keypaths: Keypath[]): Promise<CardanoXpubs> {
    return Promise.reject(unsupportedError('cardanoXpubs'));
  }

  cardanoAddress(
    _network: CardanoNetwork,
    _script_config: CardanoScriptConfig,
    _display: boolean,
  ): Promise<string> {
    return Promise.reject(unsupportedError('cardanoAddress'));
  }

  cardanoSignTransaction(
    _transaction: CardanoTransaction,
  ): Promise<CardanoSignTransactionResult> {
    return Promise.reject(unsupportedError('cardanoSignTransaction'));
  }

  /**
   * Invokes the BIP85-BIP39 workflow on the device, letting the user select the number of words
   * (12, 28, 24) and an index and display a derived BIP-39 mnemonic.
   */
  bip85AppBip39(): Promise<void> {
    return Promise.reject(unsupportedError('bip85AppBip39'));
  }
}

type PairedBitBoxState = {
  channel: EncryptedChannel;
  info: Info;
  close: () => void;
  closed: boolean;
};

const PAIRED_STATE = new WeakMap<PairedBitBox, PairedBitBoxState>();

/** @internal */
export function makePairedBitBox(
  channel: EncryptedChannel,
  info: Info,
  close: () => void,
): PairedBitBox {
  const paired = new PairedBitBox();
  PAIRED_STATE.set(paired, { channel, info, close, closed: false });
  return paired;
}
