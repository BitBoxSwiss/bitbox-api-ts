# bitbox-api-ts

A TypeScript library to interact with BitBox hardware wallets.

## Status

- **Implemented:** WebHID + BitBoxBridge transports, Noise XX pairing, all
  Ethereum methods (xpub, address, legacy/EIP-1559 tx, message,
  EIP-712 typed message), antiklepto, tx data streaming, `ethIdentifyCase`.
- **Stubbed `code: 'unsupported'`:** BTC, Cardano, BIP85 (permanent in
  iteration 1).
- **Stubbed `code: 'not-implemented'`:** `deviceInfo`, `rootFingerprint`,
  `showMnemonic`, `changePassword`. `product()` and `version()` work.

## Installation

`@noble/ciphers`, `@noble/curves`, `@noble/hashes` are declared as peer
dependencies so the library doesn't perturb your existing crypto graph.

- **npm 7+, pnpm 8+, yarn 2+** auto-install peer deps. `npm install bitbox-api`
  is enough.
- **yarn 1 (Classic)** prints peer warnings but does not install. If your
  tree doesn't already include `@noble/*` (most wallet/Web3 stacks do, via
  `viem`, `ethers`, or `@scure/*`), add them explicitly:

  ```bash
  yarn add @noble/ciphers @noble/curves @noble/hashes
  ```

Tested against `@noble/ciphers@1.3.0`, `@noble/curves@1.9.1`,
`@noble/hashes@1.8.0`. The peer ranges accept lower minor versions still
deployed in the wild (e.g. `@noble/curves@1.2.0` shipped via older
`viem`/`ethers` builds). For full reproducibility, pin exact versions in
your own `package.json`.

## Common commands

```bash
make install           # npm ci
make typecheck         # tsc --noEmit
make lint              # eslint .
make test              # unit tests
make test-sim          # simulator tests (Linux x64)
make build             # ./dist
make ci                # full CI sequence

make sandbox-dev       # http://localhost:5173
make sandbox-typecheck
make sandbox-build

make proto-sync        # copy firmware .proto files
make proto-gen         # buf generate
make proto-reset       # full proto clean + regen
```

## Sandbox

Interactive dev tool for real BitBox02 hardware (WebHID / BitBoxBridge).
Exercises the connection flow plus every Ethereum method. The sandbox
aliases `bitbox-api-ts` → `../src/index.ts` so library edits hot-reload
without a rebuild. The simulator is not reachable from the browser; use
`make test-sim` for simulator coverage.

## API compatibility

`test/api-snapshot.test.ts` diffs the built `dist/index.d.ts` against
`../bitbox-api-rs/pkg/bitbox_api.d.ts` (functions, classes, type aliases) so
the public surface stays drop-in compatible while the port matures.
Skipped when the reference is absent. Will be removed once the port reaches
feature parity.
