/**
 * Client-safe helpers for HR branch tabs / badges. Branches come from the tenant's branch list
 * (API `scopeOptions` / ledger `tableBranches`); colours are assigned by position in that list.
 */

export type HrBranchOption = { code: string; label: string };

export type HrBranchPalette = {
  /** Badge: border + background + text. */
  badge: string;
  /** Table row tint. */
  row: string;
  /** Text accent. */
  text: string;
};

const HR_BRANCH_PALETTES: readonly HrBranchPalette[] = [
  { badge: 'border-sky-500/25 bg-sky-500/10 text-sky-300/90', row: 'bg-sky-500/5', text: 'text-sky-300' },
  { badge: 'border-amber-500/25 bg-amber-500/10 text-amber-300/90', row: 'bg-amber-500/5', text: 'text-amber-300' },
  { badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300/90', row: 'bg-emerald-500/5', text: 'text-emerald-300' },
  { badge: 'border-violet-500/25 bg-violet-500/10 text-violet-300/90', row: 'bg-violet-500/5', text: 'text-violet-300' },
  { badge: 'border-rose-500/25 bg-rose-500/10 text-rose-300/90', row: 'bg-rose-500/5', text: 'text-rose-300' },
  { badge: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300/90', row: 'bg-cyan-500/5', text: 'text-cyan-300' },
];

const NEUTRAL_PALETTE: HrBranchPalette = {
  badge: 'border-zinc-600/40 bg-zinc-800/60 text-zinc-400',
  row: '',
  text: 'text-zinc-400',
};

/** Palette for `code` by its index in `orderedCodes`; neutral when the code is not listed. */
export function hrBranchPalette(
  code: string | null | undefined,
  orderedCodes: readonly string[],
): HrBranchPalette {
  const key = String(code ?? '').trim().toUpperCase();
  const idx = orderedCodes.findIndex((c) => c.trim().toUpperCase() === key);
  if (!key || idx < 0) return NEUTRAL_PALETTE;
  return HR_BRANCH_PALETTES[idx % HR_BRANCH_PALETTES.length]!;
}

/** Label for `code` from the tenant branch options, else `fallback`, else the code. */
export function hrBranchOptionLabel(
  code: string | null | undefined,
  options: readonly HrBranchOption[],
  fallback?: string | null,
): string {
  const key = String(code ?? '').trim().toUpperCase();
  const hit = options.find((o) => o.code.trim().toUpperCase() === key);
  return hit?.label ?? (fallback?.trim() || String(code ?? ''));
}

/** Parse API `scopeOptions`; tolerates a missing / malformed field. */
export function parseHrBranchOptions(raw: unknown): HrBranchOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is { code: unknown; label: unknown } => o != null && typeof o === 'object')
    .map((o) => ({ code: String(o.code ?? ''), label: String(o.label ?? o.code ?? '') }))
    .filter((o) => o.code !== '');
}
