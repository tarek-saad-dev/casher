import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getEmployeeMonthlyPayrollReport } from '@/lib/reports/employee-monthly-payroll';
import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';
import {
  getEmployeeLedgerEntries,
  getEmployeeLedgerSummary,
} from '@/lib/services/employeeLedgerService';
import { getArabicDayName } from '@/lib/reports/reportFormatters';
import {
  resolveEmployeeWhatsAppPhone,
  type EmployeeDailyReportPayloadInput,
} from '@/lib/integrations/whatsapp/payload-builders';
import {
  sendEmployeeDailyReportWhatsAppMessage,
  type WhatsAppSendResult,
} from '@/lib/integrations/whatsapp';
import {
  composeEmployeeDailyWhatsAppMessage,
  shouldSkipEmptyDayOff,
} from '@/lib/hr/employee-daily-whatsapp-message';
import { dailyWaReasonAr } from '@/lib/hr/employee-daily-whatsapp-reasons';
import { isWhatsAppEnabled } from '@/lib/integrations/whatsapp';
import { getEmployeesNetServiceSalesByDate, getEmployeesServiceCountsByDate } from '@/lib/payroll/employee-target/employee-target-sales-service';
import { loadBreaksByEmpIdsOnWorkDate } from '@/lib/hr/attendance-breaks-db';
import type { AttendanceBreakInterval } from '@/lib/hr/attendance-breaks';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NEUTRAL_SALON_BRAND = 'Cut Salon';

/** Branch label for employee daily WA from persisted attendance (Phase 1K). */
export function resolveEmployeeAttendanceBranchLabel(
  branchNames: string[],
): string {
  const unique = [...new Set(branchNames.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 1) return unique[0]!;
  if (unique.length > 1) return 'عدة فروع';
  return NEUTRAL_SALON_BRAND;
}

async function loadAttendanceBranchNamesByEmp(
  db: { request: () => sql.Request },
  workDate: string,
  empIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (empIds.length === 0) return map;
  const req = db.request().input('workDate', sql.Date, workDate);
  const placeholders = empIds.map((id, i) => {
    const name = `e${i}`;
    req.input(name, sql.Int, id);
    return `@${name}`;
  });
  const result = await req.query(`
    SELECT a.EmpID, b.BranchName
    FROM dbo.TblEmpAttendance a
    INNER JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.WorkDate = @workDate
      AND a.EmpID IN (${placeholders.join(',')})
    ORDER BY a.EmpID, b.BranchName
  `);
  for (const row of result.recordset as Array<{ EmpID: number; BranchName: string }>) {
    const empId = Number(row.EmpID);
    const list = map.get(empId) ?? [];
    list.push(String(row.BranchName));
    map.set(empId, list);
  }
  return map;
}

export type DailyWhatsAppSkipReason =
  | 'no_phone'
  | 'inactive'
  | 'day_off_empty'
  | 'future'
  | 'not_found'
  | null;

export interface EmployeeDailyWhatsAppRow {
  empId: number;
  empName: string;
  phone: string | null;
  skipReason: DailyWhatsAppSkipReason;
  day: EmployeeMonthlyPayrollDayRow | null;
  ledgerBalance: number;
  message: string | null;
  payload: EmployeeDailyReportPayloadInput | null;
}

export interface EmployeeDailyWhatsAppPreview {
  workDate: string;
  payrollMonth: string;
  branchName: string;
  employees: EmployeeDailyWhatsAppRow[];
  summary: {
    total: number;
    readyToSend: number;
    skippedNoPhone: number;
    skippedOther: number;
  };
}

export interface EmployeeDailyWhatsAppSendResultRow {
  empId: number;
  empName: string;
  phone: string | null;
  status: 'sent' | 'skipped' | 'failed' | 'dry_run';
  reason?: string;
  reasonAr?: string;
  sentAt?: string;
}

export interface EmployeeDailyWhatsAppSendResponse {
  ok: boolean;
  workDate: string;
  dryRun: boolean;
  error?: string;
  results: EmployeeDailyWhatsAppSendResultRow[];
  summary: {
    sent: number;
    skipped: number;
    failed: number;
    dryRun: number;
  };
}

interface ActiveEmployeePhoneRow {
  EmpID: number;
  EmpName: string;
  WhatsApp: string | null;
  Mobile: string | null;
  isActive: boolean;
}

function parseWorkDate(workDate: string): { year: number; month: number; ok: true } | { ok: false; error: string } {
  if (!DATE_RE.test(workDate)) {
    return { ok: false, error: 'workDate يجب أن يكون بصيغة YYYY-MM-DD' };
  }
  const year = parseInt(workDate.slice(0, 4), 10);
  const month = parseInt(workDate.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: 'workDate غير صالح' };
  }
  return { ok: true, year, month };
}

