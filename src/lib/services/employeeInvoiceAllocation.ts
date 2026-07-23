import { calculateServiceLineTotal } from '@/lib/services/employeeServiceBreakdown';
import { roundMoney } from '@/lib/reportMonthUtils';

export interface InvoiceHeaderInput {
  invID: number;
  invType: string;
  subTotal: number | null;
  grandTotal: number | null;
  disVal?: number | null;
}

export interface DetailLineForAllocation {
  detailId: number;
  invID: number;
  invType: string;
  empId: number;
  empName: string;
  proId: number;
  qty?: number | null;
  unitPrice?: number | null;
  discountValue?: number | null;
  sValue?: number | null;
  lineTotal?: number | null;
}

export interface AllocatedDetailLine extends DetailLineForAllocation {
  grossServiceValue: number;
  allocatedInvoiceDiscount: number;
  actualInvoiceRevenue: number;
  invoiceGrandTotal: number;
  invoiceSubTotal: number;
  otherEmployeesOnInvoice: { empId: number; empName: string }[];
}

export interface EmployeeRevenueTotals {
  employeeId: number;
  employeeName: string;
  grossServiceRevenue: number;
  allocatedInvoiceDiscount: number;
  actualInvoiceRevenue: number;
  invoiceCount: number;
  serviceCount: number;
}

export interface ReportRevenueTotals {
  totalGrossServiceRevenue: number;
  totalAllocatedInvoiceDiscount: number;
  totalActualInvoiceRevenue: number;
  unattributedInvoiceRevenue: number;
  treasuryComparableRevenue: number;
}

export interface InvoiceAllocationResult {
  allocatedLines: AllocatedDetailLine[];
  employeeTotals: EmployeeRevenueTotals[];
  reportTotals: ReportRevenueTotals;
}

function safeMoney(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function invoiceKey(invType: string, invID: number): string {
  return `${invType}-${invID}`;
}

function isEligibleDetailLine(line: DetailLineForAllocation): boolean {
  return line.empId != null && line.proId != null;
}

function lineGrossAmount(line: DetailLineForAllocation): number {
  if (line.lineTotal != null) {
    return roundMoney(safeMoney(line.lineTotal));
  }
  return calculateServiceLineTotal(line);
}

/**
 * Distribute `targetTotal` across weights proportionally with deterministic
 * piaster remainder applied to the largest weight (ties → highest detailId).
 */
export function distributeProportionally(
  items: { detailId: number; weight: number }[],
  targetTotal: number
): Map<number, number> {
  const result = new Map<number, number>();
  if (items.length === 0) return result;

  const safeTarget = roundMoney(safeMoney(targetTotal));
  if (safeTarget <= 0) {
    for (const item of items) result.set(item.detailId, 0);
    return result;
  }

  const totalWeight = items.reduce((sum, item) => sum + safeMoney(item.weight), 0);
  if (totalWeight === 0) {
    for (const item of items) result.set(item.detailId, 0);
    return result;
  }

  const raw = items.map((item) => ({
    detailId: item.detailId,
    weight: safeMoney(item.weight),
    amount: (safeTarget * safeMoney(item.weight)) / totalWeight,
  }));

  const rounded = raw.map((row) => ({
    detailId: row.detailId,
    weight: row.weight,
    amount: roundMoney(row.amount),
  }));

  let remainder = roundMoney(
    safeTarget - rounded.reduce((sum, row) => sum + row.amount, 0)
  );

  if (remainder !== 0) {
    const remainderTarget = [...rounded].sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return b.detailId - a.detailId;
    })[0];
    if (remainderTarget) {
      const idx = rounded.findIndex((row) => row.detailId === remainderTarget.detailId);
      if (idx >= 0) {
        rounded[idx] = {
          ...rounded[idx],
          amount: roundMoney(rounded[idx].amount + remainder),
        };
        remainder = roundMoney(
          safeTarget - rounded.reduce((sum, row) => sum + row.amount, 0)
        );
      }
    }
  }

  for (const row of rounded) {
    result.set(row.detailId, row.amount);
  }
  return result;
}

/**
 * True when invoice has no header discount and GrandTotal matches Σ line nets
 * (new POS model: discounts live on detail rows only).
 *
 * `eligibleGrossTotal` is Σ (SValue − line DisVal) for eligible lines.
 */
