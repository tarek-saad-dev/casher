/**
 * Phase 1R — operations day-state for session branch (resolver-backed).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import {
  resolveEmployeeGlobalSchedule,
  resolveEmployeeBranchSchedule,
} from '@/lib/hr/employeeBranchScheduleResolver';
import { getOperationsDayStateVersion } from '@/lib/hr/scheduleAvailabilityInvalidation';
import { BARBER_JOBS_SQL_LIST } from '@/lib/availabilityEngine';

export type DayStateSection =
  | 'present'
  | 'transferred_in'
  | 'elsewhere'
  | 'off';

export type OperationsDayEmployeeState = {
  empId: number;
  empName: string;
  section: DayStateSection;
  statusLabelAr: string;
  baseBranch: {
    branchId: number;
    branchCode: string;
    branchName: string;
  } | null;
  currentBranch: {
    branchId: number;
    branchCode: string;
    branchName: string;
  } | null;
  scheduleWindow: { startTime: string | null; endTime: string | null; overnight: boolean } | null;
  isTransferred: boolean;
  transferReason: string | null;
  isGlobalDayOff: boolean;
  attendance: { status: string; checkInTime: string | null; checkOutTime: string | null } | null;
  activeBookingsCount: number;
  activeQueueCount: number;
  source: string | null;
};

export async function loadOperationsDayState(args: {
  sessionBranchId: number;
  workDate: string;
  includeElsewhere?: boolean;
}): Promise<{
  workDate: string;
  sessionBranchId: number;
  sessionBranchCode: string;
  version: number;
  sections: {
    present: OperationsDayEmployeeState[];
    transferredIn: OperationsDayEmployeeState[];
    elsewhere: OperationsDayEmployeeState[];
    off: OperationsDayEmployeeState[];
  };
}> {
  const session = await getBranchById(args.sessionBranchId);
  if (!session) {
    throw new Error('SESSION_BRANCH_NOT_FOUND');
  }

  const db = await getPool();
  const barbers = await db.request().query(`
    SELECT EmpID, EmpName
    FROM dbo.TblEmp
    WHERE ISNULL(isActive, 1) = 1 AND Job IN (${BARBER_JOBS_SQL_LIST})
    ORDER BY EmpName
  `);

  const present: OperationsDayEmployeeState[] = [];
  const transferredIn: OperationsDayEmployeeState[] = [];
  const elsewhere: OperationsDayEmployeeState[] = [];
  const off: OperationsDayEmployeeState[] = [];

  const empIds = barbers.recordset.map((b: { EmpID: number }) => Number(b.EmpID));
  const idList = empIds.length ? empIds.join(',') : '0';

  const bookingsRes = await db
    .request()
    .input('day', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.sessionBranchId)
    .query(`
      SELECT AssignedEmpID AS EmpID, COUNT(*) AS C
      FROM dbo.Bookings
      WHERE BookingDate = @day AND BranchID = @branchId
        AND AssignedEmpID IN (${idList})
        AND Status IN (N'confirmed', N'arrived', N'queued', N'in_service', N'in_progress')
      GROUP BY AssignedEmpID
    `)
    .catch(() => ({ recordset: [] as { EmpID: number; C: number }[] }));
  const bookingMap = new Map(bookingsRes.recordset.map((r) => [Number(r.EmpID), Number(r.C)]));

  const queueRes = await db
    .request()
    .input('day', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.sessionBranchId)
    .query(`
      SELECT EmpID, COUNT(*) AS C
      FROM dbo.QueueTickets
      WHERE QueueDate = @day AND BranchID = @branchId
        AND EmpID IN (${idList})
        AND LOWER(Status) IN ('waiting', 'called', 'in_service')
      GROUP BY EmpID
    `)
    .catch(() => ({ recordset: [] as { EmpID: number; C: number }[] }));
  const queueMap = new Map(queueRes.recordset.map((r) => [Number(r.EmpID), Number(r.C)]));

  const attRes = await db
    .request()
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT EmpID, BranchID, CheckInTime, CheckOutTime
      FROM dbo.TblEmpAttendance
      WHERE WorkDate = @day AND EmpID IN (${idList})
    `)
    .catch(() => ({ recordset: [] as Record<string, unknown>[] }));
  const attMap = new Map<number, Record<string, unknown>>();
  for (const r of attRes.recordset) attMap.set(Number(r.EmpID), r);

  const transferRes = await db
    .request()
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT EmpID, Reason, FromBranchID, ToBranchID
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE WorkDate = @day AND IsActive = 1 AND EmpID IN (${idList})
    `)
    .catch(() => ({ recordset: [] as Record<string, unknown>[] }));
  const transferMap = new Map(
    transferRes.recordset.map((r) => [Number(r.EmpID), r]),
  );

  for (const b of barbers.recordset) {
    const empId = Number(b.EmpID);
    const empName = String(b.EmpName);
    const global = await resolveEmployeeGlobalSchedule({
      empId,
      workDate: args.workDate,
      publicOnly: false,
    });
    const atSession = await resolveEmployeeBranchSchedule({
      empId,
      branchId: args.sessionBranchId,
      workDate: args.workDate,
    });

    const working = global.branches.find((x) => x.isWorking) ?? null;
    const transfer = transferMap.get(empId);
    const isTransferredHere =
      Boolean(transfer) && Number(transfer?.ToBranchID) === args.sessionBranchId;
    const isTransferredAway =
      Boolean(transfer) && Number(transfer?.FromBranchID) === args.sessionBranchId;

    const att = attMap.get(empId);
    let attendance: OperationsDayEmployeeState['attendance'] = null;
    if (att) {
      const cin = att.CheckInTime == null ? null : String(att.CheckInTime);
      const cout = att.CheckOutTime == null ? null : String(att.CheckOutTime);
      attendance = {
        status: cout ? 'checked_out' : cin ? 'checked_in' : 'none',
        checkInTime: cin,
        checkOutTime: cout,
      };
    }

    const baseFromSchedule = working && !isTransferredHere && !isTransferredAway
      ? working
      : null;
    // Base = schedule before transfer: look at transfer from branch name if transferred
    let baseBranch: OperationsDayEmployeeState['baseBranch'] = null;
    if (transfer) {
      const from = await getBranchById(Number(transfer.FromBranchID));
      if (from) {
        baseBranch = {
          branchId: from.branchId,
          branchCode: from.branchCode,
          branchName: from.branchName,
        };
      }
    } else if (working) {
      baseBranch = {
        branchId: working.branchId,
        branchCode: working.branchCode,
        branchName: working.branchName,
      };
    }

    const current =
      atSession?.isWorking
        ? {
            branchId: atSession.branchId,
            branchCode: atSession.branchCode,
            branchName: atSession.branchName,
          }
        : working
          ? {
              branchId: working.branchId,
              branchCode: working.branchCode,
              branchName: working.branchName,
            }
          : null;

    const window =
      atSession?.isWorking
        ? {
            startTime: atSession.startTime,
            endTime: atSession.endTime,
            overnight: atSession.endDayOffset === 1,
          }
        : working
          ? {
              startTime: working.startTime,
              endTime: working.endTime,
              overnight: working.endDayOffset === 1,
            }
          : null;

    const row: OperationsDayEmployeeState = {
      empId,
      empName,
      section: 'off',
      statusLabelAr: 'إجازة أسبوعية',
      baseBranch,
      currentBranch: current,
      scheduleWindow: window,
      isTransferred: Boolean(transfer),
      transferReason: transfer?.Reason == null ? null : String(transfer.Reason),
      isGlobalDayOff: global.isGlobalDayOff,
      attendance,
      activeBookingsCount: bookingMap.get(empId) ?? 0,
      activeQueueCount: queueMap.get(empId) ?? 0,
      source: atSession?.source ?? working?.source ?? null,
    };

    if (global.isGlobalDayOff) {
      row.section = 'off';
      row.statusLabelAr = 'إجازة / غياب';
      off.push(row);
      continue;
    }

    if (atSession?.isWorking) {
      if (isTransferredHere) {
        row.section = 'transferred_in';
        row.statusLabelAr = 'نقل طارئ';
        transferredIn.push(row);
      } else {
        row.section = 'present';
        row.statusLabelAr = attendance?.status === 'checked_in' ? 'متاح' : 'مجدول هنا';
        present.push(row);
      }
      continue;
    }

    if (working && working.branchId !== args.sessionBranchId) {
      row.section = 'elsewhere';
      row.statusLabelAr = `موجود في ${working.branchName}`;
      if (args.includeElsewhere !== false) elsewhere.push(row);
      continue;
    }

    row.section = 'off';
    row.statusLabelAr = 'إجازة أسبوعية';
    off.push(row);
    void baseFromSchedule;
  }

  return {
    workDate: args.workDate,
    sessionBranchId: args.sessionBranchId,
    sessionBranchCode: session.branchCode,
    version: getOperationsDayStateVersion(args.sessionBranchId, args.workDate),
    sections: { present, transferredIn, elsewhere, off },
  };
}

/** EmpIDs whose resolved location equals the session branch for the WorkDate. */
export async function listResolvedOperationalEmpIdsForBranch(
  branchId: number,
  workDate: string,
): Promise<number[]> {
  const state = await loadOperationsDayState({
    sessionBranchId: branchId,
    workDate,
    includeElsewhere: false,
  });
  return [
    ...state.sections.present.map((e) => e.empId),
    ...state.sections.transferredIn.map((e) => e.empId),
  ];
}
