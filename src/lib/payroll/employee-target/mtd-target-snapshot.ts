/**
 * Shared helpers for MTD target breakdown display (full-day + WhatsApp).
 */

export interface TargetTierBreakdownSlice {
  from: number;
  to: number | null;
  eligibleAmount: number;
  ratePercent: number;
  targetAmount: number;
}

export interface ParsedMtdTargetSnapshot {
  mtdSales: number | null;
  mtdTargetAmount: number | null;
  dayDelta: number | null;
  daySales: number | null;
  breakdown: TargetTierBreakdownSlice[];
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseMtdTargetSnapshot(
  json: string | null | undefined,
): ParsedMtdTargetSnapshot {
  if (!json) {
    return {
      mtdSales: null,
      mtdTargetAmount: null,
      dayDelta: null,
      daySales: null,
      breakdown: [],
    };
  }
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const breakdownRaw = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];
    const breakdown: TargetTierBreakdownSlice[] = breakdownRaw.map(
      (b: Record<string, unknown>) => ({
        from: Number(b.from ?? 0),
        to: b.to == null ? null : Number(b.to),
        eligibleAmount: Number(b.eligibleAmount ?? 0),
        ratePercent: Number(b.ratePercent ?? 0),
        targetAmount: Number(b.targetAmount ?? 0),
      }),
    );
    return {
      mtdSales: numOrNull(parsed.mtdSales),
      mtdTargetAmount: numOrNull(parsed.mtdTargetAmount),
      dayDelta: numOrNull(parsed.dayDelta) ?? numOrNull(parsed.targetAmount),
      daySales: numOrNull(parsed.daySales) ?? numOrNull(parsed.netSalesAfterDiscount),
      breakdown,
    };
  } catch {
    return {
      mtdSales: null,
      mtdTargetAmount: null,
      dayDelta: null,
      daySales: null,
      breakdown: [],
    };
  }
}

function moneyPlain(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact Arabic/English-numeral lines for WhatsApp / UI. */
export function formatTargetBreakdownLinesAr(
  slices: TargetTierBreakdownSlice[],
  options?: { onlyEligible?: boolean },
): string[] {
  const onlyEligible = options?.onlyEligible !== false;
  const lines: string[] = [];
  for (const row of slices) {
    if (onlyEligible && !(row.eligibleAmount > 0)) continue;
    const range =
      row.to != null
        ? `${moneyPlain(row.from)}→${moneyPlain(row.to)}`
        : `${moneyPlain(row.from)}+`;
    lines.push(
      `• ${range}: ${moneyPlain(row.eligibleAmount)} × ${moneyPlain(row.ratePercent)}% = ${moneyPlain(row.targetAmount)}`,
    );
  }
  return lines;
}
