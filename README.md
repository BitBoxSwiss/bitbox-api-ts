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