function payrollMonthFromWorkDate(workDate: string): string {
  return workDate.slice(0, 7);
}

async function loadActiveEmployeesWithPhone(
  employeeIds?: number[] | null,
): Promise<ActiveEmployeePhoneRow[]> {
  const db = await getPool();
  const request = db.request();
  const filters = ['ISNULL(e.isActive, 1) = 1'];

  if (employeeIds != null && employeeIds.length > 0) {
    const placeholders = employeeIds.map((id, i) => {
      const name = `emp${i}`;
      request.input(name, sql.Int, id);
      return `@${name}`;
    });
    filters.push(`e.EmpID IN (${placeholders.join(',')})`);
  }

  const result = await request.query(`
    SELECT
      e.EmpID,
      e.EmpName,
      e.WhatsApp,
      e.Mobile,
      CASE WHEN ISNULL(e.isActive, 1) = 1 THEN 1 ELSE 0 END AS IsActiveFlag
    FROM dbo.TblEmp e
    WHERE ${filters.join(' AND ')}
    ORDER BY e.EmpName
  `);

  return (result.recordset as Record<string, unknown>[]).map((row) => ({
    EmpID: Number(row.EmpID),
    EmpName: String(row.EmpName ?? ''),
    WhatsApp: row.WhatsApp != null ? String(row.WhatsApp) : null,
    Mobile: row.Mobile != null ? String(row.Mobile) : null,
    isActive: Boolean(row.IsActiveFlag),
  }));
}

function buildPayloadForRow(params: {
  empName: string;
  phone: string;
  workDate: string;
  payrollMonth: string;
  branchName: string;
  day: EmployeeMonthlyPayrollDayRow | null;
  ledgerBalance: number;
  message: string;
}): EmployeeDailyReportPayloadInput {
  const { day } = params;
  return {
    phone: params.phone,
    employeeName: params.empName,
    message: params.message,
    workDate: params.workDate,
    ledgerBalance: params.ledgerBalance,
    branchName: params.branchName,
    payrollMonth: params.payrollMonth,
    checkIn: day?.checkIn ?? null,
    checkOut: day?.checkOut ?? null,
    actualHours: day?.actualHours ?? null,
    scheduledHours: day?.scheduledHours ?? null,
    statusLabelAr: day?.statusLabelAr ?? null,
    lateMinutes: day?.lateMinutes ?? null,
    baseWage: day?.baseWage ?? null,
    fullDayBase: day?.fullDayBase ?? null,
    isPartialDay: day?.isPartialDay ?? false,
    baseWageNoteAr: day?.baseWageNoteAr ?? null,
    targetSales: day?.targetSales ?? null,
    targetAmount: day?.targetAmount ?? null,
    deductions: day?.deductions ?? null,
    advances: day?.advances ?? null,
    dayNet: day?.dayNet ?? null,
  };
}

