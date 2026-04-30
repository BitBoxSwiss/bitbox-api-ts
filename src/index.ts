// SPDX-License-Identifier: Apache-2.0

import {
  connectAuto,
  connectBridge,
  connectWebHID,
  type ConnectSession,
} from './internal/connect.js';
import {
  CODE_INVALID_STATE,
  CODE_NOT_IMPLEMENTED,
  CODE_UNSUPPORTED,
  CODE_USER_ABORT,
  CODE_BITBOX_USER_ABORT,
  ensureTyped,
  toPublicError,
} from './internal/errors.js';
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

function unsupportedError(method: string): Error {
  return {
    code: CODE_UNSUPPORTED,
    message: `${method} is not supported in bitbox-api-ts`,
  };
}

function notImplementedError(method: string): Error {
  return {
    code: CODE_NOT_IMPLEMENTED,
    message: `${method} is not yet implemented in bitbox-api-ts`,
  };
}

function invalidStateError(method: string): Error {
  return {
    code: CODE_INVALID_STATE,
    message: `${method}: object is not in a usable state (uninitialized, consumed, or closed)`,
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
  chainId: number | bigint;
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
export async function bitbox02ConnectWebHID(onCloseCb?: OnCloseCb): Promise<BitBox> {
  try {
    return new BitBox(await connectWebHID(onCloseCb));
  } catch (err) {
    throw toPublicError(err);
  }
}

/**
 * Connect to a BitBox02 by using the BitBoxBridge service.
 */
export async function bitbox02ConnectBridge(onCloseCb?: OnCloseCb): Promise<BitBox> {
  try {
    return new BitBox(await connectBridge(onCloseCb));
  } catch (err) {
    throw toPublicError(err);
  }
}

/**
 * Connect to a BitBox02 using WebHID if available. If WebHID is not available, we attempt to
 * connect using the BitBoxBridge.
 */
export async function bitbox02ConnectAuto(onCloseCb?: OnCloseCb): Promise<BitBox> {
  try {
    return new BitBox(await connectAuto(onCloseCb));
  } catch (err) {
    throw toPublicError(err);
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
  return ensureTyped(err);
}

/** Returns true if the user cancelled an operation. */
export function isUserAbort(err: Error): boolean {
  return err.code === CODE_USER_ABORT || err.code === CODE_BITBOX_USER_ABORT;
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

type BitBoxOpen = {
  kind: 'open';
  hww: HwwCommunication;
  close: () => void;
  config: NoiseConfig;
};
type BitBoxStateUnion = { kind: 'uninitialized' } | BitBoxOpen | { kind: 'consumed' };

type PairingOpen = {
  kind: 'open';
  state: PairingState;
  close: () => void;
};
type PairingStateUnion = { kind: 'uninitialized' } | PairingOpen | { kind: 'consumed' };

type PairedOpen = {
  kind: 'open';
  channel: EncryptedChannel;
  info: Info;
  close: () => void;
};
type PairedStateUnion = { kind: 'uninitialized' } | PairedOpen | { kind: 'closed' };

/**
 * BitBox client. Instantiate it using `bitbox02ConnectAuto()`.
 */
export class BitBox {
  #state: BitBoxStateUnion = { kind: 'uninitialized' };

  /** @internal */
  constructor(session?: ConnectSession) {
    if (session !== undefined) {
      this.#state = {
        kind: 'open',
        hww: session.hww,
        close: session.close,
        config: session.config,
      };
    }
  }

  #consumeOpen(): BitBoxOpen | undefined {
    const state = this.#state;
    if (state.kind !== 'open') {
      return undefined;
    }
    this.#state = { kind: 'consumed' };
    return state;
  }

  /** No-op; retained for ABI compatibility with the wasm-bindgen output. */
  free(): void {}

  /**
   * Invokes the device unlock and pairing. After this, stop using this instance and continue
   * with the returned instance of type `PairingBitBox`.
   */
  async unlockAndPair(): Promise<PairingBitBox> {
    const open = this.#consumeOpen();
    if (open === undefined) {
      throw invalidStateError('unlockAndPair');
    }
    try {
      const pairing = await performHandshake(open.hww, open.config);
      return makePairingBitBox(pairing, open.close);
    } catch (err) {
      bestEffortClose(open.close);
      throw toPublicError(err);
    }
  }
}

/**
 * BitBox in the pairing state. Use `getPairingCode()` to display the pairing code to the user and
 * `waitConfirm()` to proceed to the paired state.
 */
export class PairingBitBox {
  #state: PairingStateUnion = { kind: 'uninitialized' };

  /** @internal */
  constructor(init?: Omit<PairingOpen, 'kind'>) {
    if (init !== undefined) {
      this.#state = { kind: 'open', ...init };
    }
  }

  #readOpen(): PairingOpen | undefined {
    return this.#state.kind === 'open' ? this.#state : undefined;
  }

  #consumeOpen(): PairingOpen | undefined {
    const state = this.#state;
    if (state.kind !== 'open') {
      return undefined;
    }
    this.#state = { kind: 'consumed' };
    return state;
  }

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
    const open = this.#readOpen();
    if (open === undefined) {
      throw invalidStateError('getPairingCode');
    }
    return open.state.pairingCode;
  }

  /**
   * Proceed to the paired state. After this, stop using this instance and continue with the
   * returned instance of type `PairedBitBox`.
   */
  async waitConfirm(): Promise<PairedBitBox> {
    const open = this.#consumeOpen();
    if (open === undefined) {
      throw invalidStateError('waitConfirm');
    }
    try {
      const channel = await completePairing(open.state);
      return makePairedBitBox(channel, open.state.hww.info, open.close);
    } catch (err) {
      bestEffortClose(open.close);
      throw toPublicError(err);
    }
  }
}

