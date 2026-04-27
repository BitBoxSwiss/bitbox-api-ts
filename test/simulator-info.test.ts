// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectSimulator, probeSimulatorInfo } from '../src/internal/connect.js';
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

describe.skipIf(!ENABLED)('simulator info probe', async () => {
  const binary = await binaryToRun();
  const version = parseVersionFromFilename(path.basename(binary));

  it(`v${version}: HWW info reports the expected version, product, and state`, async () => {
    const server = new SimulatorServer(binary);
    try {
      let onCloseCalls = 0;
      const probe = await probeSimulatorInfo(undefined, () => { onCloseCalls += 1; });
      expect(probe.info.version).toBe(version);
      const v = parseSemver(version);
      const expectedProduct = atLeast(v, { major: 9, minor: 24, patch: 0 })
        ? 'bitbox02-nova-multi'
        : 'bitbox02-multi';
      expect(probe.info.product).toBe(expectedProduct);
      expect(probe.info.unlocked).toBe(false);
      if (atLeast(v, { major: 9, minor: 20, patch: 0 })) {
        expect(probe.info.initialized).toBe(false);
      } else {
        expect(probe.info.initialized).toBeUndefined();
      }
      probe.close();
      expect(onCloseCalls).toBe(1);
    } finally {
      server.kill();
      await server.exited;
    }
  }, 15_000);

  it(`v${version}: pairs over Noise and exposes paired device metadata`, async () => {
    const server = new SimulatorServer(binary);
    try {
      let onCloseCalls = 0;
      const bitbox = await connectSimulator(undefined, () => { onCloseCalls += 1; }, new NoiseConfigNoCache());
      const pairing = await bitbox.unlockAndPair();
      expect(pairing.getPairingCode()).toMatch(/^[A-Z2-7]{5} [A-Z2-7]{5}\n[A-Z2-7]{5} [A-Z2-7]{5}$/);

      const paired = await pairing.waitConfirm();

      expect(paired.version()).toBe(version);
      const v = parseSemver(version);
      const expectedProduct = atLeast(v, { major: 9, minor: 24, patch: 0 })
        ? 'bitbox02-nova-multi'
        : 'bitbox02-multi';
      expect(paired.product()).toBe(expectedProduct);
      expect(paired.ethSupported()).toBe(true);

      paired.close();
      expect(onCloseCalls).toBe(1);
    } finally {
      server.kill();
      await server.exited;
    }
  }, 15_000);
});