export async function buildEmployeeDailyWhatsAppPreview(params: {
  workDate: string;
  employeeIds?: number[] | null;
}): Promise<EmployeeDailyWhatsAppPreview> {
  const parsed = parseWorkDate(params.workDate);
  if (!parsed.ok) throw new Error(parsed.error);

  const { workDate } = params;
  const { year, month } = parsed;
  const payrollMonth = payrollMonthFromWorkDate(workDate);
  const dayNameAr = getArabicDayName(workDate);

  const employees = await loadActiveEmployeesWithPhone(params.employeeIds);
  const ledgerSummary = await getEmployeeLedgerSummary(payrollMonth);
  const balanceByEmp = new Map(
    ledgerSummary.employees.map((e) => [e.empId, e.balance]),
  );

  const empIdList = employees.map((e) => e.EmpID);
  const db = await getPool();
  const { listActiveBranches } = await import('@/lib/branch');
  const activeBranches = await listActiveBranches();
  const [serviceCountRows, breaksByEmp, attendanceBranchesByEmp, ...branchSalesLists] =
    employees.length > 0
      ? await Promise.all([
          getEmployeesServiceCountsByDate(workDate, empIdList),
          loadBreaksByEmpIdsOnWorkDate(db, workDate, empIdList),
          loadAttendanceBranchNamesByEmp(db, workDate, empIdList),
          ...activeBranches.map((b) =>
            getEmployeesNetServiceSalesByDate(workDate, b.branchId, empIdList),
          ),
        ])
      : [
          [],
          new Map<number, AttendanceBreakInterval[]>(),
          new Map<number, string[]>(),
        ];

  // Merge per-branch sales into employee totals (global display only — not a write path).
  const salesMerged = new Map<
    number,
    { empId: number; invoiceCount: number; netSalesAfterDiscount: number }
  >();
  for (const list of branchSalesLists) {
    if (!Array.isArray(list)) continue;
    for (const row of list as Array<{
      empId: number;
      invoiceCount: number;
      netSalesAfterDiscount: number;
    }>) {
      const prev = salesMerged.get(row.empId);
      if (!prev) {
        salesMerged.set(row.empId, {
          empId: row.empId,
          invoiceCount: row.invoiceCount,
          netSalesAfterDiscount: row.netSalesAfterDiscount,
        });
      } else {
        prev.invoiceCount += row.invoiceCount;
        prev.netSalesAfterDiscount += row.netSalesAfterDiscount;
      }
    }
  }
  const salesRows = [...salesMerged.values()];
  const invoiceCountByEmp = new Map(
    salesRows.map((r) => [r.empId, r.invoiceCount] as const),
  );
  const serviceCountsByEmp = new Map(
    serviceCountRows.map((r) => [r.empId, r] as const),
  );

  // Preview-level label when no per-employee attendance: neutral brand (not false GLEEM).
  const branchName = NEUTRAL_SALON_BRAND;
  const rows: EmployeeDailyWhatsAppRow[] = [];

  for (const emp of employees) {
    const invoiceCount = invoiceCountByEmp.get(emp.EmpID) ?? 0;
    const serviceCounts = serviceCountsByEmp.get(emp.EmpID);
    const serviceCount = serviceCounts?.totalCount ?? 0;
    const basicServiceCount = serviceCounts?.basicCount ?? 0;
    const otherServiceCount = serviceCounts?.otherCount ?? 0;
    const breakIntervals = breaksByEmp.get(emp.EmpID) ?? [];
    const empBranchName = resolveEmployeeAttendanceBranchLabel(
      attendanceBranchesByEmp.get(emp.EmpID) ?? [],
    );
    const phone = resolveEmployeeWhatsAppPhone(emp.WhatsApp, emp.Mobile);
    const ledgerBalance = balanceByEmp.get(emp.EmpID) ?? 0;

    if (!emp.isActive) {
      rows.push({
        empId: emp.EmpID,
        empName: emp.EmpName,
        phone,
        skipReason: 'inactive',
        day: null,
        ledgerBalance,
        message: null,
        payload: null,
      });
      continue;
    }

    const report = await getEmployeeMonthlyPayrollReport({
      employeeId: emp.EmpID,
      year,
      month,
    });

    if (!report) {
      rows.push({
        empId: emp.EmpID,
        empName: emp.EmpName,
        phone,
        skipReason: 'not_found',
        day: null,
        ledgerBalance,
        message: null,
        payload: null,
      });
      continue;
    }

    // Prefer live ledger balance for this emp when summary missing
    let balance = ledgerBalance;
    if (!balanceByEmp.has(emp.EmpID)) {
      const ledger = await getEmployeeLedgerEntries({
        empId: emp.EmpID,
        month: payrollMonth,
      });
      balance = ledger.balance;
    }

    const day = report.days.find((d) => d.date === workDate) ?? null;

    if (day?.isFutureDate) {
      rows.push({
        empId: emp.EmpID,
        empName: emp.EmpName,
        phone,
        skipReason: 'future',
        day,
        ledgerBalance: balance,
        message: null,
        payload: null,
      });
      continue;
    }

    // Batch-only: skip quiet day-off rows. Explicit employeeId always gets a message.
    const scopedToSpecificEmployees =
      params.employeeIds != null && params.employeeIds.length > 0;
    if (!scopedToSpecificEmployees && shouldSkipEmptyDayOff(day)) {
      rows.push({
        empId: emp.EmpID,
        empName: emp.EmpName,
        phone,
        skipReason: 'day_off_empty',
        day,
        ledgerBalance: balance,
        message: null,
        payload: null,
      });
      continue;
    }

    if (!phone) {
      const message = composeEmployeeDailyWhatsAppMessage({
        employeeName: emp.EmpName,
        branchName: empBranchName,
        workDate,
        dayNameAr,
        day,
        ledgerBalance: balance,
        invoiceCount,
        serviceCount,
        basicServiceCount,
        otherServiceCount,
        breakIntervals,
      });
      rows.push({
        empId: emp.EmpID,
        empName: emp.EmpName,
        phone: null,
        skipReason: 'no_phone',
        day,
        ledgerBalance: balance,
        message,
        payload: null,
      });
      continue;
    }

    const message = composeEmployeeDailyWhatsAppMessage({
      employeeName: emp.EmpName,
      branchName: empBranchName,
      workDate,
      dayNameAr,
      day,
      ledgerBalance: balance,
      invoiceCount,
      serviceCount,
      basicServiceCount,
      otherServiceCount,
      breakIntervals,
    });

    const payload = buildPayloadForRow({
      empName: emp.EmpName,
      phone,
      workDate,
      payrollMonth,
      branchName: empBranchName,
      day,
      ledgerBalance: balance,
      message,
    });

    rows.push({
      empId: emp.EmpID,
      empName: emp.EmpName,
      phone,
      skipReason: null,
      day,
      ledgerBalance: balance,
      message,
      payload,
    });
  }

  const readyToSend = rows.filter((r) => r.skipReason == null && r.payload).length;
  const skippedNoPhone = rows.filter((r) => r.skipReason === 'no_phone').length;
  const skippedOther = rows.filter(
    (r) => r.skipReason != null && r.skipReason !== 'no_phone',
  ).length;

  return {
    workDate,
    payrollMonth,
    branchName,
    employees: rows,
    summary: {
      total: rows.length,
      readyToSend,
      skippedNoPhone,
      skippedOther,
    },
  };
}

