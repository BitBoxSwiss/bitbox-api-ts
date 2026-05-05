# Contributing

This repo is the pure TypeScript port of the BitBox02 browser API. The public
compatibility reference is the Rust/WASM package in the sibling
`bitbox-api-rs` checkout, while the protobuf source of truth is
`bitbox02-firmware/messages`.

## Prerequisites

- Node.js >= 20
- npm
- Linux x64 for the downloaded simulator test suite

Install dependencies with:

```bash
make install
```

## Common Commands

```bash
make typecheck         # tsc --noEmit
make lint              # eslint .
make test              # unit tests
make test-sim          # simulator tests
make build             # build ./dist
make ci                # full validation pipeline

make sandbox-dev       # browser sandbox at http://localhost:5173
make sandbox-typecheck
make sandbox-build

make proto-sync        # copy firmware .proto files into messages/
make proto-gen         # regenerate TS protobuf bindings
make proto-reset       # clean, resync, and regenerate protobuf bindings
make api-fixture-update  # refresh the Rust/WASM API snapshot fixture
```

`make ci` runs the same validation sequence as GitHub Actions. In CI it installs
dependencies first, checks protobuf regeneration, runs typecheck/lint/unit
tests/build/package/sandbox checks, and runs simulator tests on Linux x64
unless `SKIP_SIMULATOR=1` is set.

## Simulator Tests

Simulator tests live under `test/simulator-*.test.ts` and run through Vitest's
`simulator` project:

```bash
npm run test:sim
```

On Linux x64, the harness downloads and caches the simulator binaries listed in
`test/simulators.json` under `test/simulators/`, verifies their sha256 hashes,
and starts the newest listed simulator by default.

Useful environment variables:

- `SIMULATOR=/path/to/simulator`: run a custom simulator binary instead of the
  downloaded one.
- `SKIP_SIMULATOR=1`: skip simulator tests in `make ci`.

The simulator listens on fixed TCP port `15423`. Keep simulator suites
serialized and reuse one simulator process per file.

## Protobuf Workflow

The checked-in `.proto` files under `messages/` are copied from
`../bitbox02-firmware/messages`, not from the Rust API repo.

When firmware messages change:

```bash
make proto-reset
make typecheck
make test
```

CI runs `npm run proto:check`, which regenerates bindings and fails if
`src/proto/gen` would change.

## Compatibility Policy

The package is intended as a drop-in TypeScript replacement for the current
`bitbox-api` Rust/WASM npm package where methods are implemented.

- Keep the exported function/class/type surface aligned with
  `../bitbox-api-rs/pkg/bitbox_api.d.ts`.
- Only relax the API snapshot for deliberate source-compatible TypeScript
  ergonomics, such as optional callbacks or safer `bigint` input paths.
- Public errors must keep the `{ code, message, err? }` shape. New public error
  behavior should go through `src/internal/errors.ts` and match the compatibility
  taxonomy unless there is an explicit reason to extend it.
- BTC, Cardano, and BIP85 methods remain compatibility stubs in this iteration.
  Do not document or test them as implemented until their protocol support lands.

`test/api-snapshot.test.ts` compares the built `dist/index.d.ts` against the
checked-in `test/fixtures/bitbox_api.d.ts` fixture. To refresh the fixture,
rebuild the Rust/WASM package in `../bitbox-api-rs` so
`../bitbox-api-rs/pkg/bitbox_api.d.ts` exists, then run:

```bash
make api-fixture-update
```

## Dependency Policy

Runtime dependencies should stay small, browser-safe, and audit-friendly.

- No native runtime modules.
- No WASM runtime dependency.
- Prefer the existing `@noble/*` crypto stack over adding wallet-framework
  dependencies for small utilities.
- Keep peer dependency ranges intentional; many integrators already have
  `@noble/*` through wallet/Web3 stacks.

## Sandbox

The sandbox in `sandbox/` is for manual browser testing against real BitBox02
hardware through WebHID or BitBoxBridge:

```bash
make sandbox-dev
```

The sandbox aliases `bitbox-api-ts` to `../src/index.ts`, so source edits
hot-reload without building `dist/`. Browsers cannot connect to the raw TCP
simulator transport directly; simulator coverage belongs in `npm run test:sim`.
