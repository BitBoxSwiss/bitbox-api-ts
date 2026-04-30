// SPDX-License-Identifier: Apache-2.0

// Node-only, test-only entry point. Lives in its own module so the simulator
// transport (which imports `node:net`) is never reachable from the main
// `index.ts` dependency graph. Browser bundlers (webpack, Rollup, Vite) walk
// the static `import` graph from the package main; nothing here is touched
// unless a consumer explicitly imports this file.

import { FIRMWARE_CMD } from './constants.js';
import { openSession, type ConnectSession } from './connect.js';
import { type Info, U2fHidCommunication } from './hww.js';
import { type NoiseConfig, NoiseConfigNoCache } from './noise-config.js';
import { openSimulator } from './transport-simulator.js';

/** @internal */
export interface SimulatorInfoProbe {
  info: Info;
  close(): void;
}

/** @internal */
export async function connectSimulator(
  endpoint?: string,
  onCloseCb?: () => void,
  config: NoiseConfig = new NoiseConfigNoCache(),
): Promise<ConnectSession> {
  const session = await openSession(
    (closeCb) => openSimulator(endpoint, closeCb),
    (lower) => new U2fHidCommunication(lower, FIRMWARE_CMD),
    onCloseCb,
  );
  return { ...session, config };
}

/** @internal */
export async function probeSimulatorInfo(
  endpoint?: string,
  onCloseCb?: () => void,
): Promise<SimulatorInfoProbe> {
  const session = await openSession(
    (closeCb) => openSimulator(endpoint, closeCb),
    (lower) => new U2fHidCommunication(lower, FIRMWARE_CMD),
    onCloseCb,
  );
  return {
    info: session.hww.info,
    close: session.close,
  };
}
