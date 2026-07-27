#!/usr/bin/env npx tsx
/**
 * Phase 8B1A — DB operational readiness audit (GLEEM).
 * BOOKING_PHASE_8B1A_DB=enabled npx tsx scripts/audit-booking-phase8b1a-db.ts
 *
 * Does not enable booking. Read-only.
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
  const { resolveEmployeeGlobalSchedule } = await import(
    '../src/lib/hr/employeeBranchScheduleResolver'
  );
  const { evaluateServiceEligibility } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );
  const { isEmployeeHiddenFromPublicBooking } = await import(
    '../src/lib/hr/testEmployeePolicy'
  );

  const db = await getPool();
  const today = getCairoBusinessDate();

  const branch = (
    await db.request().query(`
      SELECT TOP 1
        BranchID, BranchCode, BranchName, LifecycleStatus,
        CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(IsActive,0) AS BIT) AS IsActive
      FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `)
  ).recordset[0];

  const camp = (
    await db.request().query(`
      SELECT TOP 1
        BranchID, BranchCode, LifecycleStatus,
        CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(IsActive,0) AS BIT) AS IsActive
      FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR'
    `)
  ).recordset[0];

  const qbs = (
    await db
      .request()
      .input('id', sql.Int, Number(branch.BranchID))
      .query(`
        SELECT TOP 1
          CAST(ISNULL(BookingEnabled,0) AS BIT) AS BookingEnabled,
          ISNULL(MaxBookingDaysAhead, 14) AS MaxBookingDaysAhead,
          ISNULL(MinNoticeMinutes, 0) AS MinNoticeMinutes,
          ISNULL(SlotIntervalMinutes, 15) AS SlotIntervalMinutes
        FROM dbo.QueueBookingSettings WHERE BranchID=@id
      `)
  ).recordset[0];

  // Service catalog via canonical public loader (bypass bookingEnabled gate)
  const { getPublicBookingServicesCatalog, invalidatePublicBookingServicesCache } =
    await import('../src/lib/booking/publicBookingServices');
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );

  // Resolve branch context with internal purpose if public booking is paused
  let catalogCount = 0;
  let catalogServices: Array<{
    serviceId: number;
    nameAr: string;
    price: number;
    durationMinutes: number;
    categoryId: string;
  }> = [];
  let catalogError: string | null = null;
  try {
    invalidatePublicBookingServicesCache('GLEEM');
    // Use raw SQL eligibility path mirroring public catalog
    const { loadRawServiceRowsForAudit } = await import(
      '../src/lib/booking/publicBookingServices'
    ).catch(() => ({ loadRawServiceRowsForAudit: null }));
    void loadRawServiceRowsForAudit;

    const raw = await db.request().query(`
      SELECT
        p.ProID,
        p.ProName,
        p.ProNameAr,
        p.SPrice1,
        p.DurationMinutes,
        ISNULL(p.isDeleted, 0) AS isDeleted,
        ISNULL(p.ProType, N'') AS ProType,
        p.CatID,
        c.CatName
      FROM dbo.TblPro p
      LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
      WHERE ISNULL(p.isDeleted,0)=0
      ORDER BY p.ProID
    `);
    for (const row of raw.recordset) {
      const ev = evaluateServiceEligibility(row);
      if (ev.eligible && ev.price != null && ev.durationMinutes != null) {
        catalogServices.push({
          serviceId: Number(row.ProID),
          nameAr: String(row.ProNameAr ?? row.ProName ?? ''),
          price: ev.price,
          durationMinutes: ev.durationMinutes,
          categoryId: row.CatID != null ? String(row.CatID) : 'uncategorized',
        });
      }
    }
    catalogCount = catalogServices.length;
  } catch (err) {
    catalogError = err instanceof Error ? err.message : String(err);
  }

  // Try canonical catalog through branch context (may fail when paused)
  let publicApiStyleCatalog: { ok: boolean; count: number; error?: string } = {
    ok: false,
    count: 0,
  };
  try {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode: 'GLEEM',
      purpose: 'public_booking',
    });
    if (ctx.bookingEnabled && ctx.publicBookingEnabled) {
      const cat = await getPublicBookingServicesCatalog(ctx);
      publicApiStyleCatalog = { ok: true, count: cat.meta.serviceCount };
    } else {
      publicApiStyleCatalog = {
        ok: false,
        count: 0,
        error: 'BRANCH_BOOKING_DISABLED_GATE',
      };
    }
  } catch (err) {
    publicApiStyleCatalog = {
      ok: false,
      count: 0,
      error: err instanceof Error ? (err as { code?: string }).code || err.message : String(err),
    };
  }

  // Public barber candidates at GLEEM
  const empRows = (
    await db
      .request()
      .input('branchId', sql.Int, Number(branch.BranchID))
      .input('today', sql.Date, today)
      .query(`
        SELECT DISTINCT
          e.EmpID,
          e.EmpName,
          CAST(ISNULL(e.isActive,1) AS BIT) AS isActive,
          a.EffectiveFrom,
          a.EffectiveTo,
          CAST(ISNULL(a.CanReceiveBookings,1) AS BIT) AS CanReceiveBookings
        FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment a
          ON a.EmpID = e.EmpID AND a.BranchID = @branchId AND a.IsActive = 1
         AND a.EffectiveFrom <= @today
         AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @today)
        WHERE ISNULL(e.isActive,1)=1
        ORDER BY e.EmpID
      `)
  ).recordset;

  const barbers = [];
  for (const e of empRows) {
    const empId = Number(e.EmpID);
    const name = String(e.EmpName ?? '');
    const hidden = isEmployeeHiddenFromPublicBooking(name);
    const next14 = [];
    for (let i = 0; i < 14; i++) {
      const date = addDays(today, i);
      const global = await resolveEmployeeGlobalSchedule({
        empId,
        workDate: date,
        publicOnly: false,
      });
      const publicGlobal = await resolveEmployeeGlobalSchedule({
        empId,
        workDate: date,
        publicOnly: true,
      });
      const atGleem = publicGlobal.branches.find(
        (b) => b.branchId === Number(branch.BranchID) && b.isWorking,
      );
      next14.push({
        date,
        isGlobalDayOff: global.isGlobalDayOff,
        isGloballyWorking: global.isGloballyWorking,
        publicWorkingBranchIds: publicGlobal.branches.map((b) => b.branchId),
        workingAtGleem: Boolean(atGleem),
        gleemWindow: atGleem
          ? { start: atGleem.startTime, end: atGleem.endTime }
          : null,
      });
    }
    const workingDays = next14.filter((d) => d.workingAtGleem).length;
    const leaveDays = next14.filter((d) => d.isGlobalDayOff).length;
    barbers.push({
      empId,
      displayName: name.slice(0, 40),
      active: Boolean(e.isActive),
      hiddenFromPublic: hidden,
      canReceiveBookings: Boolean(e.CanReceiveBookings),
      effectiveFrom: e.EffectiveFrom,
      effectiveTo: e.EffectiveTo,
      next14WorkingAtGleem: workingDays,
      next14GlobalLeave: leaveDays,
      nextWorkingDate: next14.find((d) => d.workingAtGleem)?.date ?? null,
      sampleDays: next14.slice(0, 5),
    });
  }

  // Day matrix aggregate (any public-visible non-hidden barber)
  const publicBarbers = barbers.filter((b) => !b.hiddenFromPublic && b.active);
  const dayMatrix = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i);
    let working = 0;
    let leave = 0;
    let other = 0;
    const leaveEmpIds: number[] = [];
    const workingEmpIds: number[] = [];
    for (const b of publicBarbers) {
      const g = await resolveEmployeeGlobalSchedule({
        empId: b.empId,
        workDate: date,
        publicOnly: true,
      });
      if (g.isGlobalDayOff) {
        leave += 1;
        leaveEmpIds.push(b.empId);
      } else if (g.branches.some((x) => x.branchId === Number(branch.BranchID) && x.isWorking)) {
        working += 1;
        workingEmpIds.push(b.empId);
      } else {
        other += 1;
      }
    }
    dayMatrix.push({
      date,
      publicBarberCount: publicBarbers.length,
      workingAtGleem: working,
      globalLeave: leave,
      otherUnavailable: other,
      workingEmpIds,
      leaveEmpIdsSample: leaveEmpIds.slice(0, 8),
      wouldBeGlobalLeaveIfSpecificOnly: working === 0 && leave > 0,
      anyBarberCapacity: working > 0 ? 'possible' : leave === publicBarbers.length ? 'all_global_leave' : 'no_working_at_gleem',
    });
  }

  // Active day-offs overlapping horizon
  let leaves: Array<{ empId: number; name: string; offDate: unknown }> = [];
  try {
    leaves = (
      await db
        .request()
        .input('from', sql.Date, today)
        .input('to', sql.Date, addDays(today, 13))
        .query(`
          SELECT TOP 200
            d.EmpID,
            e.EmpName,
            d.OffDate
          FROM dbo.TblEmpDayOff d
          LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
          WHERE ISNULL(d.IsDeleted,0)=0
            AND d.OffDate >= @from
            AND d.OffDate <= @to
          ORDER BY d.OffDate, d.EmpID
        `)
    ).recordset.map((r: Record<string, unknown>) => ({
      empId: Number(r.EmpID),
      name: String(r.EmpName ?? '').slice(0, 40),
      offDate: r.OffDate,
    }));
  } catch {
    leaves = [];
  }

  let overrideDayOffs: Array<{ empId: number; name: string; overrideDate: unknown }> = [];
  try {
    overrideDayOffs = (
      await db
        .request()
        .input('from', sql.Date, today)
        .input('to', sql.Date, addDays(today, 13))
        .query(`
          SELECT TOP 200
            o.EmpID,
            e.EmpName,
            o.OverrideDate
          FROM dbo.TblEmpScheduleOverrides o
          LEFT JOIN dbo.TblEmp e ON e.EmpID = o.EmpID
          WHERE o.IsActive = 1 AND o.Type = N'day_off'
            AND o.OverrideDate >= @from
            AND o.OverrideDate <= @to
          ORDER BY o.OverrideDate, o.EmpID
        `)
    ).recordset.map((r: Record<string, unknown>) => ({
      empId: Number(r.EmpID),
      name: String(r.EmpName ?? '').slice(0, 40),
      overrideDate: r.OverrideDate,
    }));
  } catch {
    overrideDayOffs = [];
  }

  const out = {
    phase: 'booking-phase-8b1a-db-audit',
    auditedAt: new Date().toISOString(),
    cairoBusinessDate: today,
    gleem: {
      branchId: Number(branch.BranchID),
      branchCode: String(branch.BranchCode),
      lifecycleStatus: String(branch.LifecycleStatus),
      publicBookingEnabled: Boolean(branch.PublicBookingEnabled),
      isActive: Boolean(branch.IsActive),
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
      eligiblePublicCount: catalogCount,
      catalogError,
      publicApiStyleCatalog,
      eligibleSample: catalogServices.slice(0, 15),
      duplicateIds: (() => {
        const ids = catalogServices.map((s) => s.serviceId);
        return ids.filter((id, i) => ids.indexOf(id) !== i);
      })(),
      zeroDuration: catalogServices.filter((s) => !s.durationMinutes || s.durationMinutes <= 0)
        .length,
      missingPrice: catalogServices.filter((s) => !Number.isFinite(s.price)).length,
    },
    barbers: {
      assignedActiveCount: empRows.length,
      publicVisibleCount: publicBarbers.length,
      hiddenCount: barbers.filter((b) => b.hiddenFromPublic).length,
      list: barbers.map((b) => ({
        empId: b.empId,
        displayName: b.displayName,
        hiddenFromPublic: b.hiddenFromPublic,
        canReceiveBookings: b.canReceiveBookings,
        next14WorkingAtGleem: b.next14WorkingAtGleem,
        next14GlobalLeave: b.next14GlobalLeave,
        nextWorkingDate: b.nextWorkingDate,
      })),
    },
    dayMatrix,
    approvedLeavesInHorizon: leaves.length,
    leaveSample: leaves.slice(0, 30),
    overrideDayOffSample: overrideDayOffs.slice(0, 30),
    overrideDayOffCount: overrideDayOffs.length,
    rootCauseHints: {
      bookingPaused: !Boolean(qbs?.BookingEnabled),
      publicBranchesEmptyWhenPaused: true,
      services409WhenPaused: 'BRANCH_BOOKING_DISABLED',
    },
  };

  const outPath = path.join(__dirname, '..', '_booking-phase8b1a-db-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        wrote: outPath,
        today,
        bookingEnabled: out.gleem.qbsBookingEnabled,
        publicBookingEnabled: out.gleem.publicBookingEnabled,
        lifecycle: out.gleem.lifecycleStatus,
        eligibleServices: out.services.eligiblePublicCount,
        publicBarbers: out.barbers.publicVisibleCount,
        daysAllLeave: dayMatrix.filter((d) => d.anyBarberCapacity === 'all_global_leave').length,
        daysWithCapacity: dayMatrix.filter((d) => d.anyBarberCapacity === 'possible').length,
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