export function isLineNetInvoice(
  header: InvoiceHeaderInput,
  eligibleGrossTotal: number,
): boolean {
  const grandTotal = roundMoney(Math.max(0, safeMoney(header.grandTotal)));
  const headerDisVal = roundMoney(Math.max(0, safeMoney(header.disVal)));
  if (headerDisVal > 0) return false;
  return Math.abs(grandTotal - eligibleGrossTotal) <= 0.01;
}

/**
 * Allocate invoice GrandTotal to eligible employee service lines.
 *
 * New invoices (header DisVal = 0, GrandTotal ≈ Σ line nets):
 *   actual = line net (gross after line DisVal) — no proportional header split.
 *
 * Legacy invoices (header DisVal > 0):
 *   actual = GrandTotal × grossLine / SubTotal
 *
 * Unattributed portion (products, tax, unassigned lines):
 *   GrandTotal − Σ actualEligible
 */
export function allocateEmployeeInvoiceRevenue(
  headers: InvoiceHeaderInput[],
  detailLines: DetailLineForAllocation[]
): InvoiceAllocationResult {
  const headerByKey = new Map<string, InvoiceHeaderInput>();
  for (const header of headers) {
    headerByKey.set(invoiceKey(header.invType, header.invID), header);
  }

  const linesByInvoice = new Map<string, DetailLineForAllocation[]>();
  for (const line of detailLines) {
    const key = invoiceKey(line.invType, line.invID);
    if (!linesByInvoice.has(key)) linesByInvoice.set(key, []);
    linesByInvoice.get(key)!.push(line);
  }

  const allocatedLines: AllocatedDetailLine[] = [];
  let totalGross = 0;
  let totalDiscount = 0;
  let totalActual = 0;
  let unattributed = 0;
  let treasuryComparable = 0;

  const employeeAcc = new Map<
    number,
    {
      employeeName: string;
      grossServiceRevenue: number;
      allocatedInvoiceDiscount: number;
      actualInvoiceRevenue: number;
      invoiceKeys: Set<string>;
      serviceCount: number;
    }
  >();

  const processedInvoiceKeys = new Set<string>();

  for (const header of headers) {
    const key = invoiceKey(header.invType, header.invID);
    if (processedInvoiceKeys.has(key)) continue;
    processedInvoiceKeys.add(key);

    const grandTotal = roundMoney(Math.max(0, safeMoney(header.grandTotal)));
    const subTotal = roundMoney(Math.max(0, safeMoney(header.subTotal)));
    treasuryComparable = roundMoney(treasuryComparable + grandTotal);

    const invoiceLines = linesByInvoice.get(key) ?? [];
    const eligibleLines = invoiceLines.filter(isEligibleDetailLine);

    const grossByLine = eligibleLines.map((line) => ({
      line,
      gross: lineGrossAmount(line),
    }));

    const otherEmployees = [
      ...new Map(
        eligibleLines.map((line) => [
          line.empId,
          { empId: line.empId, empName: line.empName ?? '' },
        ])
      ).values(),
    ];

    if (grandTotal <= 0 || subTotal <= 0 || grossByLine.length === 0) {
      unattributed = roundMoney(unattributed + grandTotal);
      for (const { line, gross } of grossByLine) {
        allocatedLines.push({
          ...line,
          grossServiceValue: gross,
          allocatedInvoiceDiscount: gross,
          actualInvoiceRevenue: 0,
          invoiceGrandTotal: grandTotal,
          invoiceSubTotal: subTotal,
          otherEmployeesOnInvoice: otherEmployees.filter((e) => e.empId !== line.empId),
        });
        totalGross = roundMoney(totalGross + gross);
        totalDiscount = roundMoney(totalDiscount + gross);
        accumulateEmployee(employeeAcc, line, gross, gross, 0, key);
      }
      continue;
    }

    const eligibleGrossTotal = roundMoney(grossByLine.reduce((s, r) => s + r.gross, 0));

    // New model: no header discount → each employee keeps their line nets as-is.
    if (isLineNetInvoice(header, eligibleGrossTotal)) {
      let invoiceActualSum = 0;
      for (const { line, gross } of grossByLine) {
        const actual = gross;
        const discount = 0;
        invoiceActualSum = roundMoney(invoiceActualSum + actual);

        allocatedLines.push({
          ...line,
          grossServiceValue: gross,
          allocatedInvoiceDiscount: discount,
          actualInvoiceRevenue: actual,
          invoiceGrandTotal: grandTotal,
          invoiceSubTotal: subTotal,
          otherEmployeesOnInvoice: otherEmployees.filter((e) => e.empId !== line.empId),
        });

        totalGross = roundMoney(totalGross + gross);
        totalDiscount = roundMoney(totalDiscount + discount);
        totalActual = roundMoney(totalActual + actual);
        accumulateEmployee(employeeAcc, line, gross, discount, actual, key);
      }

      const invoiceUnattributed = roundMoney(grandTotal - invoiceActualSum);
      unattributed = roundMoney(unattributed + invoiceUnattributed);
      continue;
    }

    const employeePool =
      subTotal > 0
        ? roundMoney((grandTotal * eligibleGrossTotal) / subTotal)
        : 0;
    const distribution = distributeProportionally(
      grossByLine.map(({ line, gross }) => ({ detailId: line.detailId, weight: gross })),
      employeePool
    );

    let invoiceActualSum = 0;
    for (const { line, gross } of grossByLine) {
      const actual = distribution.get(line.detailId) ?? 0;
      const discount = roundMoney(gross - actual);
      invoiceActualSum = roundMoney(invoiceActualSum + actual);

      allocatedLines.push({
        ...line,
        grossServiceValue: gross,
        allocatedInvoiceDiscount: discount,
        actualInvoiceRevenue: actual,
        invoiceGrandTotal: grandTotal,
        invoiceSubTotal: subTotal,
        otherEmployeesOnInvoice: otherEmployees.filter((e) => e.empId !== line.empId),
      });

      totalGross = roundMoney(totalGross + gross);
      totalDiscount = roundMoney(totalDiscount + discount);
      totalActual = roundMoney(totalActual + actual);
      accumulateEmployee(employeeAcc, line, gross, discount, actual, key);
    }

    const invoiceUnattributed = roundMoney(grandTotal - invoiceActualSum);
    unattributed = roundMoney(unattributed + invoiceUnattributed);
  }

  const employeeTotals: EmployeeRevenueTotals[] = [...employeeAcc.entries()]
    .map(([employeeId, acc]) => ({
      employeeId,
      employeeName: acc.employeeName,
      grossServiceRevenue: roundMoney(acc.grossServiceRevenue),
      allocatedInvoiceDiscount: roundMoney(acc.allocatedInvoiceDiscount),
      actualInvoiceRevenue: roundMoney(acc.actualInvoiceRevenue),
      invoiceCount: acc.invoiceKeys.size,
      serviceCount: acc.serviceCount,
    }))
    .sort((a, b) => b.grossServiceRevenue - a.grossServiceRevenue);

  return {
    allocatedLines,
    employeeTotals,
    reportTotals: {
      totalGrossServiceRevenue: roundMoney(totalGross),
      totalAllocatedInvoiceDiscount: roundMoney(totalDiscount),
      totalActualInvoiceRevenue: roundMoney(totalActual),
      unattributedInvoiceRevenue: roundMoney(unattributed),
      treasuryComparableRevenue: roundMoney(treasuryComparable),
    },
  };
}

