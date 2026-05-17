// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BitBox, PairedBitBox } from '../src/index.js';
import { connectSimulator, probeSimulatorInfo } from '../src/internal/connect-simulator.js';
import { atLeast, parseSemver } from '../src/internal/hww.js';
import { NoiseConfigNoCache } from '../src/internal/noise-config.js';
import { completePairing, performHandshake } from '../src/internal/pairing.js';
import { restoreFromMnemonic } from '../src/internal/restore.js';
import {
  SimulatorServer,
  ensureSimulator,
  simulatorCases,
  simulatorSupported,
} from './simulator-util.js';

const ENABLED = simulatorSupported() && process.env.SKIP_SIMULATOR !== '1';

describe.skipIf(!ENABLED).sequential.each(simulatorCases())('simulator info probe $name', (simulator) => {
  let server: SimulatorServer | undefined;
  let binary = '';
  const version = parseSemver(simulator.version);

  beforeAll(async () => {
    binary = await ensureSimulator(simulator);
  }, 120_000);

  beforeEach(() => {
    server = new SimulatorServer(binary);
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  }, 30_000);

  function expectedProduct(): 'bitbox02-multi' | 'bitbox02-nova-multi' {
    return atLeast(version, { major: 9, minor: 24, patch: 0 })
      ? 'bitbox02-nova-multi'
      : 'bitbox02-multi';
  }

  function expectedDeviceName(): 'BitBox HCXT' | 'My BitBox' {
    return atLeast(version, { major: 9, minor: 24, patch: 0 })
      ? 'BitBox HCXT'
      : 'My BitBox';
  }

  it('HWW info reports the expected version, product, and state', async () => {
    let onCloseCalls = 0;
    const probe = await probeSimulatorInfo(undefined, () => { onCloseCalls += 1; });
    try {
      expect(probe.info.version).toBe(simulator.version);
      expect(probe.info.product).toBe(expectedProduct());
      expect(probe.info.unlocked).toBe(false);
      if (atLeast(version, { major: 9, minor: 20, patch: 0 })) {
        expect(probe.info.initialized).toBe(false);
      } else {
        expect(probe.info.initialized).toBeUndefined();
      }
    } finally {
      probe.close();
    }
    expect(onCloseCalls).toBe(1);
  }, 15_000);

  it('pairs over Noise and exposes paired device metadata', async () => {
    let onCloseCalls = 0;
    const session = await connectSimulator(undefined, () => { onCloseCalls += 1; }, new NoiseConfigNoCache());
    try {
      const bitbox = new BitBox(session);
      const pairing = await bitbox.unlockAndPair();
      expect(pairing.getPairingCode()).toMatch(/^[A-Z2-7]{5} [A-Z2-7]{5}\n[A-Z2-7]{5} [A-Z2-7]{5}$/);

      const paired = await pairing.waitConfirm();
      try {
        expect(paired.version()).toBe(simulator.version);
        expect(paired.product()).toBe(expectedProduct());
        expect(paired.ethSupported()).toBe(true);
        const deviceInfo = await paired.deviceInfo();
        expect(deviceInfo.name).toBe(expectedDeviceName());
      } finally {
        paired.close();
      }
    } catch (err) {
      session.close();
      throw err;
    }

    expect(onCloseCalls).toBe(1);
  }, 15_000);

  it('rootFingerprint returns simulator fingerprint after restore', async () => {
    let onCloseCalls = 0;
    const session = await connectSimulator(undefined, () => { onCloseCalls += 1; }, new NoiseConfigNoCache());
    try {
      const pairing = await performHandshake(session.hww, session.config);
      const channel = await completePairing(pairing);
      await restoreFromMnemonic(channel);
      const paired = new PairedBitBox({ channel, info: session.hww.info, close: session.close });
      try {
        await expect(paired.rootFingerprint()).resolves.toBe('4c00739d');
      } finally {
        paired.close();
      }
    } catch (err) {
      session.close();
      throw err;
    }

    expect(onCloseCalls).toBe(1);
  }, 30_000);
});
