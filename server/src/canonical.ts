import { keccak256, stringToBytes } from 'viem';

/**
 * Canonical JSON: recursively sorted object keys, bigints as decimal strings,
 * no whitespace. Same input object => same bytes => same hash, everywhere.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortValue(val);
    }
    return out;
  }
  return v;
}

export function keccakOfJson(value: unknown): `0x${string}` {
  return keccak256(stringToBytes(canonicalJson(value)));
}

export function keccakOfBytes(bytes: Uint8Array): `0x${string}` {
  return keccak256(bytes);
}
