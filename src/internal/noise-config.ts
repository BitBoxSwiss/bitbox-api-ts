// SPDX-License-Identifier: Apache-2.0

import { noiseConfigError } from './errors.js';

/** Persistent state for the Noise pairing layer. @internal */
export interface NoiseConfigData {
  appStaticPrivkey?: Uint8Array;
  deviceStaticPubkeys: Uint8Array[];
}

/** @internal */
export interface NoiseConfig {
  read(): NoiseConfigData;
  store(data: NoiseConfigData): void;
}

/** @internal */
export const LOCAL_STORAGE_CONFIG_KEY = 'bitbox02Config';

interface SerializedShape {
  app_static_privkey: number[] | null;
  device_static_pubkeys: number[][];
}

function emptyConfig(): NoiseConfigData {
  return { deviceStaticPubkeys: [] };
}

function toJson(data: NoiseConfigData): string {
  const shape: SerializedShape = {
    app_static_privkey:
      data.appStaticPrivkey !== undefined ? Array.from(data.appStaticPrivkey) : null,
    device_static_pubkeys: data.deviceStaticPubkeys.map((pk) => Array.from(pk)),
  };
  return JSON.stringify(shape);
}

function fromJson(text: string): NoiseConfigData {
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('must be an object');
  }
  const shape = parsed as Partial<SerializedShape>;
  const privkey = shape.app_static_privkey ?? null;
  const pubkeys = shape.device_static_pubkeys;
  if (!Array.isArray(pubkeys)) {
    throw new Error('device_static_pubkeys must be an array');
  }
  return {
    ...(privkey === null ? {} : { appStaticPrivkey: bytesFromArray(privkey, 'app_static_privkey') }),
    deviceStaticPubkeys: pubkeys.map((pk, index) => bytesFromArray(pk, `device_static_pubkeys[${index}]`)),
  };
}

function bytesFromArray(value: unknown, field: string): Uint8Array {
  if (!Array.isArray(value) || value.length !== 32) {
    throw new Error(`${field} must be a 32-byte integer array`);
  }
  for (const byte of value) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`${field} contains an invalid byte`);
    }
  }
  return Uint8Array.from(value);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** @internal */
export function containsDeviceStaticPubkey(data: NoiseConfigData, pubkey: Uint8Array): boolean {
  return data.deviceStaticPubkeys.some((known) => bytesEqual(known, pubkey));
}

/** @internal */
export function addDeviceStaticPubkey(
  data: NoiseConfigData,
  pubkey: Uint8Array,
): NoiseConfigData {
  if (containsDeviceStaticPubkey(data, pubkey)) {
    return data;
  }
  return {
    ...(data.appStaticPrivkey === undefined ? {} : { appStaticPrivkey: data.appStaticPrivkey }),
    deviceStaticPubkeys: [...data.deviceStaticPubkeys, new Uint8Array(pubkey)],
  };
}

/** Always returns an empty config and never persists. @internal */
export class NoiseConfigNoCache implements NoiseConfig {
  read(): NoiseConfigData {
    return emptyConfig();
  }
  store(_data: NoiseConfigData): void {
    // intentionally empty
  }
}

/**
 * In-memory storage. Used by tests and as a non-persisting default in
 * environments without `localStorage`.
 * @internal
 */
export class InMemoryNoiseConfig implements NoiseConfig {
  private data: NoiseConfigData = emptyConfig();
  read(): NoiseConfigData {
    return {
      ...(this.data.appStaticPrivkey === undefined
        ? {}
        : { appStaticPrivkey: new Uint8Array(this.data.appStaticPrivkey) }),
      deviceStaticPubkeys: this.data.deviceStaticPubkeys.map((pk) => new Uint8Array(pk)),
    };
  }
  store(data: NoiseConfigData): void {
    this.data = {
      ...(data.appStaticPrivkey === undefined
        ? {}
        : { appStaticPrivkey: new Uint8Array(data.appStaticPrivkey) }),
      deviceStaticPubkeys: data.deviceStaticPubkeys.map((pk) => new Uint8Array(pk)),
    };
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Browser-default config. Uses the `Storage`-shaped `localStorage` global; on a
 * missing key, malformed persisted JSON, or storage read failure it starts from
 * an empty config, matching the wasm package behavior.
 * @internal
 */
export class LocalStorageNoiseConfig implements NoiseConfig {
  private readonly storage: StorageLike;
  private readonly key: string;

  constructor(storage?: StorageLike, key: string = LOCAL_STORAGE_CONFIG_KEY) {
    const fallback = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (storage === undefined && fallback === undefined) {
      throw new Error('localStorage is not available');
    }
    this.storage = storage ?? (fallback as StorageLike);
    this.key = key;
  }

  read(): NoiseConfigData {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) {
        return emptyConfig();
      }
      return fromJson(raw);
    } catch {
      return emptyConfig();
    }
  }

  store(data: NoiseConfigData): void {
    try {
      this.storage.setItem(this.key, toJson(data));
    } catch {
      throw noiseConfigError('could not write to localstorage');
    }
  }
}

/**
 * Default config used by browser connect functions: localStorage-backed if
 * available, otherwise a module-scoped in-memory fallback. The fallback keeps
 * pairing trust for the lifetime of the current JS runtime, which avoids
 * repeated pairing prompts in browser contexts without localStorage while still
 * leaving explicit `NoiseConfigNoCache` available for tests and callers.
 * @internal
 */
const fallbackDefaultConfig = new InMemoryNoiseConfig();

export function defaultNoiseConfig(): NoiseConfig {
  let ls: StorageLike | undefined;
  try {
    ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  } catch {
    ls = undefined;
  }
  if (ls !== undefined) {
    return new LocalStorageNoiseConfig(ls);
  }
  return fallbackDefaultConfig;
}