function makePairingBitBox(state: PairingState, close: () => void): PairingBitBox {
  return new PairingBitBox({ state, close });
}

/**
 * Paired BitBox. This is where you can invoke most API functions like getting xpubs, displaying
 * receive addresses, etc.
 */
export class PairedBitBox {
  #state: PairedStateUnion = { kind: 'uninitialized' };

  /** @internal */
  constructor(init?: Omit<PairedOpen, 'kind'>) {
    if (init !== undefined) {
      this.#state = { kind: 'open', ...init };
    }
  }

  #requireOpen(method: string): PairedOpen {
    if (this.#state.kind !== 'open') {
      throw invalidStateError(method);
    }
    return this.#state;
  }

  #closeOpen(): PairedOpen | undefined {
    const state = this.#state;
    if (state.kind !== 'open') {
      return undefined;
    }
    this.#state = { kind: 'closed' };
    return state;
  }

  /** No-op; retained for ABI compatibility with the wasm-bindgen output. */
  free(): void {}

  /**
   * Closes the BitBox connection. This also invokes the `on_close_cb` callback which was
   * provided to the connect method creating the connection. Idempotent: calling close() on an
   * already-closed or uninitialized instance is a no-op.
   */
  close(): void {
    const open = this.#closeOpen();
    if (open === undefined) {
      return;
    }
    open.close();
  }

  async deviceInfo(): Promise<DeviceInfo> {
    this.#requireOpen('deviceInfo');
    throw notImplementedError('deviceInfo');
  }

  /** Returns which product we are connected to. */
  product(): Product {
    return this.#requireOpen('product').info.product;
  }

  /** Returns the firmware version, e.g. "9.18.0". */
  version(): string {
    return this.#requireOpen('version').info.version;
  }

  /** Returns the hex-encoded 4-byte root fingerprint. */
  async rootFingerprint(): Promise<string> {
    this.#requireOpen('rootFingerprint');
    throw notImplementedError('rootFingerprint');
  }

  /** Show recovery words on the Bitbox. */
  async showMnemonic(): Promise<void> {
    this.#requireOpen('showMnemonic');
    throw notImplementedError('showMnemonic');
  }

  /** Invokes the password change workflow on the device. */
  async changePassword(): Promise<void> {
    this.#requireOpen('changePassword');
    throw notImplementedError('changePassword');
  }

  async btcXpub(
    _coin: BtcCoin,
    _keypath: Keypath,
    _xpub_type: XPubType,
    _display: boolean,
  ): Promise<string> {
    this.#requireOpen('btcXpub');
    throw unsupportedError('btcXpub');
  }

  async btcXpubs(
    _coin: BtcCoin,
    _keypaths: Keypath[],
    _xpub_type: BtcXPubsType,
  ): Promise<BtcXpubs> {
    this.#requireOpen('btcXpubs');
    throw unsupportedError('btcXpubs');
  }

  async btcIsScriptConfigRegistered(
    _coin: BtcCoin,
    _script_config: BtcScriptConfig,
    _keypath_account?: Keypath,
  ): Promise<boolean> {
    this.#requireOpen('btcIsScriptConfigRegistered');
    throw unsupportedError('btcIsScriptConfigRegistered');
  }

  async btcRegisterScriptConfig(
    _coin: BtcCoin,
    _script_config: BtcScriptConfig,
    _keypath_account: Keypath | undefined,
    _xpub_type: BtcRegisterXPubType,
    _name?: string,
  ): Promise<void> {
    this.#requireOpen('btcRegisterScriptConfig');
    throw unsupportedError('btcRegisterScriptConfig');
  }

  async btcAddress(
    _coin: BtcCoin,
    _keypath: Keypath,
    _script_config: BtcScriptConfig,
    _display: boolean,
  ): Promise<string> {
    this.#requireOpen('btcAddress');
    throw unsupportedError('btcAddress');
  }

  async btcSignPSBT(
    _coin: BtcCoin,
    _psbt: string,
    _force_script_config: BtcScriptConfigWithKeypath | undefined,
    _format_unit: BtcFormatUnit,
  ): Promise<string> {
    this.#requireOpen('btcSignPSBT');
    throw unsupportedError('btcSignPSBT');
  }

  async btcSignMessage(
    _coin: BtcCoin,
    _script_config: BtcScriptConfigWithKeypath,
    _msg: Uint8Array,
  ): Promise<BtcSignMessageSignature> {
    this.#requireOpen('btcSignMessage');
    throw unsupportedError('btcSignMessage');
  }

  /** Does this device support ETH functionality? Currently this means BitBox02 Multi. */
  ethSupported(): boolean {
    const product = this.#requireOpen('ethSupported').info.product;
    return product === 'bitbox02-multi' || product === 'bitbox02-nova-multi';
  }

  async ethXpub(keypath: Keypath): Promise<string> {
    const open = this.#requireOpen('ethXpub');
    try {
      return await ethXpubImpl(open.channel, keypath);
    } catch (err) {
      throw toPublicError(err);
    }
  }

  async ethAddress(chain_id: bigint, keypath: Keypath, display: boolean): Promise<string> {
    const open = this.#requireOpen('ethAddress');
    try {
      return await ethAddressImpl(open.channel, chain_id, keypath, display);
    } catch (err) {
      throw toPublicError(err);
    }
  }

  async ethSignTransaction(
    chain_id: bigint,
    keypath: Keypath,
    tx: EthTransaction,
    address_case?: EthAddressCase,
  ): Promise<EthSignature> {
    const open = this.#requireOpen('ethSignTransaction');
    try {
      return await ethSignTransactionImpl(
        open.channel,
        open.info,
        chain_id,
        keypath,
        tx,
        address_case,
      );
    } catch (err) {
      throw toPublicError(err);
    }
  }

  async ethSign1559Transaction(
    keypath: Keypath,
    tx: Eth1559Transaction,
    address_case?: EthAddressCase,
  ): Promise<EthSignature> {
    const open = this.#requireOpen('ethSign1559Transaction');
    try {
      return await ethSign1559TransactionImpl(
        open.channel,
        open.info,
        keypath,
        tx,
        address_case,
      );
    } catch (err) {
      throw toPublicError(err);
    }
  }

  async ethSignMessage(
    chain_id: bigint,
    keypath: Keypath,
    msg: Uint8Array,
  ): Promise<EthSignature> {
    const open = this.#requireOpen('ethSignMessage');
    try {
      return await ethSignMessageImpl(open.channel, open.info, chain_id, keypath, msg);
    } catch (err) {
      throw toPublicError(err);
    }
  }

  async ethSignTypedMessage(
    chain_id: bigint,
    keypath: Keypath,
    msg: any,
    use_antiklepto?: boolean,
  ): Promise<EthSignature> {
    const open = this.#requireOpen('ethSignTypedMessage');
    try {
      return await ethSignTypedMessageImpl(
        open.channel,
        open.info,
        chain_id,
        keypath,
        msg,
        use_antiklepto,
      );
    } catch (err) {
      throw toPublicError(err);
    }
  }

  /** Does this device support Cardano functionality? Currently this means BitBox02 Multi. */
  cardanoSupported(): boolean {
    this.#requireOpen('cardanoSupported');
    return false;
  }

  async cardanoXpubs(_keypaths: Keypath[]): Promise<CardanoXpubs> {
    this.#requireOpen('cardanoXpubs');
    throw unsupportedError('cardanoXpubs');
  }

  async cardanoAddress(
    _network: CardanoNetwork,
    _script_config: CardanoScriptConfig,
    _display: boolean,
  ): Promise<string> {
    this.#requireOpen('cardanoAddress');
    throw unsupportedError('cardanoAddress');
  }

  async cardanoSignTransaction(
    _transaction: CardanoTransaction,
  ): Promise<CardanoSignTransactionResult> {
    this.#requireOpen('cardanoSignTransaction');
    throw unsupportedError('cardanoSignTransaction');
  }

  /**
   * Invokes the BIP85-BIP39 workflow on the device, letting the user select the number of words
   * (12, 28, 24) and an index and display a derived BIP-39 mnemonic.
   */
  async bip85AppBip39(): Promise<void> {
    this.#requireOpen('bip85AppBip39');
    throw unsupportedError('bip85AppBip39');
  }
}

function makePairedBitBox(
  channel: EncryptedChannel,
  info: Info,
  close: () => void,
): PairedBitBox {
  return new PairedBitBox({ channel, info, close });
}

function bestEffortClose(close: () => void): void {
  try {
    close();
  } catch {
    // Swallow teardown errors so the original handshake/pairing failure
    // remains the rejection reason.
  }
}
