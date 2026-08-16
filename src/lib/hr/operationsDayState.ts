/**
 * Phase 1R — batched operations day-state / presence (no per-employee resolver fan-out).
 * Preserves transfer + leave + branch-schedule semantics without N+1 SQL.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById, listActiveBranches } from '@/lib/branch/repository';
import { ensureEmpBranchWorkScheduleTable } from '@/lib/hr/empBranchWorkSchedule';
import { getOperationsDayStateVersion } from '@/lib/hr/scheduleAvailabilityInvalidation';
import { BARBER_JOBS_SQL_LIST } from '@/lib/availabilityEngine';
import {
  isTransferDestinationActive,
  isTransferSourceInactive,
} from '@/lib/hr/temporaryTransferWindow';

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

export type OperationalPresenceRow = {
  empId: number;
  empName: string;
  isTransferredIn: boolean;
  transferReason: string | null;
  startTime: string | null;
  endTime: string | null;
  overnight: boolean;
  source: 'branch_table' | 'temporary_transfer' | 'legacy_fallback' | 'none';
};

function dayOfWeekUtc(workDate: string): number {
  return new Date(`${workDate}T12:00:00Z`).getUTCDay();
}

function fmtTime(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 5);
}

function isOvernight(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em <= sh * 60 + sm;
}

type BranchMeta = { branchId: number; branchCode: string; branchName: string };

/**
 * Hot path for flow-board: who is operationally at this branch today.
 * ~6 batched queries total — never calls resolveEmployee* in a loop.
 */
