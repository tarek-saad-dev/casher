/**
 * Shared loader for GET /api/operations/flow-board — one branch at a time.
 * Supports presenceMode: present (operational) | all (assigned + transfer-ins).
 */

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  computeEffectiveTicket,
  type QueueTicketRaw,
} from '@/lib/queueLifecycleEngine';
import {
  normalizeBookingTimes,
  createCairoDateTime,
  sqlDateToYyyyMmDd,
} from '@/lib/bookingDateTime';
import { getBarbersDayStatus } from '@/lib/availabilityEngine';
import { getBranchById } from '@/lib/branch/repository';
import { listOperationalPresenceForBranch } from '@/lib/hr/operationsDayState';
import type { FlowBoardBarber } from '@/lib/operations/flowBoardTypes';

export type FlowBoardPresenceMode = 'present' | 'all';

export type FlowBoardBranchMeta = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
};

export type LoadFlowBoardBranchResult = {
  barbers: FlowBoardBarber[];
  branch: FlowBoardBranchMeta | null;
};

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export async function loadFlowBoardForBranch(opts: {
  branchId: number;
  dateStr: string;
  presenceMode: FlowBoardPresenceMode;
  now?: Date;
  lifecycleCols?: string;
}): Promise<LoadFlowBoardBranchResult> {
  const { branchId, dateStr, presenceMode } = opts;
  const now = opts.now ?? new Date();
  const db = await getPool();

  let lifecycleCols = opts.lifecycleCols;
  if (!lifecycleCols) {
    const colCheck = await db.request().query(`
      SELECT
        CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedStartAt') IS NOT NULL THEN 1 ELSE 0 END AS hasExpectedStartAt,
        CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedEndAt') IS NOT NULL THEN 1 ELSE 0 END AS hasExpectedEndAt,
        CASE WHEN COL_LENGTH('dbo.QueueTickets','DurationMinutes') IS NOT NULL THEN 1 ELSE 0 END AS hasDurationMinutes
    `);
    const { hasExpectedStartAt, hasExpectedEndAt, hasDurationMinutes } =
      colCheck.recordset[0] || {};
    lifecycleCols = [
      hasExpectedStartAt ? 'qt.ExpectedStartAt' : 'NULL AS ExpectedStartAt',
      hasExpectedEndAt ? 'qt.ExpectedEndAt' : 'NULL AS ExpectedEndAt',
      hasDurationMinutes ? 'qt.DurationMinutes' : 'NULL AS DurationMinutes',
    ].join(',\n            ');
  }

  const nextDateStr = nextDate(dateStr);

  const [barbersRes, bookingsRes, queueRes, bookingsNextRes, queueNextRes, activeBranchRecord] =
    await Promise.all([
      db
        .request()
        .input('branchId', sql.Int, branchId)
        .input('bdate', sql.Date, dateStr)
        .query(`
          SELECT DISTINCT e.EmpID, e.EmpName
          FROM [dbo].[TblEmp] e
          INNER JOIN [dbo].[TblEmpBranchAssignment] ea ON ea.EmpID = e.EmpID
          WHERE e.isActive = 1 AND e.Job = N'حلاق'
            AND ea.BranchID = @branchId
            AND ea.IsActive = 1
            AND ea.EffectiveFrom <= @bdate
            AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @bdate)
          ORDER BY e.EmpName
        `),

      db
        .request()
        .input('bdate', sql.Date, dateStr)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT
            b.BookingID, b.AssignedEmpID, b.ClientID, b.BookingDate,
            c.Name as ClientName, b.StartTime, b.EndTime, b.Status
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON b.ClientID = c.ClientID
          WHERE b.BookingDate = @bdate
            AND b.BranchID = @branchId
            AND b.AssignedEmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
        `),

      db
        .request()
        .input('qdate', sql.Date, dateStr)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT
            qt.QueueTicketID, qt.TicketCode, qt.EmpID, qt.ClientID, qt.QueueDate,
            c.Name as ClientName, qt.Status, qt.EstimatedStartTime, qt.ServiceStartedAt, qt.CreatedTime,
            ${lifecycleCols}
          FROM [dbo].[QueueTickets] qt
          LEFT JOIN [dbo].[TblClient] c ON qt.ClientID = c.ClientID
          WHERE qt.QueueDate = @qdate
            AND qt.BranchID = @branchId
            AND qt.EmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND LOWER(qt.Status) IN ('waiting', 'called', 'arrived', 'in_service')
        `),

      db
        .request()
        .input('bdate', sql.Date, nextDateStr)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT
            b.BookingID, b.AssignedEmpID, b.ClientID, b.BookingDate,
            c.Name as ClientName, b.StartTime, b.EndTime, b.Status
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON b.ClientID = c.ClientID
          WHERE b.BookingDate = @bdate
            AND b.BranchID = @branchId
            AND b.AssignedEmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
        `),

      db
        .request()
        .input('qdate', sql.Date, nextDateStr)
        .input('branchId', sql.Int, branchId)
        .query(`
          SELECT
            qt.QueueTicketID, qt.TicketCode, qt.EmpID, qt.ClientID, qt.QueueDate,
            c.Name as ClientName, qt.Status, qt.EstimatedStartTime, qt.ServiceStartedAt, qt.CreatedTime,
            ${lifecycleCols}
          FROM [dbo].[QueueTickets] qt
          LEFT JOIN [dbo].[TblClient] c ON qt.ClientID = c.ClientID
          WHERE qt.QueueDate = @qdate
            AND qt.BranchID = @branchId
            AND qt.EmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND LOWER(qt.Status) IN ('waiting', 'called', 'arrived', 'in_service')
        `),

      getBranchById(branchId),
    ]);

  const branchMeta: FlowBoardBranchMeta | null = activeBranchRecord
    ? {
        branchId: activeBranchRecord.branchId,
        branchCode: activeBranchRecord.branchCode,
        branchName: activeBranchRecord.branchName,
        shortName: activeBranchRecord.shortName,
      }
    : null;

  const bookingIds = [
    ...bookingsRes.recordset,
    ...bookingsNextRes.recordset,
  ].map((b: { BookingID: number }) => b.BookingID);
  const queueIds = [
    ...queueRes.recordset,
    ...queueNextRes.recordset,
  ].map((q: { QueueTicketID: number }) => q.QueueTicketID);

  const bookingServicesMap = new Map<number, { names: string[]; totalDuration: number }>();
  const queueServicesMap = new Map<number, { names: string[]; totalDuration: number }>();

  if (bookingIds.length > 0) {
    try {
      const bsRes = await db.request().query(`
        SELECT bs.BookingID, p.ProName,
               ISNULL(bs.DurationMinutes, ISNULL(p.DurationMinutes, 30)) AS DurationMinutes
        FROM [dbo].[BookingServices] bs
        LEFT JOIN [dbo].[TblPro] p ON p.ProID = bs.ProID
        WHERE bs.BookingID IN (${bookingIds.join(',')})
        ORDER BY bs.BookingServiceID
      `);
      for (const row of bsRes.recordset) {
        const cur = bookingServicesMap.get(row.BookingID) ?? { names: [], totalDuration: 0 };
        if (row.ProName) cur.names.push(row.ProName);
        cur.totalDuration += row.DurationMinutes ?? 30;
        bookingServicesMap.set(row.BookingID, cur);
      }
    } catch {
      /* optional */
    }
  }

  if (queueIds.length > 0) {
    try {
      const qsRes = await db.request().query(`
        SELECT qts.QueueTicketID,
               ISNULL(qts.ProName, p.ProName) AS ProName,
               ISNULL(qts.DurationMinutes, ISNULL(p.DurationMinutes, 30)) AS DurationMinutes
        FROM [dbo].[QueueTicketServices] qts
        LEFT JOIN [dbo].[TblPro] p ON p.ProID = qts.ProID
        WHERE qts.QueueTicketID IN (${queueIds.join(',')})
        ORDER BY qts.ID
      `);
      for (const row of qsRes.recordset) {
        const cur = queueServicesMap.get(row.QueueTicketID) ?? { names: [], totalDuration: 0 };
        if (row.ProName) cur.names.push(row.ProName);
        cur.totalDuration += row.DurationMinutes ?? 30;
        queueServicesMap.set(row.QueueTicketID, cur);
      }
    } catch {
      /* optional */
    }
  }

  const isToday = dateStr === getCairoBusinessDate(now);
  const presence = await listOperationalPresenceForBranch(branchId, dateStr);
  const presenceById = new Map(presence.present.map((p) => [p.empId, p]));
  const operationalEmpIds = presence.presentIds;

  const assignedBarbers = barbersRes.recordset as Array<{ EmpID: number; EmpName: string }>;
  const locationFiltered: Array<{ EmpID: number; EmpName: string }> = [];
  const seen = new Set<number>();

  if (presenceMode === 'present') {
    for (const b of assignedBarbers) {
      const empId = Number(b.EmpID);
      if (operationalEmpIds.has(empId) && !seen.has(empId)) {
        locationFiltered.push(b);
        seen.add(empId);
      }
    }
    for (const p of presence.present) {
      if (!seen.has(p.empId)) {
        locationFiltered.push({ EmpID: p.empId, EmpName: p.empName });
        seen.add(p.empId);
      }
    }
  } else {
    // all assigned barbers for the branch + any transfer-ins
    for (const b of assignedBarbers) {
      const empId = Number(b.EmpID);
      if (!seen.has(empId)) {
        locationFiltered.push(b);
        seen.add(empId);
      }
    }
    for (const p of presence.present) {
      if (!seen.has(p.empId)) {
        locationFiltered.push({ EmpID: p.empId, EmpName: p.empName });
        seen.add(p.empId);
      }
    }
  }

  const allBarberIds = locationFiltered.map((b) => Number(b.EmpID));
  const dayStatusMap = await getBarbersDayStatus(allBarberIds, dateStr, {
    isToday,
    branchId,
  });

  const bookingsMap = new Map<number, any[]>();
  for (const b of bookingsRes.recordset) {
    if (!bookingsMap.has(b.AssignedEmpID)) bookingsMap.set(b.AssignedEmpID, []);
    bookingsMap.get(b.AssignedEmpID)!.push(b);
  }
  const queueMap = new Map<number, any[]>();
  for (const q of queueRes.recordset) {
    if (!queueMap.has(q.EmpID)) queueMap.set(q.EmpID, []);
    queueMap.get(q.EmpID)!.push(q);
  }
  const bookingsNextMap = new Map<number, any[]>();
  for (const b of bookingsNextRes.recordset) {
    if (!bookingsNextMap.has(b.AssignedEmpID)) bookingsNextMap.set(b.AssignedEmpID, []);
    bookingsNextMap.get(b.AssignedEmpID)!.push(b);
  }
  const queueNextMap = new Map<number, any[]>();
  for (const q of queueNextRes.recordset) {
    if (!queueNextMap.has(q.EmpID)) queueNextMap.set(q.EmpID, []);
    queueNextMap.get(q.EmpID)!.push(q);
  }

  const barbers: FlowBoardBarber[] = [];
  const defaultDuration = 30;

  for (const barber of locationFiltered) {
    const empId = barber.EmpID;
    const dayStatus = dayStatusMap.get(empId);
    const presenceRow = presenceById.get(empId);
    const transferBadge = Boolean(presenceRow?.isTransferredIn);

    const branchFields = branchMeta
      ? {
          branchId: branchMeta.branchId,
          branchCode: branchMeta.branchCode,
          branchName: branchMeta.branchName,
          branchShortName: branchMeta.shortName,
        }
      : {};

    const statusFields = {
      isWorkingDay: dayStatus?.isWorkingDay ?? false,
      isDayOff: dayStatus?.isDayOff ?? true,
      isAbsent: dayStatus?.isAbsent ?? false,
      isLateStart: dayStatus?.isLateStart ?? false,
      isEarlyLeave: dayStatus?.isEarlyLeave ?? false,
      currentAvailabilityStatus: dayStatus?.currentAvailabilityStatus ?? 'unknown',
      statusReasonArabic: dayStatus?.statusReasonArabic ?? 'غير متاح',
    };

    if (!dayStatus?.isWorkingDay || dayStatus.isAbsent) {
      const statusCode =
        dayStatus?.isAbsent
          ? 'absent'
          : dayStatus?.isDayOff
            ? 'day_off'
            : ((dayStatus?.currentAvailabilityStatus as FlowBoardBarber['status']) ?? 'day_off');
      barbers.push({
        empId,
        empName: barber.EmpName,
        status: statusCode,
        ...statusFields,
        ...branchFields,
        workStart: presenceRow?.startTime ?? null,
        workEnd: presenceRow?.endTime ?? null,
        isOvernightShift: presenceRow?.overnight ?? false,
        isEmergencyTransfer: transferBadge,
        nextAvailableAt: null,
        waitingCount: 0,
        bookingsCount: 0,
        inServiceCount: 0,
        timeline: [],
      });
      continue;
    }

    // Prefer override-aware effective hours (custom_hours / late_start / early_leave)
    // so bookings allowed by schedule-control still appear on the board.
    // Presence weekly times are fallback when day status has no window.
    const workStart = dayStatus.effectiveStart ?? presenceRow?.startTime ?? null;
    const workEnd = dayStatus.effectiveEnd ?? presenceRow?.endTime ?? null;
    const isOvernight = !!(
      workStart &&
      workEnd &&
      timeToMinutes(workEnd) <= timeToMinutes(workStart)
    );

    const timeline: FlowBoardBarber['timeline'] = [];
    const barberBookings = bookingsMap.get(empId) || [];
    const barberQueue = queueMap.get(empId) || [];
    const barberBookingsNext = isOvernight ? bookingsNextMap.get(empId) || [] : [];
    const barberQueueNext = isOvernight ? queueNextMap.get(empId) || [] : [];

    const shiftStartMs = workStart
      ? createCairoDateTime(dateStr, workStart).getTime()
      : -Infinity;
    const shiftEndMs =
      workStart && workEnd
        ? isOvernight
          ? createCairoDateTime(nextDate(dateStr), workEnd).getTime()
          : createCairoDateTime(dateStr, workEnd).getTime()
        : Infinity;
    const inShiftWindow = (start: Date, end: Date) =>
      start.getTime() < shiftEndMs && end.getTime() > shiftStartMs;

    for (const b of [...barberBookings, ...barberBookingsNext]) {
      const bookingDateStr = b.BookingDate ? sqlDateToYyyyMmDd(b.BookingDate) : dateStr;
      const svcInfo = bookingServicesMap.get(b.BookingID);
      const serviceDuration = svcInfo?.totalDuration ?? defaultDuration;
      const normalized = normalizeBookingTimes(
        bookingDateStr,
        b.StartTime,
        b.EndTime,
        serviceDuration,
        b.BookingID,
      );
      const start = new Date(normalized.startDateTimeCairo);
      const end = new Date(normalized.endDateTimeCairo);
      if (!inShiftWindow(start, end)) continue;

      timeline.push({
        type: 'booking',
        sourceId: b.BookingID,
        label: b.ClientName || `B-${b.BookingID}`,
        startTime: normalized.startDateTimeCairo,
        endTime: normalized.endDateTimeCairo,
        status: b.Status,
        protected: true,
        durationMinutes: normalized.durationMinutes,
        customerName: b.ClientName || undefined,
        serviceNames: svcInfo?.names,
        barberId: empId,
        startTimeDisplay: normalized.startTimeDisplay,
        endTimeDisplay: normalized.endTimeDisplay,
        dateDisplay: normalized.dateDisplay,
      });
    }

    let inServiceCount = 0;
    for (const q of [...barberQueue, ...barberQueueNext]) {
      const queueDateStr = q.QueueDate ? sqlDateToYyyyMmDd(q.QueueDate) : dateStr;
      const effective = computeEffectiveTicket(
        {
          QueueTicketID: q.QueueTicketID,
          TicketCode: q.TicketCode,
          TicketNumber: 0,
          Status: q.Status.toLowerCase() as QueueTicketRaw['Status'],
          EmpID: q.EmpID,
          ClientID: q.ClientID,
          QueueDate: queueDateStr,
          CreatedTime: q.CreatedTime,
          CalledAt: null,
          ArrivedAt: null,
          ServiceStartedAt: q.ServiceStartedAt,
          ServiceEndedAt: null,
          EstimatedStartTime: q.EstimatedStartTime,
          ExpectedStartAt: q.ExpectedStartAt ?? null,
          ExpectedEndAt: q.ExpectedEndAt ?? null,
          DurationMinutes: q.DurationMinutes ?? null,
        } as QueueTicketRaw,
        now,
      );

      if (q.Status.toLowerCase() === 'in_service') inServiceCount++;

      let start: Date;
      if (q.EstimatedStartTime) start = new Date(q.EstimatedStartTime);
      else if (q.ServiceStartedAt) start = new Date(q.ServiceStartedAt);
      else {
        const fallbackDate = queueDateStr === nextDateStr ? nextDateStr : dateStr;
        start = new Date(`${fallbackDate}T${workStart || '14:00'}`);
      }

      const qSvc = queueServicesMap.get(q.QueueTicketID);
      const duration =
        q.DurationMinutes ?? qSvc?.totalDuration ?? effective.durationMinutes ?? defaultDuration;
      const end = new Date(start.getTime() + duration * 60000);
      if (!inShiftWindow(start, end)) continue;

      timeline.push({
        type: 'queue',
        sourceId: q.QueueTicketID,
        label: q.TicketCode || `Q-${q.QueueTicketID}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: q.Status,
        protected: effective.isBlockingAvailability,
        durationMinutes: duration,
        customerName: q.ClientName || undefined,
        serviceNames: qSvc?.names,
        barberId: empId,
        actualStatus: effective.actualStatus,
        effectiveStatus: effective.effectiveStatus,
        expectedStartAt: effective.expectedStartAt?.toISOString() ?? undefined,
        expectedEndAt: effective.expectedEndAt?.toISOString() ?? undefined,
        needsOperatorAction: effective.needsOperatorAction,
        overdueMinutes: effective.overdueMinutes,
        isCountingAhead: effective.isCountingAhead,
        isBlockingAvailability: effective.isBlockingAvailability,
      });
    }

    timeline.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );

    let nextAvailableAt: string | null = null;
    if (timeline.length > 0) {
      nextAvailableAt = timeline[timeline.length - 1].endTime;
    } else if (workStart) {
      // Anchor to Cairo wall clock so overnight HH:MM (01:05) formats as AM, not shifted local time.
      const hhmm = workStart.length === 5 ? `${workStart}:00` : workStart;
      nextAvailableAt = new Date(`${dateStr}T${hhmm}+03:00`).toISOString();
    }

    const effectiveWaitingCount = timeline.filter(
      (t) => t.type === 'queue' && t.isCountingAhead && t.actualStatus === 'waiting',
    ).length;
    const displayedBookingsCount = timeline.filter((t) => t.type === 'booking').length;

    barbers.push({
      empId,
      empName: barber.EmpName,
      status: (dayStatus?.currentAvailabilityStatus as FlowBoardBarber['status']) ?? 'working',
      ...statusFields,
      ...branchFields,
      workStart,
      workEnd,
      isOvernightShift: isOvernight,
      isEmergencyTransfer: transferBadge,
      nextAvailableAt,
      waitingCount: effectiveWaitingCount,
      bookingsCount: displayedBookingsCount,
      inServiceCount,
      timeline,
    });
  }

  barbers.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));

  return { barbers, branch: branchMeta };
}
