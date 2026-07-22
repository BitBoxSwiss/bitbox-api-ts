# @bitboxswiss/bitbox-api

Pure TypeScript library for integrating BitBox02 hardware wallets in browser
applications.

## Status

- **Implemented:** WebHID and BitBoxBridge transports, Noise XX pairing,
  device metadata helpers, Bitcoin xpub/address/PSBT/message signing methods,
  script config registration, Ethereum xpub/address/signing methods,
  antiklepto, transaction data streaming, EIP-712 typed messages,
  `ethIdentifyCase()`, and Cardano xpub/address/signing methods.
- **Stubbed with `code: 'unsupported'`:** BIP85 methods.
- **Stubbed with `code: 'not-implemented'`:** `showMnemonic()` and
  `changePassword()`.

## Installation

```bash
npm install @bitboxswiss/bitbox-api
```

`@noble/ciphers`, `@noble/curves`, and `@noble/hashes` are peer dependencies so
the library does not perturb the crypto dependency graph of wallet/Web3 apps.
`bitcoinjs-lib`, used to parse and update PSBTs, is installed as a regular
dependency.

- **npm 7+** installs peer dependencies automatically.
- **pnpm/yarn** peer handling depends on your package-manager version and
  settings. If your dependency tree does not already include `@noble/*`, add
  them:

  ```bash
  yarn add @noble/ciphers @noble/curves @noble/hashes
  ```

The package is ESM-only.

## Browser Requirements

- WebHID works in Chromium-based browsers in a secure context, such as HTTPS or
  localhost. Call the connect function from a user action, such as a button
  click, so the browser can show the device chooser.
- BitBoxBridge works through the local BitBoxBridge service. It is the fallback
  used by `bitbox02ConnectAuto()` when WebHID is unavailable.
- Pairing trust is stored in `localStorage` when available. Clearing site data
  can require the user to confirm the pairing code again. If `localStorage` is
  unavailable, pairing trust is kept only for the current JavaScript runtime.

## Connecting and Pairing

```ts
import * as bitbox from '@bitboxswiss/bitbox-api';

async function connectBitBox(): Promise<bitbox.PairedBitBox | undefined> {
  try {
    const onClose = () => {
      // Clear app state for this BitBox connection.
    };

    const unpaired = await bitbox.bitbox02ConnectAuto(onClose);
    const pairing = await unpaired.unlockAndPair();

    const pairingCode = pairing.getPairingCode();
    if (pairingCode !== undefined) {
      // Display the code and ask the user to confirm the same code on the BitBox02.
      console.log('Pairing code:', pairingCode);
    }

    const bb02 = await pairing.waitConfirm();
    console.log('Product:', bb02.product());
    console.log('Firmware:', bb02.version());
    return bb02;
  } catch (err) {
    const typed = bitbox.ensureError(err);
    if (bitbox.isUserAbort(typed)) {
      return undefined;
    }
    throw typed;
  }
}
```

`BitBox`, `PairingBitBox`, and `PairedBitBox` model a single connection flow.
After `unlockAndPair()` succeeds, use the returned `PairingBitBox` and stop
using the original `BitBox`. After `waitConfirm()` succeeds, use the returned
`PairedBitBox` and stop using the `PairingBitBox`. Reusing consumed or closed
objects throws `code: 'invalid-state'`.

If `unlockAndPair()` or `waitConfirm()` fails, the underlying transport is
closed. Reconnect before retrying.

Call `bb02.close()` when your app is done with the device. `close()` is
idempotent and invokes the `onClose` callback supplied to the connect function.

## Bitcoin Usage

Bitcoin-family methods accept coin, keypath, script config, and xpub type
strings. Keypaths can be strings or number arrays.

```ts
const account = "m/84'/0'/0'";
const keypath = `${account}/0/0`;

const xpub = await bb02.btcXpub('btc', account, 'xpub', false);
const address = await bb02.btcAddress(
  'btc',
  keypath,
  { simpleType: 'p2wpkh' },
  true,
);
```

`btcSignPSBT()` accepts and returns a base64-encoded PSBT. Single-signature
P2WPKH, wrapped P2WPKH, and P2TR script configs are inferred from PSBT key
origins. Pass `force_script_config` for multisig and policy wallets, which must
first be registered on the device.

```ts
const signedPsbt = await bb02.btcSignPSBT(
  'btc',
  psbtBase64,
  undefined,
  'default',
);

const messageSignature = await bb02.btcSignMessage(
  'btc',
  { scriptConfig: { simpleType: 'p2wpkh' }, keypath },
  new TextEncoder().encode('hello bitbox'),
);
```

The returned PSBT contains the device signatures but is not finalized. Use a
Bitcoin library to validate, combine, or finalize it as appropriate for the
wallet.

## Ethereum Usage

Keypaths can be strings such as `m/44'/60'/0'/0/0` or number arrays. Chain IDs
are `bigint` for most Ethereum methods. EIP-1559 transaction objects accept
`number | bigint` for source compatibility, but `bigint` is preferred when the
value may exceed JavaScript's safe integer range.

```ts
const keypath = "m/44'/60'/0'/0/0";
const chainId = 1n;

if (!bb02.ethSupported()) {
  throw new Error('This BitBox02 does not support Ethereum');
}

const xpub = await bb02.ethXpub("m/44'/60'/0'/0");
const address = await bb02.ethAddress(chainId, keypath, true);
```

