/**
 * Month-to-today daily payroll regeneration.
 * Reuses runNightlyClose only — no new payroll formulas, no day close, no WhatsApp.
 */

import 'server-only';

import { getCairoBusinessDate } from '@/lib/businessDate';
import { listActiveBranches } from '@/lib/branch';
import { runNightlyClose, type NightlyCloseResult } from '@/lib/hr/nightly-close.service';
import {
  listDatesInclusive,
  YMD_RE,
} from '@/lib/hr/dailyPayrollBulkCloseRange.validation';

export interface MonthRegenFailure {
  workDate: string;
  branchCode: string | null;
  empId: number | null;
  empName: string | null;
  reason: string;
}

export interface MonthRegenDaySummary {
  workDate: string;
  ok: boolean;
  attendanceFilled: number;
  attendanceSkippedNoDefault: number;
  payrollStatus: string | null;
  payrollEmployees: number;
  targetsGenerated: number;
  targetsRecalculated: number;
  targetsEligible: number;
  ledgerInserted: number;
  ledgerUpdated: number;
  ledgerSkipped: number;
  errors: string[];
}

export interface MonthRegenResult {
  ok: boolean;
  fromDate: string;
  toDate: string;
  activeBranches: Array<{ branchId: number; branchCode: string; branchName: string }>;
  summary: {
    datesProcessed: number;
    employeeDayPayrollTouches: number;
    attendanceRowsCompleted: number;
    attendanceSkippedNoDefault: number;
    payrollRowsCreatedOrUpdated: number;
    targetsCreated: number;
    targetsUpdated: number;
    targetEligibleTouches: number;
    ledgerEntriesCreated: number;
    ledgerEntriesUpdated: number;
    ledgerEntriesSkippedUnchanged: number;
    daysAlreadyPostedOrNoEligible: number;
    daysWithPartialErrors: number;
  };
  days: MonthRegenDaySummary[];
  failures: MonthRegenFailure[];
}

function monthStartFromYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function extractLedgerCounts(nightly: NightlyCloseResult): {
  inserted: number;
  updated: number;
  skipped: number;
} {
  const ld = nightly.steps.payroll?.ledgerDualWrite as
    | { inserted?: number; updated?: number; skipped?: number }
    | undefined;
  if (ld && typeof ld === 'object') {
    return {
      inserted: Number(ld.inserted) || 0,
      updated: Number(ld.updated) || 0,
      skipped: Number(ld.skipped) || 0,
    };
  }
  return { inserted: 0, updated: 0, skipped: 0 };
}

function collectFailures(
  workDate: string,
  nightly: NightlyCloseResult,
): MonthRegenFailure[] {
  const failures: MonthRegenFailure[] = [];

  for (const err of nightly.errors ?? []) {
    const branchMatch = err.match(
      /(?:payroll blocked|payroll-branch|targets-branch|attendance-branch:|ledger-heal)\s+([A-Z0-9_]+)/i,
    );
    failures.push({
      workDate,
      branchCode: branchMatch?.[1] ?? null,
      empId: null,
      empName: null,
      reason: err,
    });
  }

  const remaining = nightly.steps.attendanceClose?.remainingMissing ?? [];
  for (const m of remaining) {
    failures.push({
      workDate,
      branchCode: null,
      empId: Number(m.empId) || null,
      empName: String(m.empName ?? '') || null,
      reason: `attendance remaining: ${m.reason}`,
    });
  }

  for (const s of nightly.steps.attendanceClose?.skippedNoDefault ?? []) {
    failures.push({
      workDate,
      branchCode: null,
      empId: Number(s.empId) || null,
      empName: String(s.empName ?? '') || null,
      reason: `attendance skipped (no default schedule): ${s.reason ?? 'no_default'}`,
    });
  }

  return failures;
}

/** Process-level lock so two month-regens cannot overlap in one Node process. */
let monthRegenInFlight = false;

