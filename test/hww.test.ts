// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  HWW_REQ_NEW,
  HWW_REQ_RETRY,
  HWW_RSP_ACK,
  HWW_RSP_BUSY,
  HWW_RSP_NACK,
  HWW_RSP_NOTREADY,
  HwwCommunication,
  atLeast,
  getInfo,
  parseSemver,
} from '../src/internal/hww.js';
import { ReadWrite } from '../src/internal/read-write.js';
import { bytes } from './utils.js';

/** Fake ReadWrite that scripts a deterministic response sequence. */
class ScriptedTransport implements ReadWrite {
  readonly writes: Uint8Array[] = [];
  private readonly responses: Uint8Array[];

  constructor(responses: Uint8Array[]) {
    this.responses = [...responses];
  }

  write(msg: Uint8Array): void {
    this.writes.push(new Uint8Array(msg));
  }

  async read(): Promise<Uint8Array> {
    const r = this.responses.shift();
    if (r === undefined) {
      throw new Error('ScriptedTransport: no more scripted responses');
    }
    return r;
  }
}

function fakeSleeper(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    sleep(ms: number) {
      calls.push(ms);
      return Promise.resolve();
    },
    calls,
  };
}

describe('parseSemver / atLeast', () => {
  it('parses and compares major.minor.patch', () => {
    expect(parseSemver('9.18.0')).toEqual({ major: 9, minor: 18, patch: 0 });
    expect(atLeast(parseSemver('9.0.0'), { major: 7, minor: 0, patch: 0 })).toBe(true);
    expect(atLeast(parseSemver('6.9.9'), { major: 7, minor: 0, patch: 0 })).toBe(false);
    expect(atLeast(parseSemver('9.20.0'), { major: 9, minor: 20, patch: 0 })).toBe(true);
    expect(atLeast(parseSemver('9.19.0'), { major: 9, minor: 20, patch: 0 })).toBe(false);
  });

  it('throws on malformed version strings', () => {
    expect(() => parseSemver('9.18')).toThrow(/semver/);
    expect(() => parseSemver('v9.18.0')).toThrow(/semver/);
  });
});

describe('getInfo', () => {
  it('parses a pre-9.20.0 BitBox02 Multi response (no initialized byte)', async () => {
    // length=7 "v9.18.0", platform=0, edition=0, unlocked=1
    const script = [bytes(0x07, 0x76, 0x39, 0x2e, 0x31, 0x38, 0x2e, 0x30, 0x00, 0x00, 0x01)];
    const t = new ScriptedTransport(script);
    expect(await getInfo(t)).toEqual({
      version: '9.18.0',
      product: 'bitbox02-multi',
      unlocked: true,
      initialized: undefined,
    });
  });

  it('parses a 9.20.0+ Nova Multi response with initialized byte', async () => {
    // length=7 "v9.24.0", platform=2, edition=0, unlocked=1, initialized=1
    const script = [bytes(0x07, 0x76, 0x39, 0x2e, 0x32, 0x34, 0x2e, 0x30, 0x02, 0x00, 0x01, 0x01)];
    const t = new ScriptedTransport(script);
    expect(await getInfo(t)).toEqual({
      version: '9.24.0',
      product: 'bitbox02-nova-multi',
      unlocked: true,
      initialized: true,
    });
  });

  it('parses a BTC-only locked response', async () => {
    // length=7 "v9.22.0", platform=0, edition=1, unlocked=0, initialized=0
    const script = [bytes(0x07, 0x76, 0x39, 0x2e, 0x32, 0x32, 0x2e, 0x30, 0x00, 0x01, 0x00, 0x00)];
    const t = new ScriptedTransport(script);
    expect(await getInfo(t)).toEqual({
      version: '9.22.0',
      product: 'bitbox02-btconly',
      unlocked: false,
      initialized: false,
    });
  });

  it('throws when the response is truncated', async () => {
    const script = [bytes(0x07, 0x76, 0x39, 0x2e, 0x31)];
    const t = new ScriptedTransport(script);
    await expect(getInfo(t)).rejects.toMatchObject({ code: 'info' });
  });

  it('throws when the version lacks the v prefix', async () => {
    const script = [bytes(0x06, 0x39, 0x2e, 0x31, 0x38, 0x2e, 0x30, 0x00, 0x00, 0x01)];
    const t = new ScriptedTransport(script);
    await expect(getInfo(t)).rejects.toMatchObject({ code: 'info' });
  });

  it('sends the HWW_INFO opcode byte', async () => {
    const script = [bytes(0x07, 0x76, 0x39, 0x2e, 0x31, 0x38, 0x2e, 0x30, 0x00, 0x00, 0x01)];
    const t = new ScriptedTransport(script);
    await getInfo(t);
    expect(t.writes[0]).toEqual(bytes(0x69));
  });
});

