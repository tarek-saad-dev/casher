/**
 * Canonical service-line money math for POS create/update.
 * Server must recompute — never trust client sPriceAfterDis.
 */

import { roundMoney } from '@/lib/reportMonthUtils';

export type ServiceLineTotalsInput = {
  sPrice: number;
  qty: number;
  /** Line discount percent (0–100). Used when discountValue is not provided. */
  discountPercent?: number | null;
  /** Explicit line discount value. Preferred over percent when both are set. */
  discountValue?: number | null;
};

export type ServiceLineTotals = {
  grossAmount: number;
  discountPercent: number;
  discountValue: number;
  netAmount: number;
};

function safeNonNeg(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Compute gross / discount / net for one service line.
 *
 * Semantics aligned with create INSERT:
 * - SValue            = grossAmount (= sPrice × qty)
 * - DisVal            = discountValue
 * - SPriceAfterDis    = netAmount (line net after discount)
 * - Dis               = discountPercent (stored for display/edit)
 */
export function computeServiceLineTotals(input: ServiceLineTotalsInput): ServiceLineTotals {
  const sPrice = safeNonNeg(input.sPrice);
  const rawQty = Number(input.qty ?? 0);
  const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;

  const grossAmount = roundMoney(sPrice * qty);

  let discountValue = 0;
  let discountPercent = 0;

  const explicitDisVal = input.discountValue;
  const explicitDisPct = input.discountPercent;

  if (explicitDisVal != null && Number.isFinite(Number(explicitDisVal))) {
    discountValue = roundMoney(Math.max(0, Number(explicitDisVal)));
    discountPercent =
      grossAmount > 0
        ? roundMoney(Math.min(100, (discountValue / grossAmount) * 100))
        : 0;
    if (explicitDisPct != null && Number.isFinite(Number(explicitDisPct))) {
      discountPercent = roundMoney(Math.max(0, Math.min(100, Number(explicitDisPct))));
    }
  } else if (explicitDisPct != null && Number.isFinite(Number(explicitDisPct))) {
    discountPercent = roundMoney(Math.max(0, Math.min(100, Number(explicitDisPct))));
    discountValue = roundMoney((grossAmount * discountPercent) / 100);
  }

  if (discountValue > grossAmount) {
    discountValue = grossAmount;
    discountPercent = grossAmount > 0 ? 100 : 0;
  }

  const netAmount = roundMoney(Math.max(0, grossAmount - discountValue));

  return {
    grossAmount,
    discountPercent,
    discountValue,
    netAmount,
  };
}

export type HeaderDiscountInput = {
  /** Header discount percent (0–100). Applied to Σ line nets when value is not set. */
  discountPercent?: number | null;
  /** Explicit header discount value. Preferred when > 0. */
  discountValue?: number | null;
};

export type InvoiceItemsTotals = {
  /** Σ line gross (SValue) */
  subTotal: number;
  /** Σ line DisVal */
  lineDiscountTotal: number;
  /** Header DisVal after clamp */
  headerDiscountValue: number;
  /** Header Dis % after normalize */
  headerDiscountPercent: number;
  /** Σ line nets (before header discount) */
  linesNetTotal: number;
  /** Σ line DisVal + header DisVal */
  totalDiscount: number;
  /** linesNetTotal − headerDiscountValue */
  grandTotal: number;
  totalQty: number;
  totalBonus: number;
  lines: ServiceLineTotals[];
};

export type InvoiceItemForTotals = ServiceLineTotalsInput & {
  bonus?: number | null;
};

/**
 * Resolve header discount against the post-line-discount base (Σ line nets).
 * Prefer explicit value when provided; otherwise derive from percent.
 */
export function resolveHeaderDiscount(
  linesNetTotal: number,
  header?: HeaderDiscountInput | null,
): { discountPercent: number; discountValue: number } {
  const base = roundMoney(Math.max(0, linesNetTotal));
  if (!header || base <= 0) {
    return { discountPercent: 0, discountValue: 0 };
  }

  const rawVal = header.discountValue;
  const rawPct = header.discountPercent;

  let discountValue = 0;
  let discountPercent = 0;

  if (rawVal != null && Number.isFinite(Number(rawVal)) && Number(rawVal) > 0) {
    discountValue = roundMoney(Math.max(0, Number(rawVal)));
    discountPercent = roundMoney(Math.min(100, (discountValue / base) * 100));
    if (rawPct != null && Number.isFinite(Number(rawPct)) && Number(rawPct) > 0) {
      discountPercent = roundMoney(Math.max(0, Math.min(100, Number(rawPct))));
    }
  } else if (rawPct != null && Number.isFinite(Number(rawPct)) && Number(rawPct) > 0) {
    discountPercent = roundMoney(Math.max(0, Math.min(100, Number(rawPct))));
    discountValue = roundMoney((base * discountPercent) / 100);
  }

  if (discountValue > base) {
    discountValue = base;
    discountPercent = 100;
  }

  return { discountPercent, discountValue };
}

/**
 * Aggregate invoice totals from service lines + optional header discount.
 *
 * GrandTotal = Σ line nets − header DisVal
 * SubTotal   = Σ line gross
 */
export function computeInvoiceItemsTotals(
  items: InvoiceItemForTotals[],
  header?: HeaderDiscountInput | null,
): InvoiceItemsTotals {
  const lines = items.map((item) => computeServiceLineTotals(item));
  const subTotal = roundMoney(lines.reduce((sum, line) => sum + line.grossAmount, 0));
  const lineDiscountTotal = roundMoney(
    lines.reduce((sum, line) => sum + line.discountValue, 0),
  );
  const linesNetTotal = roundMoney(lines.reduce((sum, line) => sum + line.netAmount, 0));
  const resolvedHeader = resolveHeaderDiscount(linesNetTotal, header);
  const grandTotal = roundMoney(Math.max(0, linesNetTotal - resolvedHeader.discountValue));
  const totalDiscount = roundMoney(lineDiscountTotal + resolvedHeader.discountValue);
  const totalQty = roundMoney(
    items.reduce((sum, item) => {
      const q = Number(item.qty ?? 0);
      return sum + (Number.isFinite(q) && q > 0 ? q : 1);
    }, 0),
  );
  const totalBonus = roundMoney(
    items.reduce((sum, item) => sum + safeNonNeg(item.bonus), 0),
  );

  return {
    subTotal,
    lineDiscountTotal,
    headerDiscountValue: resolvedHeader.discountValue,
    headerDiscountPercent: resolvedHeader.discountPercent,
    linesNetTotal,
    totalDiscount,
    grandTotal,
    totalQty,
    totalBonus,
    lines,
  };
}

/** True when client payload attempts a non-zero invoice-level (header) discount. */
export function hasNonZeroHeaderDiscount(payload: {
  dis?: number | null;
  disVal?: number | null;
  discount?: number | null;
  discountValue?: number | null;
  headerDis?: number | null;
  headerDisVal?: number | null;
}): boolean {
  const candidates = [
    payload.dis,
    payload.disVal,
    payload.discount,
    payload.discountValue,
    payload.headerDis,
    payload.headerDisVal,
  ];
  return candidates.some((v) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n > 0;
  });
}
