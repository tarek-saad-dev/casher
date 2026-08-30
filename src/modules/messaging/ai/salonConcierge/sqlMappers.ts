/** Parse JSON array columns from SQL. */
export function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null) return [];
  if (typeof raw !== 'string') return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t) as unknown;
    if (Array.isArray(v)) return v.map(String);
  } catch {
    return t.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function parseNumberArray(raw: unknown): number[] {
  return parseStringArray(raw)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

export function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