export async function listOperationalPresenceForBranch(
  branchId: number,
  workDate: string,
): Promise<{
  present: OperationalPresenceRow[];
  transferredInIds: Set<number>;
  presentIds: Set<number>;
}> {
  await ensureEmpBranchWorkScheduleTable();
  const db = await getPool();
  const dow = dayOfWeekUtc(workDate);
  const session = await getBranchById(branchId);
  if (!session) {
    return { present: [], transferredInIds: new Set(), presentIds: new Set() };
  }

  const [
    assignedRes,
    transferRes,
    leaveOverrideRes,
    leaveDayOffRes,
    scheduleRes,
    legacyRes,
  ] = await Promise.all([
    db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('day', sql.Date, workDate)
      .query(`
        SELECT DISTINCT e.EmpID, e.EmpName
        FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment ea ON ea.EmpID = e.EmpID
        WHERE ISNULL(e.isActive, 1) = 1
          AND e.Job IN (${BARBER_JOBS_SQL_LIST})
          AND ea.BranchID = @branchId AND ea.IsActive = 1
          AND ea.EffectiveFrom <= @day
          AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
        ORDER BY e.EmpName
      `),
    db
      .request()
      .input('day', sql.Date, workDate)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT t.EmpID, t.FromBranchID, t.ToBranchID, t.Reason, t.StartTime, t.EndTime,
               e.EmpName
        FROM dbo.TblEmpTemporaryBranchTransfer t
        INNER JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
        WHERE t.WorkDate = @day AND t.IsActive = 1
          AND (t.FromBranchID = @branchId OR t.ToBranchID = @branchId)
          AND ISNULL(e.isActive, 1) = 1
      `)
      .catch(() => ({ recordset: [] as Record<string, unknown>[] })),
    db
      .request()
      .input('day', sql.Date, workDate)
      .query(`
        SELECT EmpID
        FROM dbo.TblEmpScheduleOverrides
        WHERE OverrideDate = @day AND IsActive = 1 AND Type = N'day_off'
      `)
      .catch(() => ({ recordset: [] as { EmpID: number }[] })),
    db
      .request()
      .input('day', sql.Date, workDate)
      .query(`
        SELECT EmpID
        FROM dbo.TblEmpDayOff
        WHERE OffDate = @day AND ISNULL(IsDeleted, 0) = 0
      `)
      .catch(() => ({ recordset: [] as { EmpID: number }[] })),
    db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('day', sql.Date, workDate)
      .input('dow', sql.TinyInt, dow)
      .query(`
        SELECT EmpID, StartTime, EndTime, CanReceiveBookings
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE BranchID = @branchId
          AND DayOfWeek = @dow
          AND IsActive = 1
          AND IsWorking = 1
          AND EffectiveFrom <= @day
          AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      `)
      .catch(() => ({ recordset: [] as Record<string, unknown>[] })),
    session.branchCode === 'GLEEM'
      ? db
          .request()
          .input('dow', sql.TinyInt, dow)
          .query(`
            SELECT EmpID, StartTime, EndTime
            FROM dbo.TblEmpWorkSchedule
            WHERE DayOfWeek = @dow AND IsWorking = 1
          `)
          .catch(() => ({ recordset: [] as Record<string, unknown>[] }))
      : Promise.resolve({ recordset: [] as Record<string, unknown>[] }),
  ]);

  const leave = new Set<number>();
  for (const r of leaveOverrideRes.recordset) leave.add(Number(r.EmpID));
  for (const r of leaveDayOffRes.recordset) leave.add(Number(r.EmpID));

  const scheduleAtSession = new Map<
    number,
    { startTime: string | null; endTime: string | null }
  >();
  for (const r of scheduleRes.recordset) {
    scheduleAtSession.set(Number(r.EmpID), {
      startTime: fmtTime(r.StartTime),
      endTime: fmtTime(r.EndTime),
    });
  }

  const legacyAtGleem = new Map<number, { startTime: string | null; endTime: string | null }>();
  for (const r of legacyRes.recordset) {
    legacyAtGleem.set(Number(r.EmpID), {
      startTime: fmtTime(r.StartTime),
      endTime: fmtTime(r.EndTime),
    });
  }

  const nameById = new Map<number, string>();
  for (const r of assignedRes.recordset) {
    nameById.set(Number(r.EmpID), String(r.EmpName));
  }

  type TransferRow = {
    empId: number;
    from: number;
    to: number;
    reason: string | null;
    startTime: string | null;
    endTime: string | null;
    empName: string;
  };
  const transferByEmp = new Map<number, TransferRow>();
  for (const r of transferRes.recordset) {
    const empId = Number(r.EmpID);
    transferByEmp.set(empId, {
      empId,
      from: Number(r.FromBranchID),
      to: Number(r.ToBranchID),
      reason: r.Reason == null ? null : String(r.Reason),
      startTime: fmtTime(r.StartTime),
      endTime: fmtTime(r.EndTime),
      empName: String(r.EmpName),
    });
    nameById.set(empId, String(r.EmpName));
  }

  const present: OperationalPresenceRow[] = [];
  const presentIds = new Set<number>();
  const transferredInIds = new Set<number>();

  const candidateIds = new Set<number>([
    ...nameById.keys(),
    ...transferByEmp.keys(),
  ]);

  for (const empId of candidateIds) {
    if (leave.has(empId)) continue;

    const transfer = transferByEmp.get(empId);
    if (
      transfer &&
      transfer.from === branchId &&
      transfer.to !== branchId &&
      isTransferSourceInactive({
        workDate,
        startTime: transfer.startTime,
        endTime: transfer.endTime,
      })
    ) {
      continue; // transferred away (window started)
    }

    if (transfer && transfer.to === branchId) {
      if (
        !isTransferDestinationActive({
          workDate,
          startTime: transfer.startTime,
          endTime: transfer.endTime,
        })
      ) {
        // Split-day: not yet at destination — fall through to weekly if any
      } else {
        const start = transfer.startTime ?? session.defaultOpenTime?.slice(0, 5) ?? null;
        const end = transfer.endTime ?? session.defaultCloseTime?.slice(0, 5) ?? null;
        present.push({
          empId,
          empName: transfer.empName || nameById.get(empId) || String(empId),
          isTransferredIn: true,
          transferReason: transfer.reason,
          startTime: start,
          endTime: end,
          overnight: isOvernight(start, end),
          source: 'temporary_transfer',
        });
        presentIds.add(empId);
        transferredInIds.add(empId);
        continue;
      }
    }

    // Must be assigned to session to appear via weekly schedule
    if (!nameById.has(empId) && !transfer) continue;

    const sched = scheduleAtSession.get(empId);
    if (sched) {
      present.push({
        empId,
        empName: nameById.get(empId) || String(empId),
        isTransferredIn: false,
        transferReason: null,
        startTime: sched.startTime,
        endTime: sched.endTime,
        overnight: isOvernight(sched.startTime, sched.endTime),
        source: 'branch_table',
      });
      presentIds.add(empId);
      continue;
    }

    if (session.branchCode === 'GLEEM') {
      const legacy = legacyAtGleem.get(empId);
      if (legacy && nameById.has(empId)) {
        present.push({
          empId,
          empName: nameById.get(empId)!,
          isTransferredIn: false,
          transferReason: null,
          startTime: legacy.startTime,
          endTime: legacy.endTime,
          overnight: isOvernight(legacy.startTime, legacy.endTime),
          source: 'legacy_fallback',
        });
        presentIds.add(empId);
      }
    }
  }

  present.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));
  return { present, transferredInIds, presentIds };
}

/** EmpIDs whose resolved location equals the session branch for the WorkDate. */
export async function listResolvedOperationalEmpIdsForBranch(
  branchId: number,
  workDate: string,
): Promise<number[]> {
  const { presentIds } = await listOperationalPresenceForBranch(branchId, workDate);
  return [...presentIds];
}

/**
 * Full day-state for schedule-control modal — batched, no per-emp resolver calls.
 */
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
  await ensureEmpBranchWorkScheduleTable();
  const session = await getBranchById(args.sessionBranchId);
  if (!session) {
    throw new Error('SESSION_BRANCH_NOT_FOUND');
  }

  const db = await getPool();
  const dow = dayOfWeekUtc(args.workDate);
  const branches = await listActiveBranches().catch(() => [] as Awaited<ReturnType<typeof listActiveBranches>>);
  // Include inactive session branch meta if needed
  const branchMeta = new Map<number, BranchMeta>();
  for (const b of branches) {
    branchMeta.set(b.branchId, {
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
    });
  }
  branchMeta.set(session.branchId, {
    branchId: session.branchId,
    branchCode: session.branchCode,
    branchName: session.branchName,
  });

  const barbersRes = await db.request().query(`
    SELECT EmpID, EmpName
    FROM dbo.TblEmp
    WHERE ISNULL(isActive, 1) = 1 AND Job IN (${BARBER_JOBS_SQL_LIST})
    ORDER BY EmpName
  `);
  const barbers = barbersRes.recordset as Array<{ EmpID: number; EmpName: string }>;
  const empIds = barbers.map((b) => Number(b.EmpID));
  const idList = empIds.length ? empIds.join(',') : '0';

  const [
    bookingsRes,
    queueRes,
    attRes,
    transferRes,
    leaveOverrideRes,
    leaveDayOffRes,
    workingSchedRes,
    assignRes,
    legacyRes,
  ] = await Promise.all([
    db
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
      .catch(() => ({ recordset: [] as { EmpID: number; C: number }[] })),
    db
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
      .catch(() => ({ recordset: [] as { EmpID: number; C: number }[] })),
    db
      .request()
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT EmpID, BranchID, CheckInTime, CheckOutTime, Status
        FROM dbo.TblEmpAttendance
        WHERE WorkDate = @day AND EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as Record<string, unknown>[] })),
    db
      .request()
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT EmpID, Reason, FromBranchID, ToBranchID, StartTime, EndTime
        FROM dbo.TblEmpTemporaryBranchTransfer
        WHERE WorkDate = @day AND IsActive = 1 AND EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as Record<string, unknown>[] })),
    db
      .request()
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT EmpID FROM dbo.TblEmpScheduleOverrides
        WHERE OverrideDate = @day AND IsActive = 1 AND Type = N'day_off'
          AND EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as { EmpID: number }[] })),
    db
      .request()
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT EmpID FROM dbo.TblEmpDayOff
        WHERE OffDate = @day AND ISNULL(IsDeleted, 0) = 0 AND EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as { EmpID: number }[] })),
    db
      .request()
      .input('day', sql.Date, args.workDate)
      .input('dow', sql.TinyInt, dow)
      .query(`
        SELECT s.EmpID, s.BranchID, s.StartTime, s.EndTime, b.BranchCode, b.BranchName
        FROM dbo.TblEmpBranchWorkSchedule s
        INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
        WHERE s.DayOfWeek = @dow
          AND s.IsActive = 1 AND s.IsWorking = 1
          AND s.EffectiveFrom <= @day
          AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @day)
          AND s.EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as Record<string, unknown>[] })),
    db
      .request()
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT EmpID, BranchID
        FROM dbo.TblEmpBranchAssignment
        WHERE IsActive = 1
          AND EffectiveFrom <= @day
          AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
          AND EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as { EmpID: number; BranchID: number }[] })),
    db
      .request()
      .input('dow', sql.TinyInt, dow)
      .query(`
        SELECT EmpID, StartTime, EndTime
        FROM dbo.TblEmpWorkSchedule
        WHERE DayOfWeek = @dow AND IsWorking = 1 AND EmpID IN (${idList})
      `)
      .catch(() => ({ recordset: [] as Record<string, unknown>[] })),
  ]);

  // Ensure branch names for transfer from/to even if inactive
  const neededBranchIds = new Set<number>();
  for (const r of transferRes.recordset) {
    neededBranchIds.add(Number(r.FromBranchID));
    neededBranchIds.add(Number(r.ToBranchID));
  }
  for (const r of workingSchedRes.recordset) {
    neededBranchIds.add(Number(r.BranchID));
    branchMeta.set(Number(r.BranchID), {
      branchId: Number(r.BranchID),
      branchCode: String(r.BranchCode),
      branchName: String(r.BranchName),
    });
  }
  const missing = [...neededBranchIds].filter((id) => !branchMeta.has(id));
  if (missing.length) {
    const missRes = await db
      .request()
      .query(`
        SELECT BranchID, BranchCode, BranchName
        FROM dbo.TblBranch WHERE BranchID IN (${missing.join(',')})
      `);
    for (const r of missRes.recordset) {
      branchMeta.set(Number(r.BranchID), {
        branchId: Number(r.BranchID),
        branchCode: String(r.BranchCode),
        branchName: String(r.BranchName),
      });
    }
  }

  const leave = new Set<number>();
  for (const r of leaveOverrideRes.recordset) leave.add(Number(r.EmpID));
  for (const r of leaveDayOffRes.recordset) leave.add(Number(r.EmpID));

  const bookingMap = new Map(bookingsRes.recordset.map((r) => [Number(r.EmpID), Number(r.C)]));
  const queueMap = new Map(queueRes.recordset.map((r) => [Number(r.EmpID), Number(r.C)]));

  const attMap = new Map<number, Record<string, unknown>>();
  for (const r of attRes.recordset) attMap.set(Number(r.EmpID), r);

  const transferMap = new Map<number, Record<string, unknown>>();
  for (const r of transferRes.recordset) transferMap.set(Number(r.EmpID), r);

  // empId → working branch schedule (first / only — policy is one per day)
  const workingByEmp = new Map<
    number,
    { branchId: number; branchCode: string; branchName: string; start: string | null; end: string | null }
  >();
  for (const r of workingSchedRes.recordset) {
    const empId = Number(r.EmpID);
    if (workingByEmp.has(empId)) continue; // conflict: keep first; modal can still show
    workingByEmp.set(empId, {
      branchId: Number(r.BranchID),
      branchCode: String(r.BranchCode),
      branchName: String(r.BranchName),
      start: fmtTime(r.StartTime),
      end: fmtTime(r.EndTime),
    });
  }

  const assignedBranches = new Map<number, Set<number>>();
  for (const r of assignRes.recordset) {
    const empId = Number(r.EmpID);
    if (!assignedBranches.has(empId)) assignedBranches.set(empId, new Set());
    assignedBranches.get(empId)!.add(Number(r.BranchID));
  }

  const gleemId =
    [...branchMeta.values()].find((b) => b.branchCode === 'GLEEM')?.branchId ?? null;
  const legacyByEmp = new Map<number, { start: string | null; end: string | null }>();
  for (const r of legacyRes.recordset) {
    legacyByEmp.set(Number(r.EmpID), {
      start: fmtTime(r.StartTime),
      end: fmtTime(r.EndTime),
    });
  }

  const present: OperationsDayEmployeeState[] = [];
  const transferredIn: OperationsDayEmployeeState[] = [];
  const elsewhere: OperationsDayEmployeeState[] = [];
  const off: OperationsDayEmployeeState[] = [];

  for (const b of barbers) {
    const empId = Number(b.EmpID);
    const empName = String(b.EmpName);
    const transfer = transferMap.get(empId);
    const transferStart = transfer ? fmtTime(transfer.StartTime) : null;
    const transferEnd = transfer ? fmtTime(transfer.EndTime) : null;
    const destActive =
      Boolean(transfer) &&
      isTransferDestinationActive({
        workDate: args.workDate,
        startTime: transferStart,
        endTime: transferEnd,
      });
    const sourceInactive =
      Boolean(transfer) &&
      isTransferSourceInactive({
        workDate: args.workDate,
        startTime: transferStart,
        endTime: transferEnd,
      });
    const isTransferredHere =
      Boolean(transfer) &&
      Number(transfer?.ToBranchID) === args.sessionBranchId &&
      destActive;
    const isTransferredAway =
      Boolean(transfer) &&
      Number(transfer?.FromBranchID) === args.sessionBranchId &&
      sourceInactive;

    const att = attMap.get(empId);
    let attendance: OperationsDayEmployeeState['attendance'] = null;
    if (att) {
      const cin = att.CheckInTime == null ? null : String(att.CheckInTime);
      const cout = att.CheckOutTime == null ? null : String(att.CheckOutTime);
      const statusRaw = att.Status == null ? null : String(att.Status);
      attendance = {
        status:
          statusRaw === 'Absent'
            ? 'absent'
            : cout
              ? 'checked_out'
              : cin
                ? 'checked_in'
                : 'none',
        checkInTime: cin,
        checkOutTime: cout,
      };
    }

    let baseBranch: OperationsDayEmployeeState['baseBranch'] = null;
    if (transfer) {
      baseBranch = branchMeta.get(Number(transfer.FromBranchID)) ?? null;
    }

    let currentBranch: OperationsDayEmployeeState['currentBranch'] = null;
    let window: OperationsDayEmployeeState['scheduleWindow'] = null;
    let source: string | null = null;
    let isGlobalDayOff = leave.has(empId);

    if (isGlobalDayOff) {
      const row: OperationsDayEmployeeState = {
        empId,
        empName,
        section: 'off',
        statusLabelAr: 'إجازة / غياب',
        baseBranch,
        currentBranch: null,
        scheduleWindow: null,
        isTransferred: Boolean(transfer),
        transferReason: transfer?.Reason == null ? null : String(transfer.Reason),
        isGlobalDayOff: true,
        attendance,
        activeBookingsCount: bookingMap.get(empId) ?? 0,
        activeQueueCount: queueMap.get(empId) ?? 0,
        source: null,
      };
      off.push(row);
      continue;
    }

    if (isTransferredHere && transfer) {
      const toMeta = branchMeta.get(Number(transfer.ToBranchID)) ?? {
        branchId: args.sessionBranchId,
        branchCode: session.branchCode,
        branchName: session.branchName,
      };
      const start =
        fmtTime(transfer.StartTime) ?? session.defaultOpenTime?.slice(0, 5) ?? null;
      const end =
        fmtTime(transfer.EndTime) ?? session.defaultCloseTime?.slice(0, 5) ?? null;
      currentBranch = toMeta;
      window = { startTime: start, endTime: end, overnight: isOvernight(start, end) };
      source = 'temporary_transfer';
      if (!baseBranch) baseBranch = branchMeta.get(Number(transfer.FromBranchID)) ?? null;

      transferredIn.push({
        empId,
        empName,
        section: 'transferred_in',
        statusLabelAr: 'نقل طارئ',
        baseBranch,
        currentBranch,
        scheduleWindow: window,
        isTransferred: true,
        transferReason: transfer.Reason == null ? null : String(transfer.Reason),
        isGlobalDayOff: false,
        attendance,
        activeBookingsCount: bookingMap.get(empId) ?? 0,
        activeQueueCount: queueMap.get(empId) ?? 0,
        source,
      });
      continue;
    }

    if (isTransferredAway) {
      const toMeta = branchMeta.get(Number(transfer!.ToBranchID));
      elsewhere.push({
        empId,
        empName,
        section: 'elsewhere',
        statusLabelAr: toMeta ? `موجود في ${toMeta.branchName}` : 'موجود في فرع آخر',
        baseBranch: branchMeta.get(Number(transfer!.FromBranchID)) ?? null,
        currentBranch: toMeta ?? null,
        scheduleWindow: null,
        isTransferred: true,
        transferReason: transfer!.Reason == null ? null : String(transfer!.Reason),
        isGlobalDayOff: false,
        attendance,
        activeBookingsCount: bookingMap.get(empId) ?? 0,
        activeQueueCount: queueMap.get(empId) ?? 0,
        source: 'temporary_transfer',
      });
      continue;
    }

    const working = workingByEmp.get(empId);
    if (working && working.branchId === args.sessionBranchId) {
      currentBranch = {
        branchId: working.branchId,
        branchCode: working.branchCode,
        branchName: working.branchName,
      };
      baseBranch = currentBranch;
      window = {
        startTime: working.start,
        endTime: working.end,
        overnight: isOvernight(working.start, working.end),
      };
      source = 'branch_table';
      present.push({
        empId,
        empName,
        section: 'present',
        statusLabelAr: attendance?.status === 'checked_in' ? 'متاح' : 'مجدول هنا',
        baseBranch,
        currentBranch,
        scheduleWindow: window,
        isTransferred: false,
        transferReason: null,
        isGlobalDayOff: false,
        attendance,
        activeBookingsCount: bookingMap.get(empId) ?? 0,
        activeQueueCount: queueMap.get(empId) ?? 0,
        source,
      });
      continue;
    }

    if (working && working.branchId !== args.sessionBranchId) {
      if (args.includeElsewhere !== false) {
        elsewhere.push({
          empId,
          empName,
          section: 'elsewhere',
          statusLabelAr: `موجود في ${working.branchName}`,
          baseBranch: {
            branchId: working.branchId,
            branchCode: working.branchCode,
            branchName: working.branchName,
          },
          currentBranch: {
            branchId: working.branchId,
            branchCode: working.branchCode,
            branchName: working.branchName,
          },
          scheduleWindow: {
            startTime: working.start,
            endTime: working.end,
            overnight: isOvernight(working.start, working.end),
          },
          isTransferred: false,
          transferReason: null,
          isGlobalDayOff: false,
          attendance,
          activeBookingsCount: bookingMap.get(empId) ?? 0,
          activeQueueCount: queueMap.get(empId) ?? 0,
          source: 'branch_table',
        });
      }
      continue;
    }

    // GLEEM legacy fallback when no branch-table row
    if (
      gleemId != null &&
      args.sessionBranchId === gleemId &&
      assignedBranches.get(empId)?.has(gleemId) &&
      legacyByEmp.has(empId)
    ) {
      const legacy = legacyByEmp.get(empId)!;
      const gleemMeta = branchMeta.get(gleemId)!;
      present.push({
        empId,
        empName,
        section: 'present',
        statusLabelAr: attendance?.status === 'checked_in' ? 'متاح' : 'مجدول هنا',
        baseBranch: gleemMeta,
        currentBranch: gleemMeta,
        scheduleWindow: {
          startTime: legacy.start,
          endTime: legacy.end,
          overnight: isOvernight(legacy.start, legacy.end),
        },
        isTransferred: false,
        transferReason: null,
        isGlobalDayOff: false,
        attendance,
        activeBookingsCount: bookingMap.get(empId) ?? 0,
        activeQueueCount: queueMap.get(empId) ?? 0,
        source: 'legacy_fallback',
      });
      continue;
    }

    off.push({
      empId,
      empName,
      section: 'off',
      statusLabelAr: 'إجازة أسبوعية',
      baseBranch: null,
      currentBranch: null,
      scheduleWindow: null,
      isTransferred: false,
      transferReason: null,
      isGlobalDayOff: false,
      attendance,
      activeBookingsCount: bookingMap.get(empId) ?? 0,
      activeQueueCount: queueMap.get(empId) ?? 0,
      source: null,
    });
  }

  return {
    workDate: args.workDate,
    sessionBranchId: args.sessionBranchId,
    sessionBranchCode: session.branchCode,
    version: getOperationsDayStateVersion(args.sessionBranchId, args.workDate),
    sections: { present, transferredIn, elsewhere, off },
  };
}