function accumulateEmployee(
  employeeAcc: Map<
    number,
    {
      employeeName: string;
      grossServiceRevenue: number;
      allocatedInvoiceDiscount: number;
      actualInvoiceRevenue: number;
      invoiceKeys: Set<string>;
      serviceCount: number;
    }
  >,
  line: DetailLineForAllocation,
  gross: number,
  discount: number,
  actual: number,
  invoiceKeyValue: string
): void {
  if (!employeeAcc.has(line.empId)) {
    employeeAcc.set(line.empId, {
      employeeName: line.empName ?? '',
      grossServiceRevenue: 0,
      allocatedInvoiceDiscount: 0,
      actualInvoiceRevenue: 0,
      invoiceKeys: new Set(),
      serviceCount: 0,
    });
  }
  const acc = employeeAcc.get(line.empId)!;
  acc.employeeName = line.empName ?? acc.employeeName;
  acc.grossServiceRevenue = roundMoney(acc.grossServiceRevenue + gross);
  acc.allocatedInvoiceDiscount = roundMoney(acc.allocatedInvoiceDiscount + discount);
  acc.actualInvoiceRevenue = roundMoney(acc.actualInvoiceRevenue + actual);
  acc.invoiceKeys.add(invoiceKeyValue);
  acc.serviceCount += 1;
}
