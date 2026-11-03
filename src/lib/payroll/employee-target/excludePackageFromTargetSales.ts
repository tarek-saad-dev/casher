/**
 * Drop package (required) invoice lines from employee daily-target sales input.
 * Add-on ProIDs stay countable. Employee-services report is intentionally unchanged.
 */
import { parseGroomPackageMetadataNote } from '@/lib/booking/groomPackageMetadata';
import { roundMoney } from '@/lib/reportMonthUtils';
import { calculateServiceLineTotal } from '@/lib/services/employeeServiceBreakdown';
import type {
  DetailLineForAllocation,
  InvoiceHeaderInput,
} from '@/lib/services/employeeInvoiceAllocation';

export type TargetInvoiceHeader = InvoiceHeaderInput & {
  notes?: string | null;
  notes2?: string | null;
};

function safeMoney(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function invoiceKey(invType: string, invID: number): string {
  return `${invType}-${invID}`;
}

function lineGrossAmount(line: DetailLineForAllocation): number {
  if (line.lineTotal != null) {
    return roundMoney(safeMoney(line.lineTotal));
  }
  return calculateServiceLineTotal(line);
}

function packageMetaForHeader(header: TargetInvoiceHeader) {
  return (
    parseGroomPackageMetadataNote(header.notes2) ??
    parseGroomPackageMetadataNote(header.notes)
  );
}

/**
 * Exclude package body revenue from target allocation inputs.
 * Rewrites SubTotal / GrandTotal / DisVal so remaining add-on lines cannot
 * inherit a share of the package amount under legacy header-discount math.
 */
export function excludePackageRevenueFromTargetAllocation(
  headers: TargetInvoiceHeader[],
  detailLines: DetailLineForAllocation[],
): {
  headers: InvoiceHeaderInput[];
  detailLines: DetailLineForAllocation[];
} {
  const linesByInvoice = new Map<string, DetailLineForAllocation[]>();
  for (const line of detailLines) {
    const key = invoiceKey(line.invType, line.invID);
    if (!linesByInvoice.has(key)) linesByInvoice.set(key, []);
    linesByInvoice.get(key)!.push(line);
  }

  const keptLines: DetailLineForAllocation[] = [];
  const outHeaders: InvoiceHeaderInput[] = [];

  for (const header of headers) {
    const key = invoiceKey(header.invType, header.invID);
    const invoiceLines = linesByInvoice.get(key) ?? [];
    const meta = packageMetaForHeader(header);

    if (!meta || meta.requiredServiceIds.length === 0) {
      outHeaders.push({
        invID: header.invID,
        invType: header.invType,
        subTotal: header.subTotal,
        grandTotal: header.grandTotal,
        disVal: header.disVal,
      });
      keptLines.push(...invoiceLines);
      continue;
    }

    const required = new Set(meta.requiredServiceIds);
    const kept: DetailLineForAllocation[] = [];
    let excludedGross = 0;
    let keptGross = 0;

    for (const line of invoiceLines) {
      const gross = lineGrossAmount(line);
      if (required.has(line.proId)) {
        excludedGross = roundMoney(excludedGross + gross);
      } else {
        keptGross = roundMoney(keptGross + gross);
        kept.push(line);
      }
    }

    if (excludedGross <= 0 && kept.length === invoiceLines.length) {
      // Metadata present but no matching required lines — leave invoice alone.
      outHeaders.push({
        invID: header.invID,
        invType: header.invType,
        subTotal: header.subTotal,
        grandTotal: header.grandTotal,
        disVal: header.disVal,
      });
      keptLines.push(...invoiceLines);
      continue;
    }

    const originalSub = roundMoney(Math.max(0, safeMoney(header.subTotal)));
    const originalGrand = roundMoney(Math.max(0, safeMoney(header.grandTotal)));
    const originalDis = roundMoney(Math.max(0, safeMoney(header.disVal)));

    let newSubTotal: number;
    let newGrandTotal: number;
    let newDisVal: number;

    if (keptGross <= 0) {
      newSubTotal = 0;
      newGrandTotal = 0;
      newDisVal = 0;
    } else if (originalSub <= 0) {
      newSubTotal = keptGross;
      newGrandTotal = keptGross;
      newDisVal = 0;
    } else if (originalDis > 0) {
      // Preserve remaining share of net after header discount.
      const ratio = keptGross / originalSub;
      newSubTotal = roundMoney(originalSub * ratio);
      newGrandTotal = roundMoney(originalGrand * ratio);
      newDisVal = roundMoney(Math.max(0, newSubTotal - newGrandTotal));
    } else {
      // New POS model: discounts live on lines; GrandTotal ≈ Σ line nets.
      newSubTotal = keptGross;
      newGrandTotal = keptGross;
      newDisVal = 0;
    }

    outHeaders.push({
      invID: header.invID,
      invType: header.invType,
      subTotal: newSubTotal,
      grandTotal: newGrandTotal,
      disVal: newDisVal,
    });
    keptLines.push(...kept);
  }

  return { headers: outHeaders, detailLines: keptLines };
}
