// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { openWebHID } from '../src/internal/transport-webhid.js';
import type {
  HID,
  HIDConnectionEvent,
  HIDDevice,
  HIDFilter,
  HIDInputReportEvent,
} from '../src/internal/transport-webhid.js';

interface DeviceOptions {
  productName?: string;
  openedInitially?: boolean;
}

class FakeDevice implements HIDDevice {
  opened = false;
  productName: string;
  private inputReportListeners: Array<(e: HIDInputReportEvent) => void> = [];
  readonly sent: Array<{ reportId: number; data: Uint8Array }> = [];

  constructor(opts: DeviceOptions = {}) {
    this.productName = opts.productName ?? 'BitBox02';
    this.opened = opts.openedInitially ?? false;
  }

  open(): Promise<void> {
    this.opened = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.opened = false;
    return Promise.resolve();
  }

  sendReport(reportId: number, data: Uint8Array): Promise<void> {
    this.sent.push({ reportId, data: new Uint8Array(data) });
    return Promise.resolve();
  }

  addEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void {
    if (type === 'inputreport') {
      this.inputReportListeners.push(listener);
    }
  }

  removeEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void {
    if (type === 'inputreport') {
      this.inputReportListeners = this.inputReportListeners.filter((l) => l !== listener);
    }
  }

  emitInputReport(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const l of this.inputReportListeners) {
      l({ data: view, reportId: 0 });
    }
  }
}

class FakeHID implements HID {
  requestCalls = 0;
  private disconnectListeners: Array<(e: HIDConnectionEvent) => void> = [];

  constructor(
    private readonly existing: HIDDevice[],
    private readonly onRequest: HIDDevice[],
    private readonly requestError?: unknown,
  ) {}

  getDevices(_options?: { filters: HIDFilter[] }): Promise<HIDDevice[]> {
    return Promise.resolve(this.existing);
  }

  requestDevice(_options: { filters: HIDFilter[] }): Promise<HIDDevice[]> {
    this.requestCalls += 1;
    if (this.requestError !== undefined) {
      return Promise.reject(this.requestError);
    }
    return Promise.resolve(this.onRequest);
  }

  addEventListener(type: 'disconnect', listener: (e: HIDConnectionEvent) => void): void {
    if (type === 'disconnect') {
      this.disconnectListeners.push(listener);
    }
  }

  removeEventListener(type: 'disconnect', listener: (e: HIDConnectionEvent) => void): void {
    if (type === 'disconnect') {
      this.disconnectListeners = this.disconnectListeners.filter((l) => l !== listener);
    }
  }

  emitDisconnect(device: HIDDevice): void {
    for (const l of this.disconnectListeners) {
      l({ device });
    }
  }
}

describe('openWebHID', () => {
  it('uses existing devices without prompting when available', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([d], []);
    const transport = await openWebHID(undefined, hid);
    expect(hid.requestCalls).toBe(0);
    expect(d.opened).toBe(true);
    transport.close();
  });

  it('prompts via requestDevice when no devices are permissioned yet', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([], [d]);
    await openWebHID(undefined, hid);
    expect(hid.requestCalls).toBe(1);
    expect(d.opened).toBe(true);
  });

  it('rejects with webhid-cancel when the productName does not match BitBox02', async () => {
    const d = new FakeDevice({ productName: 'SomeOtherDevice' });
    const hid = new FakeHID([d], []);
    await expect(openWebHID(undefined, hid)).rejects.toMatchObject({ code: 'webhid-cancel' });
  });

  it('rejects with webhid-cancel when no device is returned', async () => {
    const hid = new FakeHID([], []);
    await expect(openWebHID(undefined, hid)).rejects.toMatchObject({ code: 'webhid-cancel' });
  });

  it('rejects with webhid-cancel when the picker is dismissed', async () => {
    const hid = new FakeHID([], [], new Error('cancelled'));
    await expect(openWebHID(undefined, hid)).rejects.toMatchObject({ code: 'webhid-cancel' });
  });

  it('delivers input reports to read()', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([d], []);
    const transport = await openWebHID(undefined, hid);
    const pending = transport.read();
    d.emitInputReport(new Uint8Array([0x11, 0x22, 0x33]));
    expect(await pending).toEqual(new Uint8Array([0x11, 0x22, 0x33]));
    transport.close();
  });

  it('sendReport is called with report ID 0 on write()', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([d], []);
    const transport = await openWebHID(undefined, hid);
    transport.write(new Uint8Array([0xaa, 0xbb]));
    expect(d.sent).toEqual([{ reportId: 0, data: new Uint8Array([0xaa, 0xbb]) }]);
    transport.close();
  });

  it('close + subsequent disconnect event fire onCloseCb exactly once', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([d], []);
    let calls = 0;
    const transport = await openWebHID(() => { calls += 1; }, hid);
    transport.close();
    hid.emitDisconnect(d);
    expect(calls).toBe(1);
  });

  it('disconnect-only path also fires onCloseCb exactly once', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([d], []);
    let calls = 0;
    await openWebHID(() => { calls += 1; }, hid);
    hid.emitDisconnect(d);
    hid.emitDisconnect(d);
    expect(calls).toBe(1);
  });

  it('throws typed write error after close()', async () => {
    const d = new FakeDevice();
    const hid = new FakeHID([d], []);
    const transport = await openWebHID(undefined, hid);
    transport.close();
    expect(() => transport.write(new Uint8Array([1]))).toThrow(/closed/);
  });
});