export function resolveMonthRegenDateRange(params?: {
  fromDate?: string | null;
  toDate?: string | null;
  todayCairo?: string;
}): { ok: true; fromDate: string; toDate: string; dates: string[] } | { ok: false; error: string } {
  const today = params?.todayCairo ?? getCairoBusinessDate();
  const fromDate = String(params?.fromDate ?? monthStartFromYmd(today)).trim();
  const toDate = String(params?.toDate ?? today).trim();

  if (!YMD_RE.test(fromDate) || !YMD_RE.test(toDate)) {
    return { ok: false, error: 'fromDate/toDate يجب أن يكونا YYYY-MM-DD' };
  }
  if (fromDate > toDate) {
    return { ok: false, error: 'fromDate يجب أن يكون قبل أو يساوي toDate' };
  }
  if (toDate > today) {
    return { ok: false, error: `لا يمكن إعادة توليد تاريخ مستقبلي — آخر يوم ${today}` };
  }

  const dates = listDatesInclusive(fromDate, toDate);
  return { ok: true, fromDate, toDate, dates };
}

/**
 * Regenerate attendance defaults + daily payroll + targets + ledger heal
 * for each day in range via existing runNightlyClose (skipWhatsApp).
 * Does NOT close work days.
 */
export async function runDailyPayrollMonthRegen(params?: {
  fromDate?: string | null;
  toDate?: string | null;
  dryRun?: boolean;
}): Promise<MonthRegenResult> {
  const resolved = resolveMonthRegenDateRange({
    fromDate: params?.fromDate,
    toDate: params?.toDate,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      fromDate: String(params?.fromDate ?? ''),
      toDate: String(params?.toDate ?? ''),
      activeBranches: [],
      summary: {
        datesProcessed: 0,
        employeeDayPayrollTouches: 0,
        attendanceRowsCompleted: 0,
        attendanceSkippedNoDefault: 0,
        payrollRowsCreatedOrUpdated: 0,
        targetsCreated: 0,
        targetsUpdated: 0,
        targetEligibleTouches: 0,
        ledgerEntriesCreated: 0,
        ledgerEntriesUpdated: 0,
        ledgerEntriesSkippedUnchanged: 0,
        daysAlreadyPostedOrNoEligible: 0,
        daysWithPartialErrors: 0,
      },
      days: [],
      failures: [
        {
          workDate: '',
          branchCode: null,
          empId: null,
          empName: null,
          reason: resolved.error,
        },
      ],
    };
  }

  if (monthRegenInFlight) {
    return {
      ok: false,
      fromDate: resolved.fromDate,
      toDate: resolved.toDate,
      activeBranches: [],
      summary: {
        datesProcessed: 0,
        employeeDayPayrollTouches: 0,
        attendanceRowsCompleted: 0,
        attendanceSkippedNoDefault: 0,
        payrollRowsCreatedOrUpdated: 0,
        targetsCreated: 0,
        targetsUpdated: 0,
        targetEligibleTouches: 0,
        ledgerEntriesCreated: 0,
        ledgerEntriesUpdated: 0,
        ledgerEntriesSkippedUnchanged: 0,
        daysAlreadyPostedOrNoEligible: 0,
        daysWithPartialErrors: 0,
      },
      days: [],
      failures: [
        {
          workDate: '',
          branchCode: null,
          empId: null,
          empName: null,
          reason: 'إعادة توليد الشهر قيد التنفيذ بالفعل',
        },
      ],
    };
  }

  monthRegenInFlight = true;
  const dryRun = Boolean(params?.dryRun);

  try {
    const activeBranches = await listActiveBranches();
    const days: MonthRegenDaySummary[] = [];
    const failures: MonthRegenFailure[] = [];

    let attendanceRowsCompleted = 0;
    let attendanceSkippedNoDefault = 0;
    let payrollRowsCreatedOrUpdated = 0;
    let employeeDayPayrollTouches = 0;
    let targetsCreated = 0;
    let targetsUpdated = 0;
    let targetEligibleTouches = 0;
    let ledgerEntriesCreated = 0;
    let ledgerEntriesUpdated = 0;
    let ledgerEntriesSkippedUnchanged = 0;
    let daysAlreadyPostedOrNoEligible = 0;
    let daysWithPartialErrors = 0;

    for (const workDate of resolved.dates) {
      console.log(`[month-regen] day start ${workDate}`);
      let nightly: NightlyCloseResult;
      try {
        nightly = await runNightlyClose({
          workDate,
          dryRun,
          skipWhatsApp: true,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        days.push({
          workDate,
          ok: false,
          attendanceFilled: 0,
          attendanceSkippedNoDefault: 0,
          payrollStatus: null,
          payrollEmployees: 0,
          targetsGenerated: 0,
          targetsRecalculated: 0,
          targetsEligible: 0,
          ledgerInserted: 0,
          ledgerUpdated: 0,
          ledgerSkipped: 0,
          errors: [reason],
        });
        failures.push({
          workDate,
          branchCode: null,
          empId: null,
          empName: null,
          reason,
        });
        daysWithPartialErrors += 1;
        continue;
      }

      const filled = nightly.steps.attendanceClose?.filled?.length ?? 0;
      const skipped = nightly.steps.attendanceClose?.skippedNoDefault?.length ?? 0;
      const payrollEmployees = nightly.steps.payroll?.employeesCount ?? 0;
      const payrollStatus = nightly.steps.payroll?.status ?? null;
      const targetsGenerated = nightly.steps.targets?.generated ?? 0;
      const targetsRecalculated = nightly.steps.targets?.recalculated ?? 0;
      const targetsEligible = nightly.steps.targets?.eligibleEmployees ?? 0;
      const ledger = extractLedgerCounts(nightly);

      attendanceRowsCompleted += filled;
      attendanceSkippedNoDefault += skipped;
      payrollRowsCreatedOrUpdated += payrollEmployees;
      employeeDayPayrollTouches += payrollEmployees;
      targetsCreated += targetsGenerated;
      targetsUpdated += targetsRecalculated;
      targetEligibleTouches += targetsEligible;
      ledgerEntriesCreated += ledger.inserted;
      ledgerEntriesUpdated += ledger.updated;
      ledgerEntriesSkippedUnchanged += ledger.skipped;

      if (
        payrollStatus === 'already_posted' ||
        payrollStatus === 'no_eligible_employees'
      ) {
        daysAlreadyPostedOrNoEligible += 1;
      }

      const dayErrors = nightly.errors ?? [];
      if (dayErrors.length > 0 || nightly.ok === false) {
        daysWithPartialErrors += 1;
      }

      days.push({
        workDate,
        ok: nightly.ok !== false && dayErrors.length === 0,
        attendanceFilled: filled,
        attendanceSkippedNoDefault: skipped,
        payrollStatus,
        payrollEmployees,
        targetsGenerated,
        targetsRecalculated,
        targetsEligible,
        ledgerInserted: ledger.inserted,
        ledgerUpdated: ledger.updated,
        ledgerSkipped: ledger.skipped,
        errors: dayErrors,
      });

      failures.push(...collectFailures(workDate, nightly));
      console.log(
        `[month-regen] day done ${workDate} payroll=${payrollStatus} filled=${filled} targets=${targetsGenerated}+${targetsRecalculated}`,
      );
    }

    const hardFail =
      days.length === 0 ||
      (days.every((d) => !d.ok) && failures.length > 0 && payrollRowsCreatedOrUpdated === 0);

    return {
      ok: !hardFail && daysWithPartialErrors === 0,
      fromDate: resolved.fromDate,
      toDate: resolved.toDate,
      activeBranches: activeBranches.map((b) => ({
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
      })),
      summary: {
        datesProcessed: days.length,
        employeeDayPayrollTouches,
        attendanceRowsCompleted,
        attendanceSkippedNoDefault,
        payrollRowsCreatedOrUpdated,
        targetsCreated,
        targetsUpdated,
        targetEligibleTouches,
        ledgerEntriesCreated,
        ledgerEntriesUpdated,
        ledgerEntriesSkippedUnchanged,
        daysAlreadyPostedOrNoEligible,
        daysWithPartialErrors,
      },
      days,
      failures,
    };
  } finally {
    monthRegenInFlight = false;
  }
}

/** Test-only. */
export function __resetMonthRegenLockForTests(): void {
  monthRegenInFlight = false;
}
