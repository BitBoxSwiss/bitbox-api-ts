// SPDX-License-Identifier: Apache-2.0

import type { Product } from '../index.js';
import { PACKET_SIZE, U2fHid, U2fWs } from './u2f-framing.js';
import { ReadWrite, TransportError, query } from './read-write.js';
import { sleep } from './utils.js';

/** @internal */
export const HWW_REQ_NEW = 0x00;
/** @internal */
export const HWW_REQ_RETRY = 0x01;
/** @internal */
export const HWW_INFO = 0x69;

/** @internal */
export const HWW_RSP_ACK = 0x00;
/** @internal */
export const HWW_RSP_NOTREADY = 0x01;
/** @internal */
export const HWW_RSP_BUSY = 0x02;
/** @internal */
export const HWW_RSP_NACK = 0x03;

const PLATFORM_BITBOX02 = 0x00;
const PLATFORM_BITBOX02_NOVA = 0x02;
const EDITION_MULTI = 0x00;
const EDITION_BTCONLY = 0x01;

const BUSY_SLEEP_MS = 1000;
const NOTREADY_SLEEP_MS = 200;

/** @internal */
export interface Info {
  version: string;
  product: Product;
  unlocked: boolean;
  initialized: boolean | undefined;
}

/** @internal */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

/** @internal */
export const DEFAULT_SLEEPER: Sleeper = { sleep };

/**
 * Wraps a lower byte-pipe with U2F HID framing. Writes are encoded and
 * chunked into 64-byte HID packets; reads accumulate packets until the
 * decoder returns a complete message.
 * @internal
 */
export class U2fHidCommunication implements ReadWrite {
  private readonly lower: ReadWrite;
  private readonly framer: U2fHid;

  constructor(lower: ReadWrite, cmd: number) {
    this.lower = lower;
    this.framer = new U2fHid(cmd);
  }

  write(msg: Uint8Array): void {
    const encoded = this.framer.encode(msg);
    for (let offset = 0; offset < encoded.length; offset += PACKET_SIZE) {
      this.lower.write(encoded.subarray(offset, offset + PACKET_SIZE));
    }
  }

  async read(): Promise<Uint8Array> {
    let buf = await this.lower.read();
    for (;;) {
      const decoded = this.framer.decode(buf);
      if (decoded !== null) {
        return decoded;
      }
      const more = await this.lower.read();
      const combined = new Uint8Array(buf.length + more.length);
      combined.set(buf, 0);
      combined.set(more, buf.length);
      buf = combined;
    }
  }
}

/**
 * Wraps a lower byte-pipe with single-frame U2F WS framing.
 * @internal
 */
export class U2fWsCommunication implements ReadWrite {
  private readonly lower: ReadWrite;
  private readonly framer: U2fWs;

  constructor(lower: ReadWrite, cmd: number) {
    this.lower = lower;
    this.framer = new U2fWs(cmd);
  }

  write(msg: Uint8Array): void {
    this.lower.write(this.framer.encode(msg));
  }

  async read(): Promise<Uint8Array> {
    let buf = await this.lower.read();
    for (;;) {
      const decoded = this.framer.decode(buf);
      if (decoded !== null) {
        return decoded;
      }
      const more = await this.lower.read();
      const combined = new Uint8Array(buf.length + more.length);
      combined.set(buf, 0);
      combined.set(more, buf.length);
      buf = combined;
    }
  }
}

function productFrom(platform: number, edition: number): Product {
  if (platform === PLATFORM_BITBOX02 && edition === EDITION_MULTI) {
    return 'bitbox02-multi';
  }
  if (platform === PLATFORM_BITBOX02 && edition === EDITION_BTCONLY) {
    return 'bitbox02-btconly';
  }
  if (platform === PLATFORM_BITBOX02_NOVA && edition === EDITION_MULTI) {
    return 'bitbox02-nova-multi';
  }
  if (platform === PLATFORM_BITBOX02_NOVA && edition === EDITION_BTCONLY) {
    return 'bitbox02-nova-btconly';
  }
  return 'unknown';
}