function resultStatusLabel(result: WhatsAppSendResult): {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  sentAt?: string;
} {
  if (result.sent) {
    return { status: 'sent', sentAt: result.sentAt };
  }
  if (result.skipped) {
    return { status: 'skipped', reason: result.reason };
  }
  return {
    status: 'failed',
    reason: ('error' in result && result.error) || result.reason,
  };
}

export async function sendEmployeeDailyWhatsAppReports(params: {
  workDate: string;
  employeeIds?: number[] | null;
  dryRun?: boolean;
}): Promise<EmployeeDailyWhatsAppSendResponse> {
  const dryRun = Boolean(params.dryRun);

  if (!dryRun && !isWhatsAppEnabled()) {
    return {
      ok: false,
      workDate: params.workDate,
      dryRun,
      error: dailyWaReasonAr('development_only'),
      results: [],
      summary: { sent: 0, skipped: 0, failed: 0, dryRun: 0 },
    };
  }

  const preview = await buildEmployeeDailyWhatsAppPreview({
    workDate: params.workDate,
    employeeIds: params.employeeIds,
  });

  console.log(
    `[employee-daily-whatsapp] send workDate=${preview.workDate} employees=${preview.employees.length} ready=${preview.summary.readyToSend} dryRun=${dryRun}`,
  );

  const results: EmployeeDailyWhatsAppSendResultRow[] = [];

  for (const row of preview.employees) {
    if (row.skipReason || !row.payload) {
      const reason = row.skipReason ?? 'no_payload';
      console.log(
        `[employee-daily-whatsapp] skip emp=${row.empId} ${row.empName}: ${reason}`,
      );
      results.push({
        empId: row.empId,
        empName: row.empName,
        phone: row.phone,
        status: 'skipped',
        reason,
        reasonAr: dailyWaReasonAr(reason),
      });
      continue;
    }

    if (dryRun) {
      results.push({
        empId: row.empId,
        empName: row.empName,
        phone: row.phone,
        status: 'dry_run',
        reason: 'dry_run',
        reasonAr: dailyWaReasonAr('dry_run'),
      });
      continue;
    }

    console.log(
      `[employee-daily-whatsapp] sending emp=${row.empId} ${row.empName} phone=${row.phone}`,
    );
    const sendResult = await sendEmployeeDailyReportWhatsAppMessage(row.payload);
    const mapped = resultStatusLabel(sendResult);
    console.log(
      `[employee-daily-whatsapp] result emp=${row.empId} status=${mapped.status} reason=${mapped.reason ?? '-'}`,
    );
    results.push({
      empId: row.empId,
      empName: row.empName,
      phone: row.phone,
      status: mapped.status,
      reason: mapped.reason,
      reasonAr: mapped.reason ? dailyWaReasonAr(mapped.reason) : undefined,
      sentAt: mapped.sentAt,
    });
  }

  const summary = {
    sent: results.filter((r) => r.status === 'sent').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    dryRun: results.filter((r) => r.status === 'dry_run').length,
  };

  const ok =
    summary.failed === 0 &&
    (summary.sent > 0 || summary.dryRun > 0);

  let error: string | undefined;
  if (!ok) {
    const first = results.find((r) => r.status === 'failed' || r.status === 'skipped');
    if (summary.sent === 0 && summary.failed === 0 && summary.dryRun === 0) {
      error =
        first?.reasonAr ||
        'مفيش رسائل اتبعتت — غالبًا مفيش رقم واتساب أو اليوم اتخطى';
    } else if (summary.failed > 0) {
      error = first?.reasonAr || 'فشل إرسال بعض الرسائل';
    }
  }

  return {
    ok,
    workDate: preview.workDate,
    dryRun,
    error,
    results,
    summary,
  };
}
