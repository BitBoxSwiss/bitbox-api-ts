// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  InMemoryNoiseConfig,
  LOCAL_STORAGE_CONFIG_KEY,
  LocalStorageNoiseConfig,
  NoiseConfigNoCache,
  addDeviceStaticPubkey,
  containsDeviceStaticPubkey,
  defaultNoiseConfig,
} from '../src/internal/noise-config.js';

class FakeStorage {
  store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('NoiseConfigNoCache', () => {
  it('reads as empty and ignores stores', () => {
    const c = new NoiseConfigNoCache();
    expect(c.read().appStaticPrivkey).toBeUndefined();
    expect(c.read().deviceStaticPubkeys).toEqual([]);
    c.store({ appStaticPrivkey: new Uint8Array(32), deviceStaticPubkeys: [new Uint8Array(32)] });
    expect(c.read().appStaticPrivkey).toBeUndefined();
    expect(c.read().deviceStaticPubkeys).toEqual([]);
  });
});

describe('InMemoryNoiseConfig', () => {
  it('stores and reads back the privkey and pubkey list', () => {
    const c = new InMemoryNoiseConfig();
    const sk = new Uint8Array(32).fill(7);
    const pk1 = new Uint8Array(32).fill(1);
    const pk2 = new Uint8Array(32).fill(2);
    c.store({ appStaticPrivkey: sk, deviceStaticPubkeys: [pk1, pk2] });
    const back = c.read();
    expect(back.appStaticPrivkey).toEqual(sk);
    expect(back.deviceStaticPubkeys).toEqual([pk1, pk2]);
  });

  it('returns defensive copies that callers can mutate without affecting state', () => {
    const c = new InMemoryNoiseConfig();
    const sk = new Uint8Array(32).fill(7);
    c.store({ appStaticPrivkey: sk, deviceStaticPubkeys: [] });
    const a = c.read();
    a.appStaticPrivkey![0] = 0xff;
    const b = c.read();
    expect(b.appStaticPrivkey![0]).toBe(7);
  });
});

describe('LocalStorageNoiseConfig', () => {
  it('persists to the bitbox02Config key with snake_case integer-array shape', () => {
    const fake = new FakeStorage();
    const c = new LocalStorageNoiseConfig(fake);
    const sk = new Uint8Array(32);
    sk[0] = 1;
    sk[31] = 0xff;
    const pk = new Uint8Array(32).fill(0x42);
    c.store({ appStaticPrivkey: sk, deviceStaticPubkeys: [pk] });

    const raw = fake.getItem(LOCAL_STORAGE_CONFIG_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.app_static_privkey).toBeInstanceOf(Array);
    expect(parsed.app_static_privkey[0]).toBe(1);
    expect(parsed.app_static_privkey[31]).toBe(0xff);
    expect(parsed.device_static_pubkeys).toBeInstanceOf(Array);
    expect(parsed.device_static_pubkeys[0]).toBeInstanceOf(Array);
    expect(parsed.device_static_pubkeys[0][0]).toBe(0x42);
  });

  it('serializes a missing privkey as null in the stored JSON', () => {
    const fake = new FakeStorage();
    const c = new LocalStorageNoiseConfig(fake);
    c.store({ deviceStaticPubkeys: [] });
    const parsed = JSON.parse(fake.getItem(LOCAL_STORAGE_CONFIG_KEY)!);
    expect(parsed.app_static_privkey).toBeNull();
    expect(parsed.device_static_pubkeys).toEqual([]);
  });

  it('reads back what it stored', () => {
    const fake = new FakeStorage();
    const c = new LocalStorageNoiseConfig(fake);
    const sk = new Uint8Array(32).fill(9);
    const pk1 = new Uint8Array(32).fill(0x10);
    const pk2 = new Uint8Array(32).fill(0x20);
    c.store({ appStaticPrivkey: sk, deviceStaticPubkeys: [pk1, pk2] });

    const back = new LocalStorageNoiseConfig(fake).read();
    expect(back.appStaticPrivkey).toEqual(sk);
    expect(back.deviceStaticPubkeys).toEqual([pk1, pk2]);
  });

  it('returns an empty config when the storage key is missing', () => {
    const fake = new FakeStorage();
    const c = new LocalStorageNoiseConfig(fake);
    const back = c.read();
    expect(back.appStaticPrivkey).toBeUndefined();
    expect(back.deviceStaticPubkeys).toEqual([]);
  });

  it('returns an empty config when the stored JSON is malformed', () => {
    const fake = new FakeStorage();
    fake.setItem(LOCAL_STORAGE_CONFIG_KEY, '{ not json');
    const back = new LocalStorageNoiseConfig(fake).read();
    expect(back.appStaticPrivkey).toBeUndefined();
    expect(back.deviceStaticPubkeys).toEqual([]);
  });

  it('returns an empty config when getItem throws', () => {
    const c = new LocalStorageNoiseConfig({
      getItem(): string | null {
        throw new Error('storage disabled');
      },
      setItem(): void {},
    });
    const back = c.read();
    expect(back.appStaticPrivkey).toBeUndefined();
    expect(back.deviceStaticPubkeys).toEqual([]);
  });

  it('returns an empty config when persisted byte arrays are malformed', () => {
    const fake = new FakeStorage();
    fake.setItem(
      LOCAL_STORAGE_CONFIG_KEY,
      JSON.stringify({
        app_static_privkey: [1, 2, 3],
        device_static_pubkeys: [],
      }),
    );
    let back = new LocalStorageNoiseConfig(fake).read();
    expect(back.appStaticPrivkey).toBeUndefined();
    expect(back.deviceStaticPubkeys).toEqual([]);

    fake.setItem(
      LOCAL_STORAGE_CONFIG_KEY,
      JSON.stringify({
        app_static_privkey: null,
        device_static_pubkeys: [Array.from({ length: 32 }, () => 256)],
      }),
    );
    back = new LocalStorageNoiseConfig(fake).read();
    expect(back.appStaticPrivkey).toBeUndefined();
    expect(back.deviceStaticPubkeys).toEqual([]);
  });

  it('throws noise-config when storage writes fail', () => {
    const c = new LocalStorageNoiseConfig({
      getItem(): string | null {
        return null;
      },
      setItem(): void {
        throw new Error('quota');
      },
    });
    expect(() => c.store({ deviceStaticPubkeys: [] })).toThrow(
      expect.objectContaining({
        code: 'noise-config',
        message: 'noise config error: could not write to localstorage',
      }),
    );
  });

  it('round-trips legacy JSON for migration compatibility', () => {
    const fake = new FakeStorage();
    const legacyShape = {
      app_static_privkey: Array.from({ length: 32 }, (_v, i) => i),
      device_static_pubkeys: [Array.from({ length: 32 }, (_v, i) => 0x80 | i)],
    };
    fake.setItem(LOCAL_STORAGE_CONFIG_KEY, JSON.stringify(legacyShape));

    const back = new LocalStorageNoiseConfig(fake).read();
    expect(Array.from(back.appStaticPrivkey!)).toEqual(legacyShape.app_static_privkey);
    expect(Array.from(back.deviceStaticPubkeys[0]!)).toEqual(legacyShape.device_static_pubkeys[0]);
  });
});

describe('config helpers', () => {
  it('detects pubkey membership and avoids duplicate inserts', () => {
    const pk = new Uint8Array(32).fill(7);
    const empty = { deviceStaticPubkeys: [] };
    expect(containsDeviceStaticPubkey(empty, pk)).toBe(false);

    const added = addDeviceStaticPubkey(empty, pk);
    expect(containsDeviceStaticPubkey(added, pk)).toBe(true);
    expect(added.deviceStaticPubkeys.length).toBe(1);

    const again = addDeviceStaticPubkey(added, pk);
    expect(again).toBe(added); // same reference: no-op when already present
  });

  it('reuses an in-memory default config when localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
    });
    try {
      const a = defaultNoiseConfig();
      const b = defaultNoiseConfig();
      expect(a).toBe(b);

      const sk = new Uint8Array(32).fill(3);
      const pk = new Uint8Array(32).fill(4);
      a.store({ appStaticPrivkey: sk, deviceStaticPubkeys: [pk] });

      const back = b.read();
      expect(back.appStaticPrivkey).toEqual(sk);
      expect(back.deviceStaticPubkeys).toEqual([pk]);
    } finally {
      if (original === undefined) {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      } else {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });
});
