// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitBox } from '../src/index.js';
import { connectSimulator, probeSimulatorInfo } from '../src/internal/connect-simulator.js';
import { atLeast, parseSemver } from '../src/internal/hww.js';
import { NoiseConfigNoCache } from '../src/internal/noise-config.js';
import {
  SimulatorServer,
  downloadSimulators,
  parseVersionFromFilename,
  simulatorSupported,
} from './simulator-util.js';

const ENABLED = simulatorSupported() && process.env.SKIP_SIMULATOR !== '1';

async function binaryToRun(): Promise<string> {
  const override = process.env.SIMULATOR;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  const paths = await downloadSimulators();
  const last = paths[paths.length - 1];
  if (last === undefined) {
    throw new Error('no simulators listed in test/simulators.json');
  }
  return last;
}

describe.skipIf(!ENABLED)('simulator info probe', () => {
  let server: SimulatorServer | undefined;
  let version = '';

  beforeAll(async () => {
    const binary = await binaryToRun();
    version = parseVersionFromFilename(path.basename(binary));
    server = new SimulatorServer(binary);
  }, 30_000);

  afterAll(async () => {
    server?.kill();
    await server?.exited;
  });

  function expectedProduct(): 'bitbox02-multi' | 'bitbox02-nova-multi' {
    return atLeast(parseSemver(version), { major: 9, minor: 24, patch: 0 })
      ? 'bitbox02-nova-multi'
      : 'bitbox02-multi';
  }

  it('HWW info reports the expected version, product, and state', async () => {
    let onCloseCalls = 0;
    const probe = await probeSimulatorInfo(undefined, () => { onCloseCalls += 1; });
    expect(probe.info.version).toBe(version);
    expect(probe.info.product).toBe(expectedProduct());
    expect(probe.info.unlocked).toBe(false);
    if (atLeast(parseSemver(version), { major: 9, minor: 20, patch: 0 })) {
      expect(probe.info.initialized).toBe(false);
    } else {
      expect(probe.info.initialized).toBeUndefined();
    }
    probe.close();
    expect(onCloseCalls).toBe(1);
  }, 15_000);

  it('pairs over Noise and exposes paired device metadata', async () => {
    let onCloseCalls = 0;
    const session = await connectSimulator(undefined, () => { onCloseCalls += 1; }, new NoiseConfigNoCache());
    const bitbox = new BitBox(session);
    const pairing = await bitbox.unlockAndPair();
    expect(pairing.getPairingCode()).toMatch(/^[A-Z2-7]{5} [A-Z2-7]{5}\n[A-Z2-7]{5} [A-Z2-7]{5}$/);

    const paired = await pairing.waitConfirm();

    expect(paired.version()).toBe(version);
    expect(paired.product()).toBe(expectedProduct());
    expect(paired.ethSupported()).toBe(true);

    paired.close();
    expect(onCloseCalls).toBe(1);
  }, 15_000);
});
