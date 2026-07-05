export function usdc(baseUnits: string | bigint | undefined, digits = 2): string {
  if (baseUnits === undefined || baseUnits === null) return '—';
  const n = Number(BigInt(baseUnits)) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function shortAddr(a?: string): string {
  if (!a || a === '0x0000000000000000000000000000000000000000') return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h?: string, n = 10): string {
  if (!h || /^0x0+$/.test(h)) return '—';
  return `${h.slice(0, n)}…`;
}

export function tsToDate(ts: string | number | bigint | undefined, lang: 'en' | 'ja' = 'en'): string {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isZeroHash(h?: string): boolean {
  return !h || /^0x0+$/.test(h);
}
