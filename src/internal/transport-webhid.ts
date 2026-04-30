// SPDX-License-Identifier: Apache-2.0

import { BITBOX02_PRODUCT_PREFIX, PRODUCT_ID, VENDOR_ID } from './constants.js';
import { MessageQueue } from './message-queue.js';
import type { LowerTransport } from './read-write.js';
import { TransportError, makeCloseGuard } from './read-write.js';

// Minimal WebHID typings. The standard lib.dom.d.ts does not ship these at
// the TypeScript version pinned in this repo; inlining keeps us off an
// extra dep and documents exactly the surface the adapter uses.
/** @internal */
export interface HIDInputReportEvent {
  data: DataView;
  reportId: number;
}

/** @internal */
export interface HIDDevice {
  opened: boolean;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void;
}

/** @internal */
export interface HIDConnectionEvent {
  device: HIDDevice;
}

/** @internal */
export interface HIDFilter {
  vendorId?: number;
  productId?: number;
}

/** @internal */
export interface HID {
  getDevices(options?: { filters: HIDFilter[] }): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDFilter[] }): Promise<HIDDevice[]>;
  addEventListener(type: 'disconnect', listener: (e: HIDConnectionEvent) => void): void;
  removeEventListener(type: 'disconnect', listener: (e: HIDConnectionEvent) => void): void;
}

function hidFrom(nav: unknown): HID {
  const h = (nav as { hid?: HID } | null | undefined)?.hid;
  if (h === undefined) {
    throw new TransportError('webhid', 'WebHID is not available in this environment');
  }
  return h;
}

/** @internal */
export async function openWebHID(
  onCloseCb?: () => void,
  hid: HID = hidFrom(globalThis.navigator),
): Promise<LowerTransport> {
  const filters: HIDFilter[] = [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }];

  let device: HIDDevice | undefined;
  try {
    let devices = await hid.getDevices({ filters });
    if (devices.length === 0) {
      devices = await hid.requestDevice({ filters });
    }
    device = devices[0];
  } catch {
    throw new TransportError('webhid-cancel', 'no BitBox02 selected');
  }

  if (device === undefined || !device.productName.includes(BITBOX02_PRODUCT_PREFIX)) {
    throw new TransportError('webhid-cancel', 'no BitBox02 selected');
  }

  try {
    await device.open();
  } catch (err) {
    const reason = err instanceof Error && err.message ? `: ${err.message}` : '';
    throw new TransportError('webhid', `failed to open HID device${reason}`);
  }

  const queue = new MessageQueue();
  const guard = makeCloseGuard(onCloseCb);

  const onInputReport = (e: HIDInputReportEvent): void => {
    queue.push(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
  };
  device.addEventListener('inputreport', onInputReport);

  // The WebHID API delivers device-specific disconnect events at the HID
  // level, not the device level, so this listener fires for every matching
  // VID/PID device. Matches `webhid.js`.
  const onDisconnect = (e: HIDConnectionEvent): void => {
    if (e.device === device) {
      guard();
    }
  };
  hid.addEventListener('disconnect', onDisconnect);

  return {
    write(bytes: Uint8Array): void {
      if (!device.opened) {
        throw new TransportError('write', 'HID device is closed');
      }
      void device.sendReport(0, bytes);
    },
    read(): Promise<Uint8Array> {
      return queue.next();
    },
    close(): void {
      device.removeEventListener('inputreport', onInputReport);
      hid.removeEventListener('disconnect', onDisconnect);
      void device.close();
      guard();
    },
  };
}
