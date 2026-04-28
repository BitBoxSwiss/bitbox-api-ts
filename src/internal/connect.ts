// SPDX-License-Identifier: Apache-2.0

import { makeBitBox, type BitBox } from '../index.js';
import { FIRMWARE_CMD } from './constants.js';
import type { LowerTransport, ReadWrite } from './read-write.js';
import { HwwCommunication, U2fHidCommunication, U2fWsCommunication } from './hww.js';
import { defaultNoiseConfig } from './noise-config.js';
import { openBridge } from './transport-bridge.js';
import { openWebHID } from './transport-webhid.js';

/** @internal */
export type OpenLower = (onCloseCb?: () => void) => Promise<LowerTransport>;
/** @internal */
export type WrapCommunication = (lower: LowerTransport) => ReadWrite;
/** @internal */
export type CreateHww = (comm: ReadWrite) => Promise<HwwCommunication>;

/** @internal */
export interface OpenedSession {
  hww: HwwCommunication;
  close(): void;
}

const createHwwDefault: CreateHww = (comm) => HwwCommunication.create(comm);

/** @internal */
export async function openSession(
  openLower: OpenLower,
  wrapCommunication: WrapCommunication,
  onCloseCb?: () => void,
  createHww: CreateHww = createHwwDefault,
): Promise<OpenedSession> {
  let armed = false;
  const lower = await openLower(() => {
    if (armed) {
      onCloseCb?.();
    }
  });
  try {
    const hww = await createHww(wrapCommunication(lower));
    armed = true;
    return {
      hww,
      close(): void {
        lower.close();
      },
    };
  } catch (err) {
    try {
      lower.close();
    } catch {
      // Preserve the original startup error if cleanup itself fails.
    }
    throw err;
  }
}

/** @internal */
export async function connectWebHID(onCloseCb?: () => void): Promise<BitBox> {
  const session = await openSession(
    openWebHID,
    (lower) => new U2fHidCommunication(lower, FIRMWARE_CMD),
    onCloseCb,
  );
  return makeBitBox(session.hww, session.close, defaultNoiseConfig());
}

/** @internal */
export async function connectBridge(onCloseCb?: () => void): Promise<BitBox> {
  const session = await openSession(
    openBridge,
    (lower) => new U2fWsCommunication(lower, FIRMWARE_CMD),
    onCloseCb,
  );
  return makeBitBox(session.hww, session.close, defaultNoiseConfig());
}

/** @internal */
export function connectAuto(onCloseCb?: () => void): Promise<BitBox> {
  const nav = (globalThis as { navigator?: { hid?: unknown } }).navigator;
  if (nav?.hid !== undefined) {
    return connectWebHID(onCloseCb);
  }
  return connectBridge(onCloseCb);
}
