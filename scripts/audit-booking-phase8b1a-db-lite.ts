#!/usr/bin/env npx tsx
/**
 * Phase 8B1A — lightweight DB operational readiness audit (GLEEM).
 * BOOKING_PHASE_8B1A_DB=enabled npx tsx scripts/audit-booking-phase8b1a-db-lite.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (process.env.BOOKING_PHASE_8B1A_DB !== 'enabled') {
    console.log('Set BOOKING_PHASE_8B1A_DB=enabled to run.');
    process.exit(2);
  }

  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { evaluateServiceEligibility } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const { isEmployeeHiddenFromPublicBooking } = await import(
    '../src/lib/hr/testEmployeePolicy'
  );
  const { resolveEmployeeGlobalSchedule } = await import(
    '../src/lib/hr/employeeBranchScheduleResolver'
  );

  const db = await getPool();
  const today = getCairoBusinessDate();
  const horizonEnd = addDays(today, 13);

  const gleem = (
    await db.request().query(`
      SELECT TOP 1 BranchID, BranchCode, BranchName, LifecycleStatus,
        CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(IsActive,0) AS BIT) AS IsActive
      FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'
    `)
  ).recordset[0];
  const camp = (
    await db.request().query(`
      SELECT TOP 1 BranchID, BranchCode, LifecycleStatus,
        CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(IsActive,0) AS BIT) AS IsActive
      FROM dbo.TblBranch WHERE BranchCode=N'CAMP_CAESAR'
    `)
  ).recordset[0];

  const qbs = (
    await db
      .request()
      .input('id', sql.Int, Number(gleem.BranchID))
      .query(`
        SELECT TOP 1
          CAST(ISNULL(BookingEnabled,0) AS BIT) AS BookingEnabled,
          ISNULL(MaxBookingDaysAhead,14) AS MaxBookingDaysAhead,
          ISNULL(MinNoticeMinutes,0) AS MinNoticeMinutes,
          ISNULL(SlotIntervalMinutes,15) AS SlotIntervalMinutes
        FROM dbo.QueueBookingSettings WHERE BranchID=@id
      `)
  ).recordset[0];

  const rawServices = (
    await db.request().query(`
      SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
             ISNULL(p.isDeleted,0) AS isDeleted, ISNULL(p.ProType,N'') AS ProType,
             p.CatID, c.CatName
      FROM dbo.TblPro p
      LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
      WHERE ISNULL(p.isDeleted,0)=0
      ORDER BY p.ProID
    `)
  ).recordset;

  const eligible = [];
  const rejectReasons: Record<string, number> = {};
  for (const row of rawServices) {
    const ev = evaluateServiceEligibility(row);
    if (ev.eligible && ev.price != null && ev.durationMinutes != null) {
      eligible.push({
        serviceId: Number(row.ProID),
        nameAr: String(row.ProNameAr ?? row.ProName ?? '').slice(0, 60),
        price: ev.price,
        durationMinutes: ev.durationMinutes,
        category: String(row.CatName ?? ''),
      });
    } else {
      rejectReasons[ev.reason] = (rejectReasons[ev.reason] ?? 0) + 1;
    }
  }

  const candidates = (
    await db
      .request()
      .input('day', sql.Date, today)
      .input('branchId', sql.Int, Number(gleem.BranchID))
      .query(`
        SELECT e.EmpID, e.EmpName, e.Job,
               a.EffectiveFrom, a.EffectiveTo,
               CAST(ISNULL(a.CanReceiveBookings,0) AS BIT) AS CanReceiveBookings
        FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID=e.EmpID
        WHERE a.BranchID=@branchId AND a.IsActive=1
          AND ISNULL(e.isActive,1)=1
          AND a.EffectiveFrom <= @day
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
          AND a.CanReceiveBookings=1
          AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
        ORDER BY e.EmpID
      `)
  ).recordset;

  const barbers = candidates.map((c: Record<string, unknown>) => {
    const name = String(c.EmpName ?? '');
    return {
      empId: Number(c.EmpID),
      displayName: name.slice(0, 40),
      job: String(c.Job ?? ''),
      hidden: isEmployeeHiddenFromPublicBooking(name),
      canReceiveBookings: Boolean(c.CanReceiveBookings),
    };
  });
  const publicBarbers = barbers.filter((b) => !b.hidden);

  // Batch day-offs + overrides for horizon
  let dayOffs: Array<{ EmpID: number; OffDate: Date | string }> = [];
  try {
    dayOffs = (
      await db
        .request()
        .input('from', sql.Date, today)
        .input('to', sql.Date, horizonEnd)
        .query(`
          SELECT EmpID, OffDate
          FROM dbo.TblEmpDayOff
          WHERE ISNULL(IsDeleted,0)=0 AND OffDate BETWEEN @from AND @to
        `)
    ).recordset;
  } catch {
    dayOffs = [];
  }

  let overrides: Array<{ EmpID: number; OverrideDate: Date | string }> = [];
  try {
    overrides = (
      await db
        .request()
        .input('from', sql.Date, today)
        .input('to', sql.Date, horizonEnd)
        .query(`
          SELECT EmpID, OverrideDate
          FROM dbo.TblEmpScheduleOverrides
          WHERE IsActive=1 AND Type=N'day_off'
            AND OverrideDate BETWEEN @from AND @to
        `)
    ).recordset;
  } catch {
    overrides = [];
  }

  // Weekly schedule presence at GLEEM
  const schedules = (
    await db
      .request()
      .input('branchId', sql.Int, Number(gleem.BranchID))
      .query(`
        SELECT EmpID, DayOfWeek, IsWorking, StartTime, EndTime,
               CAST(ISNULL(CanReceiveBookings,1) AS BIT) AS CanReceiveBookings
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE BranchID=@branchId AND IsActive=1
      `)
  ).recordset as Array<{
    EmpID: number;
    DayOfWeek: number;
    IsWorking: boolean | number;
    StartTime: unknown;
    EndTime: unknown;
  }>;

  const leaveSet = new Set(
    dayOffs.map((d) => `${Number(d.EmpID)}:${String(d.OffDate).slice(0, 10)}`),
  );
  for (const o of overrides) {
    leaveSet.add(`${Number(o.EmpID)}:${String(o.OverrideDate).slice(0, 10)}`);
  }

  const scheduleMap = new Map<string, boolean>();
  for (const s of schedules) {
    scheduleMap.set(
      `${Number(s.EmpID)}:${Number(s.DayOfWeek)}`,
      Boolean(s.IsWorking),
    );
  }

  const dayMatrix = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    let working = 0;
    let onLeave = 0;
    let noSchedule = 0;
    const workingIds: number[] = [];
    const leaveIds: number[] = [];
    for (const b of publicBarbers) {
      if (leaveSet.has(`${b.empId}:${date}`)) {
        onLeave += 1;
        leaveIds.push(b.empId);
        continue;
      }
      const schedWorking = scheduleMap.get(`${b.empId}:${dow}`);
      if (schedWorking) {
        working += 1;
        workingIds.push(b.empId);
      } else {
        noSchedule += 1;
      }
    }
    dayMatrix.push({
      date,
      dow,
      publicBarberCount: publicBarbers.length,
      workingByWeeklySchedule: working,
      onLeaveOrDayOff: onLeave,
      noWeeklyWorkingSchedule: noSchedule,
      workingEmpIds: workingIds,
      leaveEmpIds: leaveIds,
      capacityHint:
        working > 0
          ? 'possible'
          : onLeave === publicBarbers.length
            ? 'all_on_leave'
            : 'no_weekly_schedule',
    });
  }

  // Spot-check resolver skipped by default (expensive). Enable with BOOKING_PHASE_8B1A_RESOLVER_SPOT=1
  const spotChecks = [];
  if (process.env.BOOKING_PHASE_8B1A_RESOLVER_SPOT === '1') {
    const sampleEmp = publicBarbers[0];
    if (sampleEmp) {
      for (let i = 0; i < 3; i++) {
        const date = addDays(today, i);
        const g = await resolveEmployeeGlobalSchedule({
          empId: sampleEmp.empId,
          workDate: date,
          publicOnly: false,
        });
        spotChecks.push({
          empId: sampleEmp.empId,
          date,
          isGlobalDayOff: g.isGlobalDayOff,
          isGloballyWorking: g.isGloballyWorking,
          branchCount: g.branches.length,
          branchIds: g.branches.map((b) => b.branchId),
        });
      }
    }
  }

  // If earlier probe saw global_leave for specific mode, also check days where matrix says all leave
  const allLeaveDates = dayMatrix.filter((d) => d.capacityHint === 'all_on_leave').map((d) => d.date);

  const out = {
    phase: 'booking-phase-8b1a-db-audit-lite',
    auditedAt: new Date().toISOString(),
    dbServerHint: 'from env DB_SERVER (redacted)',
    cairoBusinessDate: today,
    gleem: {
      branchId: Number(gleem.BranchID),
      branchCode: String(gleem.BranchCode),
      lifecycleStatus: String(gleem.LifecycleStatus),
      publicBookingEnabled: Boolean(gleem.PublicBookingEnabled),
      isActive: Boolean(gleem.IsActive),
      qbsBookingEnabled: Boolean(qbs?.BookingEnabled),
      maxBookingDaysAhead: Number(qbs?.MaxBookingDaysAhead ?? 14),
      minNoticeMinutes: Number(qbs?.MinNoticeMinutes ?? 0),
      slotIntervalMinutes: Number(qbs?.SlotIntervalMinutes ?? 15),
    },
    campCaesar: camp
      ? {
          branchId: Number(camp.BranchID),
          lifecycleStatus: String(camp.LifecycleStatus),
          publicBookingEnabled: Boolean(camp.PublicBookingEnabled),
          isActive: Boolean(camp.IsActive),
        }
      : null,
    services: {
      rawActiveCount: rawServices.length,
      eligiblePublicCount: eligible.length,
      rejectReasons,
      sample: eligible.slice(0, 20),
      zeroDuration: eligible.filter((s) => s.durationMinutes <= 0).length,
      missingPrice: eligible.filter((s) => !Number.isFinite(s.price)).length,
      duplicateIds: eligible
        .map((s) => s.serviceId)
        .filter((id, i, arr) => arr.indexOf(id) !== i),
    },
    barbers: {
      assignmentCandidateCount: candidates.length,
      publicVisibleCount: publicBarbers.length,
      hiddenCount: barbers.filter((b) => b.hidden).length,
      list: publicBarbers,
    },
    dayOffCountInHorizon: dayOffs.length,
    overrideDayOffCount: overrides.length,
    dayMatrix,
    allLeaveDates,
    resolverSpotChecks: spotChecks,
    operationalBlocker: !Boolean(qbs?.BookingEnabled)
      ? 'QueueBookingSettings.BookingEnabled=0 → public discovery empty, services/barbers 409 BRANCH_BOOKING_DISABLED, config BOOKING_PAUSED'
      : null,
  };

  const outPath = path.join(__dirname, '..', '_booking-phase8b1a-db-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        wrote: outPath,
        today,
        bookingEnabled: out.gleem.qbsBookingEnabled,
        lifecycle: out.gleem.lifecycleStatus,
        publicBookingEnabled: out.gleem.publicBookingEnabled,
        eligibleServices: out.services.eligiblePublicCount,
        publicBarbers: out.barbers.publicVisibleCount,
        daysPossible: dayMatrix.filter((d) => d.capacityHint === 'possible').length,
        daysAllLeave: dayMatrix.filter((d) => d.capacityHint === 'all_on_leave').length,
        daysNoSchedule: dayMatrix.filter((d) => d.capacityHint === 'no_weekly_schedule').length,
        blocker: out.operationalBlocker,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
