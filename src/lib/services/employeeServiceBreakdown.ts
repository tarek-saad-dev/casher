import { classifyService, type ServiceCategory } from '@/lib/services/classifyService';
import { roundMoney } from '@/lib/reportMonthUtils';

export interface ServiceLineInput {
  empId: number;
  empName: string;
  proId: number;
  serviceName: string;
  serviceNameAr?: string | null;
  qty?: number | null;
  unitPrice?: number | null;
  discountValue?: number | null;
  sValue?: number | null;
  lineTotal?: number | null;
}

export interface EmployeeServiceBreakdown {
  employeeId: number;
  employeeName: string;
  hairRevenue: number;
  hairBeardRevenue: number;
  beardRevenue: number;
  barberRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  hairCount: number;
  hairBeardCount: number;
  beardCount: number;
  otherCount: number;
}

export interface ClassifiedServiceLine extends ServiceLineInput {
  serviceCategory: ServiceCategory;
  lineTotal: number;
}

/** Decimal-safe line total — matches employee-services report SQL */
export function calculateServiceLineTotal(line: {
  qty?: number | null;
  unitPrice?: number | null;
  discountValue?: number | null;
  sValue?: number | null;
}): number {
  const qty = Number(line.qty ?? 1);
  const unitPrice = Number(line.unitPrice ?? 0);
  const discountValue = Number(line.discountValue ?? 0);
  const sValue = Number(line.sValue ?? 0);

  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
  const safeDiscount = Number.isFinite(discountValue) ? discountValue : 0;
  const safeSValue = Number.isFinite(sValue) ? sValue : 0;

  const raw =
    safeSValue > 0
      ? safeSValue - safeDiscount
      : safeQty * safeUnitPrice - safeDiscount;

  return roundMoney(Number.isFinite(raw) ? raw : 0);
}

function emptyBreakdown(empId: number, empName: string): EmployeeServiceBreakdown {
  return {
    employeeId: empId,
    employeeName: empName,
    hairRevenue: 0,
    hairBeardRevenue: 0,
    beardRevenue: 0,
    barberRevenue: 0,
    otherRevenue: 0,
    totalRevenue: 0,
    hairCount: 0,
    hairBeardCount: 0,
    beardCount: 0,
    otherCount: 0,
  };
}

function syncBarberTotals(entry: EmployeeServiceBreakdown): void {
  entry.barberRevenue = roundMoney(
    entry.hairRevenue + entry.hairBeardRevenue + entry.beardRevenue
  );
  entry.totalRevenue = roundMoney(entry.barberRevenue + entry.otherRevenue);
}

/** Safe barber total — handles legacy API rows missing barberRevenue */
export function resolveBarberRevenue(
  row: Pick<
    EmployeeServiceBreakdown,
    'barberRevenue' | 'hairRevenue' | 'hairBeardRevenue' | 'beardRevenue'
  >
): number {
  const direct = Number(row.barberRevenue);
  if (Number.isFinite(direct)) return roundMoney(direct);

  return roundMoney(
    Number(row.hairRevenue ?? 0) +
      Number(row.hairBeardRevenue ?? 0) +
      Number(row.beardRevenue ?? 0)
  );
}

export function normalizeEmployeeServiceBreakdown(
  row: EmployeeServiceBreakdown
): EmployeeServiceBreakdown {
  const barberRevenue = resolveBarberRevenue(row);
  const otherRevenue = roundMoney(Number(row.otherRevenue ?? 0) || 0);

  return {
    ...row,
    hairRevenue: roundMoney(Number(row.hairRevenue ?? 0) || 0),
    hairBeardRevenue: roundMoney(Number(row.hairBeardRevenue ?? 0) || 0),
    beardRevenue: roundMoney(Number(row.beardRevenue ?? 0) || 0),
    barberRevenue,
    otherRevenue,
    totalRevenue: roundMoney(barberRevenue + otherRevenue),
  };
}

export function classifyServiceLines(lines: ServiceLineInput[]): ClassifiedServiceLine[] {
  return lines.map((line) => {
    const lineTotal =
      line.lineTotal != null
        ? roundMoney(Number(line.lineTotal) || 0)
        : calculateServiceLineTotal(line);

    return {
      ...line,
      lineTotal,
      serviceCategory: classifyService({
        proId: line.proId,
        serviceName: line.serviceName,
        serviceNameAr: line.serviceNameAr,
      }),
    };
  });
}

export function aggregateEmployeeServiceBreakdown(
  lines: ServiceLineInput[]
): EmployeeServiceBreakdown[] {
  const classified = classifyServiceLines(lines);
  const byEmployee = new Map<number, EmployeeServiceBreakdown>();

  for (const line of classified) {
    if (!byEmployee.has(line.empId)) {
      byEmployee.set(line.empId, emptyBreakdown(line.empId, line.empName ?? ''));
    }

    const entry = byEmployee.get(line.empId)!;
    const amount = line.lineTotal;

    switch (line.serviceCategory) {
      case 'hair':
        entry.hairRevenue = roundMoney(entry.hairRevenue + amount);
        entry.hairCount += 1;
        break;
      case 'hair_beard':
        entry.hairBeardRevenue = roundMoney(entry.hairBeardRevenue + amount);
        entry.hairBeardCount += 1;
        break;
      case 'beard':
        entry.beardRevenue = roundMoney(entry.beardRevenue + amount);
        entry.beardCount += 1;
        break;
      default:
        entry.otherRevenue = roundMoney(entry.otherRevenue + amount);
        entry.otherCount += 1;
        break;
    }

    syncBarberTotals(entry);
  }

  return [...byEmployee.values()]
    .map(normalizeEmployeeServiceBreakdown)
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export function sumEmployeeServiceBreakdown(
  rows: EmployeeServiceBreakdown[]
): Pick<EmployeeServiceBreakdown, 'barberRevenue' | 'otherRevenue' | 'totalRevenue'> {
  const totals = rows.reduce(
    (acc, row) => ({
      barberRevenue: acc.barberRevenue + resolveBarberRevenue(row),
      otherRevenue: acc.otherRevenue + Number(row.otherRevenue ?? 0),
      totalRevenue: acc.totalRevenue + Number(row.totalRevenue ?? 0),
    }),
    { barberRevenue: 0, otherRevenue: 0, totalRevenue: 0 }
  );

  return {
    barberRevenue: roundMoney(totals.barberRevenue),
    otherRevenue: roundMoney(totals.otherRevenue),
    totalRevenue: roundMoney(totals.totalRevenue),
  };
}