Transaction byte fields are big-endian `Uint8Array`s without a `0x` prefix.
Returned signature byte fields are plain `number[]` arrays, matching the
runtime shape of the old WASM package. Pass `ethIdentifyCase()` for the
optional recipient case hint when you derive the transaction from a hex address
string.

```ts
function hexToBytes(hex: string): Uint8Array {
  const body = hex.replace(/^0x/i, '');
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new Error(`invalid hex length: ${hex}`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const recipient = '04f264cf34440313b4a0192a352814fbe927b885';
const signature = await bb02.ethSignTransaction(
  1n,
  keypath,
  {
    nonce: hexToBytes('1fdc'),
    gasPrice: hexToBytes('0165a0bc00'),
    gasLimit: hexToBytes('5208'),
    recipient: hexToBytes(recipient),
    value: hexToBytes('075cf1259e9c4000'),
    data: new Uint8Array(),
  },
  bitbox.ethIdentifyCase(recipient),
);

console.log(signature.r, signature.s, signature.v);
```

For EIP-1559, `chainId` is part of the transaction object:

```ts
await bb02.ethSign1559Transaction(keypath, {
  chainId: 1n,
  nonce: hexToBytes('1fdc'),
  maxPriorityFeePerGas: hexToBytes('3b9aca00'),
  maxFeePerGas: hexToBytes('04a817c800'),
  gasLimit: hexToBytes('5208'),
  recipient: hexToBytes(recipient),
  value: hexToBytes('075cf1259e9c4000'),
  data: new Uint8Array(),
});
```

Personal messages are signed with the standard Ethereum message prefix on the
device:

```ts
const msg = new TextEncoder().encode('hello bitbox');
await bb02.ethSignMessage(1n, keypath, msg);
```

EIP-712 typed messages are passed as JavaScript values. `use_antiklepto`
defaults to `true` when omitted.

```ts
await bb02.ethSignTypedMessage(1n, keypath, typedData);
```

## Cardano Usage

Cardano keypaths can be strings such as `m/1852'/1815'/0'/0/0` or number
arrays. Coin amounts, fees, slots, withdrawals, and token amounts are `bigint`
values; byte fields such as transaction hashes, policy IDs, asset names, pool
key hashes, and DRep credential hashes are `Uint8Array`s.

```ts
if (!bb02.cardanoSupported()) {
  throw new Error('This BitBox02 does not support Cardano');
}

const paymentKeypath = "m/1852'/1815'/0'/0/0";
const stakeKeypath = "m/1852'/1815'/0'/2/0";

const xpubs = await bb02.cardanoXpubs(["m/1852'/1815'/0'"]);
const address = await bb02.cardanoAddress(
  'mainnet',
  {
    pkhSkh: {
      keypathPayment: paymentKeypath,
      keypathStake: stakeKeypath,
    },
  },
  true,
);
```

Cardano transaction signing returns Shelley witnesses. Public keys and
signatures are plain `number[]` arrays, matching the runtime shape of the old
WASM package.

```ts
const result = await bb02.cardanoSignTransaction({
  network: 'mainnet',
  inputs: [
    {
      keypath: paymentKeypath,
      prevOutHash: hexToBytes('59864ee73ca5d91098a32b3ce9811bac1996dcbaefa6b6247dcaafb5779c2538'),
      prevOutIndex: 0,
    },
  ],
  outputs: [
    {
      encodedAddress: address,
      value: 1_000_000n,
    },
  ],
  fee: 170_499n,
  ttl: 41_115_811n,
  certificates: [],
  withdrawals: [],
  validityIntervalStart: 41_110_811n,
  allowZeroTTL: false,
  tagCborSets: false,
});

console.log(result.shelleyWitnesses);
```

## Typed Errors

All public API entry points reject with, or can be normalized to, this shape:

```ts
type Error = {
  code: string;
  message: string;
  err?: any;
};
```

Use `ensureError()` at API boundaries:

```ts
try {
  await bb02.ethAddress(1n, keypath, true);
} catch (err) {
  const typed = bitbox.ensureError(err);
  if (bitbox.isUserAbort(typed)) {
    return;
  }
  console.error(typed.code, typed.message);
}
```

Common client-facing codes include:

- `could-not-open`: the device or bridge connection could not be opened.
- `user-abort` / `bitbox-user-abort`: the user cancelled in the browser or on
  the device.
- `invalid-type`, `keypath-parse`, `chain-id-too-large`: invalid host inputs.
- `psbt-parse` and `psbt-*`: malformed PSBTs or unsupported PSBT contents.
- `btc-sign`: an invalid or incomplete Bitcoin signing exchange.
- `communication`, `noise`, `noise-config`, `pairing-rejected`: transport,
  pairing, or encrypted-channel failures.
- `version`: the connected firmware is too old for the requested method.
- `unsupported` / `not-implemented`: methods that are not currently available.

## Sandbox and Development

The repository includes a browser sandbox for manual testing with real
hardware:

```bash
make install
make sandbox-dev
```

Open the printed Vite URL, usually `http://localhost:5173`.

The Bitcoin accordion covers xpubs, addresses, script config registration,
PSBT signing, and message signing. Bitcoin unit tests are part of
`npm run build && npm test`; the firmware transaction-vector suite runs against
the simulator matrix with:

```bash
npm run test:sim -- test/simulator-btc.test.ts
```

For build, test, simulator, protobuf, and contribution workflow details, see
[CONTRIBUTING.md](CONTRIBUTING.md).
