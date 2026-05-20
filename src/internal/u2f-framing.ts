// SPDX-License-Identifier: Apache-2.0

import { TransportError } from './read-write.js';

/** @internal */
export const HEADER_INIT_LEN = 7;
/** @internal */
export const HEADER_CONT_LEN = 5;
/** @internal */
export const PACKET_SIZE = 64;
/** @internal */
export const MAX_LEN = 129 * PACKET_SIZE;

const MAX_PAYLOAD = PACKET_SIZE - HEADER_INIT_LEN + 128 * (PACKET_SIZE - HEADER_CONT_LEN);
const MAX_WS_PAYLOAD = MAX_LEN - HEADER_INIT_LEN;

/**
 * Total buffer length an encoded message occupies, counting the padding that
 * fills each 64-byte HID packet. Mirrors
 * `bitbox-api-rs/src/u2fframing.rs:163-170`.
 * @internal
 */
export function getEncodedLen(len: number): number {
  if (len < PACKET_SIZE - HEADER_INIT_LEN) {
    return PACKET_SIZE;
  }
  const remainder = len - (PACKET_SIZE - HEADER_INIT_LEN);
  return PACKET_SIZE + PACKET_SIZE * Math.ceil(remainder / (PACKET_SIZE - HEADER_CONT_LEN));
}

function viewOf(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** @internal */
export function parseHeader(buf: Uint8Array): { cid: number; cmd: number; len: number } {
  if (buf.length < HEADER_INIT_LEN) {
    throw new TransportError('u2f-decode', 'buffer too short for header');
  }
  const v = viewOf(buf);
  return {
    cid: v.getUint32(0, false),
    cmd: v.getUint8(4),
    len: v.getUint16(5, false),
  };
}

/**
 * Returns the CID used for every frame. Hardcoded to match
 * `bitbox-api-rs/src/u2fframing.rs:68-70` so the existing test vectors apply
 * byte-for-byte.
 * @internal
 */
export function generateCid(): number {
  return 0xff00ff00;
}

/** @internal */
export interface U2fFraming {
  encode(message: Uint8Array): Uint8Array;
  decode(buf: Uint8Array): Uint8Array | null;
}

/**
 * U2F HID framing: splits a payload across 64-byte packets with one initial
 * header and sequenced continuation headers. Mirrors Rust `U2fHid`.
 * @internal
 */
export class U2fHid implements U2fFraming {
  readonly cid: number;
  readonly cmd: number;

  constructor(cmd: number, cid: number = generateCid()) {
    this.cmd = cmd;
    this.cid = cid;
  }

  encode(message: Uint8Array): Uint8Array {
    if (message.length > MAX_PAYLOAD) {
      throw new TransportError('u2f-decode', 'message exceeds U2F HID max payload');
    }
    const encLen = getEncodedLen(message.length);
    const buf = new Uint8Array(encLen);
    const v = viewOf(buf);

    v.setUint32(0, this.cid, false);
    buf[4] = this.cmd;
    v.setUint16(5, message.length, false);

    const firstPayload = Math.min(PACKET_SIZE - HEADER_INIT_LEN, message.length);
    buf.set(message.subarray(0, firstPayload), HEADER_INIT_LEN);

    let msgOffset = firstPayload;
    let pktOffset = PACKET_SIZE;
    let seq = 0;
    while (msgOffset < message.length) {
      if (seq > 127) {
        throw new TransportError('u2f-decode', 'too many U2F continuation frames');
      }
      v.setUint32(pktOffset, this.cid, false);
      buf[pktOffset + 4] = seq;
      const chunkLen = Math.min(PACKET_SIZE - HEADER_CONT_LEN, message.length - msgOffset);
      buf.set(message.subarray(msgOffset, msgOffset + chunkLen), pktOffset + HEADER_CONT_LEN);
      msgOffset += chunkLen;
      pktOffset += PACKET_SIZE;
      seq += 1;
    }

    return buf;
  }

  decode(buf: Uint8Array): Uint8Array | null {
    const { cid, cmd, len } = parseHeader(buf);
    if (cid !== this.cid) {
      throw new TransportError('u2f-decode', 'wrong CID');
    }
    if (cmd !== this.cmd) {
      throw new TransportError('u2f-decode', 'wrong CMD');
    }
    if (buf.length < getEncodedLen(len)) {
      return null;
    }

    const res = new Uint8Array(len);
    const firstLen = Math.min(PACKET_SIZE - HEADER_INIT_LEN, len);
    res.set(buf.subarray(HEADER_INIT_LEN, HEADER_INIT_LEN + firstLen), 0);

    let resOffset = firstLen;
    let pktOffset = PACKET_SIZE;
    while (resOffset < len) {
      const chunkLen = Math.min(PACKET_SIZE - HEADER_CONT_LEN, len - resOffset);
      res.set(
        buf.subarray(pktOffset + HEADER_CONT_LEN, pktOffset + HEADER_CONT_LEN + chunkLen),
        resOffset,
      );
      resOffset += chunkLen;
      pktOffset += PACKET_SIZE;
    }
    return res;
  }
}

/**
 * U2F WebSocket framing: single header + payload in one frame. The bridge
 * uses this over the WebSocket instead of HID packet segmentation.
 * Mirrors Rust `U2fWs`.
 * @internal
 */
export class U2fWs implements U2fFraming {
  readonly cid: number;
  readonly cmd: number;

  constructor(cmd: number, cid: number = generateCid()) {
    this.cmd = cmd;
    this.cid = cid;
  }

  encode(message: Uint8Array): Uint8Array {
    if (message.length > MAX_WS_PAYLOAD) {
      throw new TransportError('u2f-decode', 'message exceeds U2F WS max payload');
    }
    const buf = new Uint8Array(HEADER_INIT_LEN + message.length);
    const v = viewOf(buf);
    v.setUint32(0, this.cid, false);
    buf[4] = this.cmd;
    v.setUint16(5, message.length, false);
    buf.set(message, HEADER_INIT_LEN);
    return buf;
  }

  decode(buf: Uint8Array): Uint8Array | null {
    const { cid, cmd, len } = parseHeader(buf);
    if (cid !== this.cid) {
      throw new TransportError('u2f-decode', 'wrong CID');
    }
    if (cmd !== this.cmd) {
      throw new TransportError('u2f-decode', 'wrong CMD');
    }
    if (buf.length < HEADER_INIT_LEN + len) {
      throw new TransportError('u2f-decode', 'invalid length');
    }
    return buf.slice(HEADER_INIT_LEN, HEADER_INIT_LEN + len);
  }
}