describe('HwwCommunication.create', () => {
  it('rejects devices running firmware <7.0.0', async () => {
    // length=5 "v6.9.9", platform=0, edition=0, unlocked=1
    const script = [bytes(0x06, 0x76, 0x36, 0x2e, 0x39, 0x2e, 0x39, 0x00, 0x00, 0x01)];
    const t = new ScriptedTransport(script);
    await expect(HwwCommunication.create(t)).rejects.toMatchObject({ code: 'version' });
  });

  it('populates Info for devices >=7.0.0', async () => {
    const script = [bytes(0x07, 0x76, 0x39, 0x2e, 0x31, 0x38, 0x2e, 0x30, 0x00, 0x00, 0x01)];
    const t = new ScriptedTransport(script);
    const hww = await HwwCommunication.create(t);
    expect(hww.info.version).toBe('9.18.0');
    expect(hww.info.product).toBe('bitbox02-multi');
  });
});

describe('HwwCommunication.query', () => {
  const INFO = bytes(0x07, 0x76, 0x39, 0x2e, 0x31, 0x38, 0x2e, 0x30, 0x00, 0x00, 0x01);

  it('ACK returns payload without the opcode byte', async () => {
    const t = new ScriptedTransport([INFO, bytes(HWW_RSP_ACK, 0xaa, 0xbb)]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    expect(await hww.query(bytes(0x10, 0x20))).toEqual(bytes(0xaa, 0xbb));
    expect(sleeper.calls).toEqual([]);
    expect(t.writes[1]).toEqual(bytes(HWW_REQ_NEW, 0x10, 0x20));
  });

  it('BUSY resends the same framed msg after 1000ms', async () => {
    const t = new ScriptedTransport([
      INFO,
      bytes(HWW_RSP_BUSY),
      bytes(HWW_RSP_ACK, 0x01),
    ]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    expect(await hww.query(bytes(0x42))).toEqual(bytes(0x01));
    expect(sleeper.calls).toEqual([1000]);
    expect(t.writes[1]).toEqual(bytes(HWW_REQ_NEW, 0x42));
    expect(t.writes[2]).toEqual(bytes(HWW_REQ_NEW, 0x42));
  });

  it('NOTREADY sends HWW_REQ_RETRY after 200ms', async () => {
    const t = new ScriptedTransport([
      INFO,
      bytes(HWW_RSP_NOTREADY),
      bytes(HWW_RSP_ACK, 0x77),
    ]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    expect(await hww.query(bytes(0x42))).toEqual(bytes(0x77));
    expect(sleeper.calls).toEqual([200]);
    expect(t.writes[2]).toEqual(bytes(HWW_REQ_RETRY));
  });

  it('BUSY twice then ACK', async () => {
    const t = new ScriptedTransport([
      INFO,
      bytes(HWW_RSP_BUSY),
      bytes(HWW_RSP_BUSY),
      bytes(HWW_RSP_ACK, 0x99),
    ]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    expect(await hww.query(bytes(0x01))).toEqual(bytes(0x99));
    expect(sleeper.calls).toEqual([1000, 1000]);
  });

  it('NOTREADY twice then ACK', async () => {
    const t = new ScriptedTransport([
      INFO,
      bytes(HWW_RSP_NOTREADY),
      bytes(HWW_RSP_NOTREADY),
      bytes(HWW_RSP_ACK, 0xcc),
    ]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    expect(await hww.query(bytes(0x01))).toEqual(bytes(0xcc));
    expect(sleeper.calls).toEqual([200, 200]);
  });

  it('BUSY after a RETRY is a protocol error', async () => {
    const t = new ScriptedTransport([
      INFO,
      bytes(HWW_RSP_NOTREADY),
      bytes(HWW_RSP_BUSY),
    ]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    await expect(hww.query(bytes(0x01))).rejects.toMatchObject({ code: 'info' });
  });

  it('NACK throws', async () => {
    const t = new ScriptedTransport([
      INFO,
      bytes(HWW_RSP_NACK),
    ]);
    const sleeper = fakeSleeper();
    const hww = await HwwCommunication.create(t, sleeper);
    await expect(hww.query(bytes(0x01))).rejects.toMatchObject({ code: 'info' });
  });
});

