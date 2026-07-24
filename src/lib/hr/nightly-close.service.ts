/**
 * Nightly close orchestration:
 * incomplete attendance → Default fill (D) → daily payroll + targets → WhatsApp employees + owner → verify.
 */

import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  countPostedDailyPayroll,
  validateDailyPayrollAttendance,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import {
  EmployeeLedgerDualWriteError,
  runDailyPayrollGenerateWithOptionalLedger,
} from '@/lib/services/employeeLedgerDualWrite';
import { generateEmployeeDailyTargets } from '@/lib/payroll/employee-target/employee-daily-target-generation.service';
import { finalizeIncompleteAttendanceWithDefaults } from '@/lib/hr/finalize-incomplete-attendance';
import { resolveNightlyCloseWorkDate } from '@/lib/hr/nightly-close-work-date';
import {
  buildEmployeeDailyWhatsAppPreview,
  sendEmployeeDailyWhatsAppReports,
  type EmployeeDailyWhatsAppSendResponse,
} from '@/lib/hr/employee-daily-whatsapp-report.service';
import { sendOwnerDailyWhatsApp } from '@/lib/hr/owner-daily-whatsapp-report.service';
import {
  checkWhatsAppStatus,
  isWhatsAppEnabled,
} from '@/lib/integrations/whatsapp';
import { listActiveBranches } from '@/lib/branch';

export interface NightlyCloseDeliveryCheck {
  ok: boolean;
  error?: string;
  employeesReady: number;
  employeesSent: number;
  employeesFailed: number;
  ownerSent: boolean;
  ownerPhone: string | null;
  whatsappReady: boolean;
}

export interface NightlyCloseResult {
  ok: boolean;
  workDate: string;
  dryRun: boolean;
  steps: {
    attendanceClose: Awaited<
      ReturnType<typeof finalizeIncompleteAttendanceWithDefaults>
    > | null;
    payroll:
      | {
          status: string;
          employeesCount: number;
          totalHours: number;
          totalWages: number;
          ledgerDualWrite?: unknown;
        }
      | null;
    targets: {
      generated: number;
      recalculated: number;
      totalTargetAmount: string;
      eligibleEmployees: number;
    } | null;
    employeesWhatsApp: EmployeeDailyWhatsAppSendResponse | null;
    ownerWhatsApp: {
      status: string;
      ownerName: string;
      phone: string | null;
      reason?: string;
      reasonAr?: string;
    } | null;
  };
  delivery: NightlyCloseDeliveryCheck;
  error?: string;
  errors: string[];
}

export function verifyNightlyWhatsAppDelivery(params: {
  whatsappReady: boolean;
  employeesReady: number;
  employeesSent: number;
  employeesFailed: number;
  ownerSent: boolean;
  ownerPhone: string | null;
}): NightlyCloseDeliveryCheck {
  const {
    whatsappReady,
    employeesReady,
    employeesSent,
    employeesFailed,
    ownerSent,
    ownerPhone,
  } = params;

  const base: NightlyCloseDeliveryCheck = {
    ok: false,
    employeesReady,
    employeesSent,
    employeesFailed,
    ownerSent,
    ownerPhone,
    whatsappReady,
  };

  if (!whatsappReady) {
    return { ...base, error: 'واتساب غير متصل — whatsappReady=false' };
  }
  if (employeesFailed > 0) {
    return {
      ...base,
      error: `فشل إرسال واتساب لـ ${employeesFailed} موظف`,
    };
  }
  if (employeesReady > 0 && employeesSent !== employeesReady) {
    return {
      ...base,
      error: `اتبعت ${employeesSent} من ${employeesReady} رسالة موظفين فقط`,
    };
  }
  if (!ownerPhone) {
    return { ...base, error: 'مفيش رقم واتساب للمدير' };
  }
  if (!ownerSent) {
    return { ...base, error: 'رسالة المدير متبعتش' };
  }

  return { ...base, ok: true };
}

