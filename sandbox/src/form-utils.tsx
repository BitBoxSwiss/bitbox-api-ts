// SPDX-License-Identifier: Apache-2.0

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0) {
    throw new Error(`invalid hex length: ${hex}`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex digit in ${hex}`);
    }
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function ResultBlock({ value }: { value: string }) {
  if (value === '') {
    return null;
  }
  return (
    <div className="resultContainer">
      <label>Result</label>
      <textarea rows={Math.min(value.split('\n').length + 2, 32)} readOnly defaultValue={value} />
    </div>
  );
}

export function formatResult(value: unknown | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}
