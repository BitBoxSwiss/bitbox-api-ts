// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  HEADER_INIT_LEN,
  MAX_LEN,
  U2fHid,
  U2fWs,
  getEncodedLen,
  parseHeader,
} from '../src/internal/u2f-framing.js';

const TEST_CID = 0xeeeeeeee;
const TEST_CMD = 0x55;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('getEncodedLen', () => {
  it('single-packet boundary', () => {
    expect(getEncodedLen(0)).toBe(64);
    expect(getEncodedLen(56)).toBe(64);
    expect(getEncodedLen(57)).toBe(64);
  });

  it('spills to continuation at 58 bytes', () => {
    expect(getEncodedLen(58)).toBe(128);
    expect(getEncodedLen(116)).toBe(128);
  });

  it('second continuation at 117 bytes', () => {
    expect(getEncodedLen(117)).toBe(192);
  });
});

describe('U2fHid', () => {
  it('encodes a 4-byte payload into a 64-byte frame (Rust vector)', () => {
    const codec = new U2fHid(TEST_CMD, TEST_CID);
    const out = codec.encode(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    expect(out.length).toBe(64);
    // Header: CID BE (4) + CMD (1) + length BE (2) + payload (4) + zero pad.
    const expectHeader = 'eeeeeeee5500040102030400';
    expect(hex(out.subarray(0, 12))).toBe(expectHeader);
    expect(hex(out.subarray(12))).toBe('00'.repeat(64 - 12));
  });

  it('round-trips a single-packet payload', () => {
    const codec = new U2fHid(TEST_CMD, TEST_CID);
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const decoded = codec.decode(codec.encode(payload));
    expect(decoded).toEqual(payload);
  });

  it('encodes a 65-byte payload into two 64-byte frames (Rust vector)', () => {
    const codec = new U2fHid(TEST_CMD, TEST_CID);
    const payload = new Uint8Array(65);
    for (let i = 0; i < 65; i += 1) {
      payload[i] = i;
    }
    const out = codec.encode(payload);
    expect(out.length).toBe(128);

    const expected = new Uint8Array(128);
    // Packet 1: CID (4) + CMD (1) + length 0x0041 (2) + first 57 payload bytes.
    expected.set([0xee, 0xee, 0xee, 0xee, 0x55, 0x00, 0x41], 0);
    expected.set(payload.subarray(0, 57), 7);
    // Packet 2: CID (4) + seq 0 (1) + remaining 8 payload bytes.
    expected.set([0xee, 0xee, 0xee, 0xee, 0x00], 64);
    expected.set(payload.subarray(57), 69);

    expect(hex(out)).toBe(hex(expected));
  });

  it('round-trips a multi-packet payload', () => {
    const codec = new U2fHid(TEST_CMD, TEST_CID);
    const payload = new Uint8Array(200);
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = (i * 3) & 0xff;
    }
    const decoded = codec.decode(codec.encode(payload));
    expect(decoded).toEqual(payload);
  });

  it('decode returns null when the buffer is short by one byte', () => {
    const codec = new U2fHid(TEST_CMD, TEST_CID);
    const payload = new Uint8Array(65);
    for (let i = 0; i < 65; i += 1) {
      payload[i] = i;
    }
    const encoded = codec.encode(payload);
    // Drop the last byte. getEncodedLen(65) == 128; 127 bytes is incomplete.
    const short = encoded.subarray(0, encoded.length - 1);
    expect(codec.decode(short)).toBeNull();
  });

  it('decode throws on CID mismatch', () => {
    const encoder = new U2fHid(TEST_CMD, TEST_CID);
    const decoder = new U2fHid(TEST_CMD, 0x11223344);
    const encoded = encoder.encode(new Uint8Array([1, 2, 3]));
    expect(() => decoder.decode(encoded)).toThrow(/CID/);
  });

  it('decode throws on CMD mismatch', () => {
    const encoder = new U2fHid(TEST_CMD, TEST_CID);
    const decoder = new U2fHid(0x33, TEST_CID);
    const encoded = encoder.encode(new Uint8Array([1, 2, 3]));
    expect(() => decoder.decode(encoded)).toThrow(/CMD/);
  });
});

describe('U2fWs', () => {
  it('encodes as a single header+payload frame (Rust vector)', () => {
    const codec = new U2fWs(TEST_CMD, TEST_CID);
    const out = codec.encode(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    expect(out.length).toBe(11);
    expect(hex(out)).toBe('eeeeeeee55000401020304');
  });

  it('round-trips single-packet', () => {
    const codec = new U2fWs(TEST_CMD, TEST_CID);
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    expect(codec.decode(codec.encode(payload))).toEqual(payload);
  });

  it('encodes a 65-byte payload as 72-byte frame (Rust vector)', () => {
    const codec = new U2fWs(TEST_CMD, TEST_CID);
    const payload = new Uint8Array(65);
    for (let i = 0; i < 65; i += 1) {
      payload[i] = i;
    }
    const out = codec.encode(payload);
    expect(out.length).toBe(72);
    const header = new Uint8Array([0xee, 0xee, 0xee, 0xee, 0x55, 0x00, 0x41]);
    expect(hex(out.subarray(0, 7))).toBe(hex(header));
    expect(hex(out.subarray(7))).toBe(hex(payload));
  });

  it('rejects payloads that do not fit the old bridge frame buffer', () => {
    const codec = new U2fWs(TEST_CMD, TEST_CID);
    const maxPayload = MAX_LEN - HEADER_INIT_LEN;
    expect(codec.encode(new Uint8Array(maxPayload)).length).toBe(MAX_LEN);
    expect(() => codec.encode(new Uint8Array(maxPayload + 1))).toThrow(/max payload/);
  });
});

describe('parseHeader', () => {
  it('parses CID, CMD, and length in network byte order', () => {
    const buf = new Uint8Array([0xee, 0xee, 0xee, 0xee, 0x55, 0x01, 0x23, 0x99]);
    const h = parseHeader(buf);
    expect(h.cid).toBe(0xeeeeeeee);
    expect(h.cmd).toBe(0x55);
    expect(h.len).toBe(0x0123);
  });

  it('throws on a short buffer', () => {
    expect(() => parseHeader(new Uint8Array(6))).toThrow();
  });
});