async function logNightlyClose(
  workDate: string,
  success: boolean,
  payload: unknown,
): Promise<void> {
  try {
    const db = await getPool();
    await db
      .request()
      .input('WorkDate', sql.Date, workDate)
      .input('Success', sql.Bit, success ? 1 : 0)
      .input('EmployeesCount', sql.Int, 0)
      .input('TotalHours', sql.Decimal(10, 2), 0)
      .input('TotalWages', sql.Decimal(12, 2), 0)
      .input('MissingJson', sql.NVarChar(sql.MAX), JSON.stringify(payload).slice(0, 7800))
      .query(`
        IF OBJECT_ID('dbo.TblAutoGenLog', 'U') IS NOT NULL
        BEGIN
          INSERT INTO dbo.TblAutoGenLog
            (WorkDate, Success, EmployeesCount, TotalHours, TotalWages, MissingJson, CreatedAt)
          VALUES
            (@WorkDate, @Success, @EmployeesCount, @TotalHours, @TotalWages, @MissingJson, GETDATE())
        END
      `);
  } catch {
    /* non-fatal */
  }
}

export async function runNightlyClose(params?: {
  workDate?: string | null;
  dryRun?: boolean;
  skipWhatsApp?: boolean;
  now?: Date;
}): Promise<NightlyCloseResult> {
  const dryRun = Boolean(params?.dryRun);
  const skipWhatsApp = Boolean(params?.skipWhatsApp);
  const workDate = resolveNightlyCloseWorkDate(params?.workDate, params?.now ?? new Date());
  const errors: string[] = [];

  const result: NightlyCloseResult = {
    ok: false,
    workDate,
    dryRun,
    steps: {
      attendanceClose: null,
      payroll: null,
      targets: null,
      employeesWhatsApp: null,
      ownerWhatsApp: null,
    },
    delivery: {
      ok: false,
      employeesReady: 0,
      employeesSent: 0,
      employeesFailed: 0,
      ownerSent: false,
      ownerPhone: null,
      whatsappReady: false,
    },
    errors,
  };

  console.log(
    `[nightly-close] start workDate=${workDate} dryRun=${dryRun} skipWhatsApp=${skipWhatsApp}`,
  );

  // ── 1) Incomplete attendance → Default fill (D) per active branch ───────
  // Topology (Phase 1K): finalize independently per branch, then payroll/targets once.
  try {
    const activeBranches = await listActiveBranches();
    if (activeBranches.length === 0) {
      throw new Error('لا يوجد فرع نشط لإنهاء الحضور');
    }

    if (dryRun) {
      const db = await getPool();
      const { missing } = await validateDailyPayrollAttendance(db, workDate);
      const incomplete = missing.filter(
        (m) =>
          m.reason === 'no_attendance' ||
          m.reason === 'missing_checkin' ||
          m.reason === 'missing_checkout',
      );
      result.steps.attendanceClose = {
        workDate,
        statusCode: 'D',
        action: 'DefaultFill',
        status: 'DefaultFill',
        filled: [],
        closed: incomplete.map((m) => ({
          empId: m.empId,
          empName: m.empName,
          reason: m.reason,
          checkIn: '',
          checkOut: '',
          filledIn: false,
          filledOut: false,
          status: 'Preview',
        })),
        skippedNoDefault: [],
        remainingMissing: missing,
      };
    } else {
      const mergedFilled: Awaited<
        ReturnType<typeof finalizeIncompleteAttendanceWithDefaults>
      >['filled'] = [];
      const mergedSkipped: Awaited<
        ReturnType<typeof finalizeIncompleteAttendanceWithDefaults>
      >['skippedNoDefault'] = [];
      const branchErrors: string[] = [];

      for (const branch of activeBranches) {
        try {
          const branchResult = await finalizeIncompleteAttendanceWithDefaults(
            workDate,
            { branchId: branch.branchId },
          );
          mergedFilled.push(...branchResult.filled);
          mergedSkipped.push(...branchResult.skippedNoDefault);
          console.log(
            `[nightly-close] attendance branch=${branch.branchCode}(${branch.branchId}) filled=${branchResult.filled.length}`,
          );
        } catch (branchErr) {
          const msg =
            branchErr instanceof Error ? branchErr.message : String(branchErr);
          branchErrors.push(`${branch.branchCode}: ${msg}`);
          console.error(
            `[nightly-close] attendance finalize failed branch=${branch.branchCode}`,
            msg,
          );
        }
      }

      if (branchErrors.length === activeBranches.length) {
        throw new Error(
          `فشل إنهاء الحضور لكل الفروع: ${branchErrors.join(' | ')}`,
        );
      }
      for (const be of branchErrors) {
        errors.push(`attendance-branch: ${be}`);
      }

      const db = await getPool();
      const after = await validateDailyPayrollAttendance(db, workDate);
      result.steps.attendanceClose = {
        workDate,
        statusCode: 'D',
        action: 'DefaultFill',
        status: 'DefaultFill',
        filled: mergedFilled,
        closed: mergedFilled,
        skippedNoDefault: mergedSkipped,
        remainingMissing: after.missing,
      };
    }
    console.log(
      `[nightly-close] attendance default-filled=${result.steps.attendanceClose.filled?.length ?? result.steps.attendanceClose.closed.length}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`attendance: ${message}`);
    result.error = message;
    await logNightlyClose(workDate, false, result);
    return result;
  }

  // ── 2) Daily payroll generate per active branch (Phase 1L) ──────────────
  try {
    const db = await getPool();
    const payrollBranches = await listActiveBranches();
    let totalEmployees = 0;
    let totalHours = 0;
    let totalWages = 0;
    let anyGenerated = false;
    let anyPosted = false;
    let anyIncomplete = false;
    let ledgerDualWrite: unknown = undefined;

    for (const branch of payrollBranches) {
      const postedCount = await countPostedDailyPayroll(
        db,
        workDate,
        branch.branchId,
      );
      if (postedCount > 0) {
        anyPosted = true;
        console.log(
          `[nightly-close] payroll already_posted branch=${branch.branchCode}`,
        );
        continue;
      }

      const { missing } = await validateDailyPayrollAttendance(db, workDate, {
        branchId: branch.branchId,
      });
      if (missing.length > 0) {
        anyIncomplete = true;
        errors.push(
          `payroll blocked ${branch.branchCode}: ${missing.length} attendance/rate issues`,
        );
        console.error(
          `[nightly-close] payroll incomplete branch=${branch.branchCode} missing=${missing.length}`,
        );
        continue;
      }

      if (dryRun) {
        anyGenerated = true;
        continue;
      }

      try {
        const { result: gen, ledgerDualWrite: ld } =
          await runDailyPayrollGenerateWithOptionalLedger(workDate, {
            notesPrefix: `[NightlyClose][${branch.branchCode}] `,
            branchId: branch.branchId,
          });
        totalEmployees += gen.generatedCount;
        totalHours += Number(gen.totalHours) || 0;
        totalWages += Number(gen.totalWage) || 0;
        ledgerDualWrite = ld;
        anyGenerated = true;
        console.log(
          `[nightly-close] payroll branch=${branch.branchCode} generated=${gen.generatedCount}`,
        );
      } catch (branchPayErr) {
        const msg =
          branchPayErr instanceof Error
            ? branchPayErr.message
            : String(branchPayErr);
        errors.push(`payroll-branch ${branch.branchCode}: ${msg}`);
        console.error(
          `[nightly-close] payroll failed branch=${branch.branchCode}`,
          msg,
        );
      }
    }

    if (dryRun) {
      result.steps.payroll = {
        status: 'dry_run',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
      };
    } else if (anyGenerated) {
      result.steps.payroll = {
        status: 'generated',
        employeesCount: totalEmployees,
        totalHours,
        totalWages,
        ledgerDualWrite,
      };
    } else if (anyPosted && !anyIncomplete) {
      result.steps.payroll = {
        status: 'already_posted',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
      };
    } else if (anyIncomplete) {
      result.steps.payroll = {
        status: 'attendance_incomplete',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
      };
    } else {
      result.steps.payroll = {
        status: 'no_eligible_employees',
        employeesCount: 0,
        totalHours: 0,
        totalWages: 0,
      };
    }
    console.log(
      `[nightly-close] payroll status=${result.steps.payroll?.status}`,
    );
  } catch (err) {
    if (err instanceof EmployeeLedgerDualWriteError) {
      errors.push(`payroll ledger: ${err.message}`);
    } else {
      errors.push(`payroll: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 3) Daily targets per active branch (Phase 1L) ───────────────────────
  try {
    if (dryRun) {
      result.steps.targets = {
        generated: 0,
        recalculated: 0,
        totalTargetAmount: '0.00',
        eligibleEmployees: 0,
      };
    } else {
      const targetBranches = await listActiveBranches();
      let generated = 0;
      let recalculated = 0;
      let totalTargetAmount = 0;
      let eligibleEmployees = 0;

      for (const branch of targetBranches) {
        try {
          const targets = await generateEmployeeDailyTargets({
            workDate,
            generatedByUserId: null,
            branchId: branch.branchId,
          });
          generated += targets.totals.generated;
          recalculated += targets.totals.recalculated;
          totalTargetAmount += Number(targets.totals.totalTargetAmount) || 0;
          eligibleEmployees += targets.totals.eligibleEmployees;
          console.log(
            `[nightly-close] targets branch=${branch.branchCode} generated=${targets.totals.generated}`,
          );
        } catch (branchTargetErr) {
          const msg =
            branchTargetErr instanceof Error
              ? branchTargetErr.message
              : String(branchTargetErr);
          errors.push(`targets-branch ${branch.branchCode}: ${msg}`);
          console.error(
            `[nightly-close] targets failed branch=${branch.branchCode}`,
            msg,
          );
        }
      }

      result.steps.targets = {
        generated,
        recalculated,
        totalTargetAmount: totalTargetAmount.toFixed(2),
        eligibleEmployees,
      };
    }
    console.log(
      `[nightly-close] targets generated=${result.steps.targets?.generated}`,
    );
  } catch (err) {
    errors.push(`targets: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 4+5) WhatsApp employees + owner ─────────────────────────────────────
  let whatsappReady = false;
  let employeesReady = 0;
  let employeesSent = 0;
  let employeesFailed = 0;
  let ownerSent = false;
  let ownerPhone: string | null = null;

  if (skipWhatsApp) {
    result.delivery = {
      ok: true,
      employeesReady: 0,
      employeesSent: 0,
      employeesFailed: 0,
      ownerSent: true,
      ownerPhone: 'skipped',
      whatsappReady: true,
      error: undefined,
    };
  } else {
    try {
      if (!isWhatsAppEnabled() && !dryRun) {
        errors.push('WhatsApp integration disabled (development_only)');
      } else {
        const status = await checkWhatsAppStatus();
        whatsappReady =
          dryRun ||
          ('whatsappReady' in status && status.whatsappReady === true);

        const preview = await buildEmployeeDailyWhatsAppPreview({ workDate });
        employeesReady = preview.summary.readyToSend;

        const empSend = await sendEmployeeDailyWhatsAppReports({
          workDate,
          dryRun,
        });
        result.steps.employeesWhatsApp = empSend;
        employeesSent = empSend.summary.sent;
        employeesFailed = empSend.summary.failed;
        if (dryRun) {
          employeesSent = empSend.summary.dryRun;
        }

        const owner = await sendOwnerDailyWhatsApp({ workDate, dryRun });
        result.steps.ownerWhatsApp = {
          status: owner.status,
          ownerName: owner.ownerName,
          phone: owner.phone,
          reason: owner.reason,
          reasonAr: owner.reasonAr,
        };
        ownerPhone = owner.phone;
        ownerSent =
          owner.status === 'sent' || (dryRun && owner.status === 'dry_run');
      }
    } catch (err) {
      errors.push(`whatsapp: ${err instanceof Error ? err.message : String(err)}`);
    }

    result.delivery = verifyNightlyWhatsAppDelivery({
      whatsappReady,
      employeesReady: dryRun ? employeesReady : employeesReady,
      employeesSent: dryRun ? employeesSent : employeesSent,
      employeesFailed,
      ownerSent,
      ownerPhone,
    });

    if (!result.delivery.ok && result.delivery.error) {
      errors.push(result.delivery.error);
    }
  }

  const payrollOk =
    result.steps.payroll?.status === 'generated' ||
    result.steps.payroll?.status === 'already_posted' ||
    result.steps.payroll?.status === 'no_eligible_employees' ||
    result.steps.payroll?.status === 'dry_run';

  result.ok =
    errors.length === 0 &&
    payrollOk &&
    result.delivery.ok &&
    result.steps.attendanceClose != null;

  if (!result.ok && !result.error) {
    result.error = errors[0] ?? 'nightly close failed';
  }

  await logNightlyClose(workDate, result.ok, {
    dryRun,
    ok: result.ok,
    steps: {
      closed: result.steps.attendanceClose?.closed.length ?? 0,
      payroll: result.steps.payroll?.status,
      targets: result.steps.targets?.generated,
      empSent: result.delivery.employeesSent,
      ownerSent: result.delivery.ownerSent,
    },
    errors,
  });

  console.log(
    `[nightly-close] done ok=${result.ok} workDate=${workDate} errors=${errors.length}`,
  );

  return result;
}
