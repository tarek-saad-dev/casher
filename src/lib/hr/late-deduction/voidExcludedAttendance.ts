import 'server-only';

import { getPool, sql } from '@/lib/db';
import { withLateDeductionCaseLock } from './caseTransaction';
import { voidLateDeductionLedgerEntry } from './ledger';
import {
  findLateDeductionCase,
  upsertLateDeductionCase,
} from './repository';
import { isLateDeductionSchemaReady } from './schema';

/**
 * Void any automatic late-deduction debit when attendance is corrected to an
 * excluded status (absent/off/leave/…). Keeps an audit trail on the case and
 * leaves DoNotAutoRecreate=0 so a later restore-to-present can finalize again.
 * Recovery must also skip excluded attendance statuses.
 */
export async function voidLateDeductionForExcludedAttendance(params: {
  empId: number;
  branchId: number;
  workDate: string;
  attendanceId: number;
  status: string;
}): Promise<{ handled: boolean; caseId?: number; voided: boolean; reason?: string }> {
  const { empId, branchId, workDate, attendanceId, status } = params;
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    return { handled: false, voided: false, reason: 'schema_unavailable' };
  }

  return withLateDeductionCaseLock(
    { empId, branchId, workDate },
    async (db) => {
      const existing = await findLateDeductionCase(db, empId, branchId, workDate);
      if (existing?.doNotAutoRecreate || existing?.status === 'cancelled') {
        return {
          handled: true,
          caseId: existing.caseId,
          voided: false,
          reason: 'cancelled_do_not_recreate',
        };
      }
      if (existing?.status === 'manager_applied') {
        return {
          handled: true,
          caseId: existing.caseId,
          voided: false,
          reason: 'manager_decision_locked',
        };
      }

      let voided = false;
      const voidAttendanceId = existing?.attendanceId ?? attendanceId;
      if (voidAttendanceId != null && Number(voidAttendanceId) !== 0) {
        const n = await voidLateDeductionLedgerEntry(db, {
          attendanceId: Number(voidAttendanceId),
          branchId,
          voidReason: `إلغاء خصم التأخير — تصحيح الحضور إلى ${String(status).trim() || 'excluded'}`,
        });
        voided = n > 0;
      }

      // Clear lateness so recovery cannot re-apply from stale LateMinutes.
      // Real attendance IDs are positive; synthetic smoke IDs may be negative.
      if (Number.isFinite(attendanceId) && attendanceId !== 0) {
        await db
          .request()
          .input('attendanceId', sql.Int, attendanceId)
          .input('empId', sql.Int, empId)
          .input('branchId', sql.Int, branchId)
          .query(`
            UPDATE dbo.TblEmpAttendance
            SET LateMinutes = 0, UpdatedAt = SYSDATETIME()
            WHERE ID = @attendanceId AND EmpID = @empId AND BranchID = @branchId
          `);
      }

      const row = await upsertLateDeductionCase(db, {
        empId,
        branchId,
        workDate,
        attendanceId,
        lateMinutes: 0,
        deductionKind: 'none',
        status: 'skipped',
        dailyBasePay: existing?.dailyBasePay ?? null,
        amount: null,
        ledgerEntryId: null,
      });

      return {
        handled: true,
        caseId: row.caseId,
        voided,
        reason: 'excluded_attendance_status',
      };
    },
  );
}