/** @internal */
export function parseSemver(s: string): { major: number; minor: number; patch: number } {
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (m === null) {
    throw new TransportError('info', `invalid semver: ${s}`);
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * Returns true if `v >= target`. Both are major.minor.patch triplets.
 * @internal
 */
export function atLeast(
  v: { major: number; minor: number; patch: number },
  target: { major: number; minor: number; patch: number },
): boolean {
  if (v.major !== target.major) {
    return v.major > target.major;
  }
  if (v.minor !== target.minor) {
    return v.minor > target.minor;
  }
  return v.patch >= target.patch;
}

/**
 * Probes the device over the HWW info opcode. Runs before Noise pairing and
 * before any HWW request framing.
 * @internal
 */
export async function getInfo(rw: ReadWrite): Promise<Info> {
  const response = await query(rw, new Uint8Array([HWW_INFO]));
  if (response.length < 1) {
    throw new TransportError('info', 'empty info response');
  }
  const versionLen = response[0] as number;
  if (response.length < 1 + versionLen + 3) {
    throw new TransportError('info', 'truncated info response');
  }
  const versionRaw = new TextDecoder().decode(response.subarray(1, 1 + versionLen));
  if (!versionRaw.startsWith('v')) {
    throw new TransportError('info', 'version missing v-prefix');
  }
  const version = versionRaw.slice(1);
  parseSemver(version);

  const tail = response.subarray(1 + versionLen);
  const platform = tail[0] as number;
  const edition = tail[1] as number;
  const unlockedByte = tail[2] as number;
  const initializedByte = tail.length >= 4 ? (tail[3] as number) : undefined;

  let unlocked: boolean;
  if (unlockedByte === 0x00) {
    unlocked = false;
  } else if (unlockedByte === 0x01) {
    unlocked = true;
  } else {
    throw new TransportError('info', `invalid unlocked byte: ${unlockedByte}`);
  }

  let initialized: boolean | undefined;
  if (initializedByte === undefined) {
    initialized = undefined;
  } else if (initializedByte === 0x00) {
    initialized = false;
  } else if (initializedByte === 0x01) {
    initialized = true;
  } else {
    throw new TransportError('info', `invalid initialized byte: ${initializedByte}`);
  }

  return {
    version,
    product: productFrom(platform, edition),
    unlocked,
    initialized,
  };
}

/**
 * Adds the HWW request/response framing opcode layer plus BUSY/NOTREADY
 * retry logic on top of the U2F-framed communication.
 * @internal
 */
export class HwwCommunication {
  readonly comm: ReadWrite;
  readonly info: Info;
  private readonly sleeper: Sleeper;

  constructor(comm: ReadWrite, info: Info, sleeper: Sleeper = DEFAULT_SLEEPER) {
    this.comm = comm;
    this.info = info;
    this.sleeper = sleeper;
  }

  static async create(comm: ReadWrite, sleeper: Sleeper = DEFAULT_SLEEPER): Promise<HwwCommunication> {
    const info = await getInfo(comm);
    if (!atLeast(parseSemver(info.version), { major: 7, minor: 0, patch: 0 })) {
      throw new TransportError('version', 'firmware version >=7.0.0 required');
    }
    return new HwwCommunication(comm, info, sleeper);
  }

  async query(msg: Uint8Array): Promise<Uint8Array> {
    const framed = new Uint8Array(msg.length + 1);
    framed[0] = HWW_REQ_NEW;
    framed.set(msg, 1);

    let response: Uint8Array;
    for (;;) {
      response = await query(this.comm, framed);
      if (response.length >= 1 && response[0] === HWW_RSP_BUSY) {
        await this.sleeper.sleep(BUSY_SLEEP_MS);
        continue;
      }
      break;
    }

    for (;;) {
      if (response.length < 1) {
        throw new TransportError('info', 'empty HWW response');
      }
      const opcode = response[0];
      if (opcode === HWW_RSP_ACK) {
        return response.slice(1);
      }
      if (opcode === HWW_RSP_NOTREADY) {
        await this.sleeper.sleep(NOTREADY_SLEEP_MS);
        response = await query(this.comm, new Uint8Array([HWW_REQ_RETRY]));
        continue;
      }
      throw new TransportError('info', `HWW response opcode ${opcode}`);
    }
  }
}
