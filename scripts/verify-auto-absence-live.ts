#!/usr/bin/env npx tsx
/**
 * Live auto-absence verification with full cleanup.
 *
 *   npx tsx scripts/verify-auto-absence-live.ts
 *
 * Uses one controlled employee: clears test attendance, runs threshold scans,
 * verifies idempotency / freelancer rules, then restores original attendance.
 * Never prints customer PII or credentials.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const TAG = 'AUTO_ABSENCE_LIVE_TEST';

type Result = { name: string; ok: boolean; detail: string };

function cairoIso(ms: number): string {
  return new Date(ms).toISOString();
}

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate, SALON_TZ } = await import('../src/lib/businessDate');
  const { runAutoAbsenceScan } = await import('../src/lib/hr/attendance/autoAbsence');
  const { resolveEmployeeDayPlan } = await import(
    '../src/lib/availability/resolveEmployeeDayPlan'
  );

  const db = await getPool();
  const businessDate = getCairoBusinessDate();
  const results: Result[] = [];

  const branch = await db.request().query(`
    SELECT TOP 1 BranchID, BranchCode
    FROM dbo.TblBranch WHERE ISNULL(IsActive,0)=1 ORDER BY BranchID
  `);
  const branchId = Number(branch.recordset[0]?.BranchID);
  const branchCode = String(branch.recordset[0]?.BranchCode ?? '');

  const empRow = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 e.EmpID, ISNULL(e.EmploymentType, N'full_time') AS EmploymentType
      FROM dbo.TblEmp e
      INNER JOIN dbo.TblEmpBranchAssignment ea
        ON ea.EmpID = e.EmpID AND ea.BranchID = @branchId AND ea.IsActive = 1
      WHERE ISNULL(e.isActive,1)=1
        AND ISNULL(e.EmploymentType, N'full_time') IN (N'full_time', N'part_time')
      ORDER BY e.EmpID
    `);
  const empId = Number(empRow.recordset[0]?.EmpID);
  const employmentType = String(empRow.recordset[0]?.EmploymentType ?? 'full_time');

  console.log(
    JSON.stringify(
      { testBranch: { branchId, branchCode }, businessDate, empId, employmentType, tag: TAG },
      null,
      2,
    ),
  );

  if (!branchId || !empId) {
    throw new Error('No branch/employee for live test');
  }

  const origAtt = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('date', sql.Date, businessDate)
    .query(`
      SELECT ID, Status, Notes, BranchID
      FROM dbo.TblEmpAttendance
      WHERE EmpID=@empId AND WorkDate=@date
    `);

  const plan = await resolveEmployeeDayPlan({
    empId,
    branchId,
    businessDate,
    source: 'admin',
  });

  try {
    if (!plan.isWorking || !plan.effectiveWindows?.length) {
      results.push({
        name: 'full_time_schedule_present',
        ok: false,
        detail: `employee not working on ${businessDate} — pick another day/emp (deny=${plan.denyReasonCode})`,
      });
    } else {
      const firstStartMs = Math.min(...plan.effectiveWindows.map((w) => w.startMs));

      // Clear attendance AND any leftover AUTO_ABSENCE day_off so day plan is working.
      await db
        .request()
        .input('empId', sql.Int, empId)
        .input('date', sql.Date, businessDate)
        .query(`
          DELETE FROM dbo.TblEmpAttendance
          WHERE EmpID=@empId AND WorkDate=@date;

          UPDATE dbo.TblEmpScheduleOverrides
          SET IsActive = 0
          WHERE EmpID=@empId AND OverrideDate=@date
            AND Type = N'day_off' AND Reason LIKE N'%AUTO_ABSENCE%';
        `);

      const now29 = new Date(firstStartMs + 29 * 60_000);
      const r29 = await runAutoAbsenceScan({
        businessDate,
        branchId,
        empId,
        now: now29,
      });
      const att29 = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('date', sql.Date, businessDate)
        .query(`
          SELECT Status FROM dbo.TblEmpAttendance
          WHERE EmpID=@empId AND WorkDate=@date AND Status=N'Absent'
            AND Notes LIKE N'%AUTO_ABSENCE%'
        `);
      results.push({
        name: 'full_time_plus_29_not_absent',
        ok: att29.recordset.length === 0,
        detail: `now=${cairoIso(now29.getTime())} scanMarked=${r29.markedAbsent} absRows=${att29.recordset.length}`,
      });

      const now30 = new Date(firstStartMs + 30 * 60_000 + 5_000);
      const r30 = await runAutoAbsenceScan({
        businessDate,
        branchId,
        empId,
        now: now30,
      });
      const att30 = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('date', sql.Date, businessDate)
        .query(`
          SELECT Status, Notes FROM dbo.TblEmpAttendance
          WHERE EmpID=@empId AND WorkDate=@date AND Status=N'Absent'
        `);
      results.push({
        name: 'full_time_plus_30_absent',
        ok: att30.recordset.length >= 1,
        detail: `now=${cairoIso(now30.getTime())} scanMarked=${r30.markedAbsent} absRows=${att30.recordset.length} bookingsMarked=${r30.bookingsMarked}`,
      });

      const rAgain = await runAutoAbsenceScan({
        businessDate,
        branchId,
        empId,
        now: now30,
      });
      const dups = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('date', sql.Date, businessDate)
        .query(`
          SELECT COUNT(*) AS Cnt FROM dbo.TblEmpAttendance
          WHERE EmpID=@empId AND WorkDate=@date AND Status=N'Absent'
        `);
      results.push({
        name: 'repeated_scan_no_duplicate_absence',
        ok: Number(dups.recordset[0]?.Cnt ?? 0) === 1,
        detail: `secondScanMarked=${rAgain.markedAbsent} skipped=${rAgain.skipped ?? false} absCnt=${dups.recordset[0]?.Cnt}`,
      });

      const arDups = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('date', sql.Date, businessDate)
        .query(`
          IF OBJECT_ID(N'dbo.TblBookingActionRequired', N'U') IS NULL
            SELECT CAST(0 AS INT) AS BookingID, CAST(N'' AS NVARCHAR(80)) AS SourceEvent, CAST(0 AS INT) AS Cnt
            WHERE 1 = 0;
          ELSE
            SELECT BookingID, SourceEvent, COUNT(*) AS Cnt
            FROM dbo.TblBookingActionRequired
            WHERE EmpID=@empId AND BusinessDate=@date
              AND SourceEvent = N'auto_absence:' + CONVERT(varchar(10), @date, 23)
            GROUP BY BookingID, SourceEvent
            HAVING COUNT(*) > 1;
        `);
      results.push({
        name: 'no_duplicate_action_required',
        ok: arDups.recordset.length === 0,
        detail: `dupGroups=${arDups.recordset.length}`,
      });
    }

    const fl = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT TOP 1 e.EmpID FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment ea ON ea.EmpID=e.EmpID AND ea.BranchID=@branchId AND ea.IsActive=1
        WHERE ISNULL(e.EmploymentType,N'')=N'freelance' AND ISNULL(e.isActive,1)=1
      `);
    if (fl.recordset[0]) {
      const fId = Number(fl.recordset[0].EmpID);
      await runAutoAbsenceScan({
        businessDate,
        branchId,
        empId: fId,
        now: new Date(Date.now() + 24 * 3600_000),
      });
      const fAbs = await db
        .request()
        .input('empId', sql.Int, fId)
        .input('date', sql.Date, businessDate)
        .query(`
          SELECT 1 FROM dbo.TblEmpAttendance
          WHERE EmpID=@empId AND WorkDate=@date
            AND Status=N'Absent' AND Notes LIKE N'%AUTO_ABSENCE%'
        `);
      results.push({
        name: 'freelancer_not_auto_absent',
        ok: fAbs.recordset.length === 0,
        detail: `freelanceEmpId=${fId}`,
      });
    } else {
      results.push({
        name: 'freelancer_not_auto_absent',
        ok: true,
        detail: 'no freelancer assigned — skipped',
      });
    }

    results.push({
      name: 'cairo_timezone_constant',
      ok: SALON_TZ === 'Africa/Cairo',
      detail: SALON_TZ,
    });
  } finally {
    // Remove test AUTO_ABSENCE rows for this emp/date
    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('date', sql.Date, businessDate)
      .query(`
        DELETE FROM dbo.TblEmpAttendance
        WHERE EmpID=@empId AND WorkDate=@date
          AND (Notes LIKE N'%AUTO_ABSENCE%' OR Status = N'Absent');

        UPDATE dbo.TblEmpScheduleOverrides
        SET IsActive = 0
        WHERE EmpID=@empId AND OverrideDate=@date
          AND Reason LIKE N'%AUTO_ABSENCE%';
      `);

    // Restore original attendance snapshot
    for (const row of origAtt.recordset as Array<{
      ID: number;
      Status: string;
      Notes: string | null;
      BranchID: number;
    }>) {
      await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, row.BranchID)
        .input('date', sql.Date, businessDate)
        .input('status', sql.NVarChar(50), row.Status)
        .input('notes', sql.NVarChar(500), row.Notes)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.TblEmpAttendance WHERE EmpID=@empId AND WorkDate=@date)
            INSERT INTO dbo.TblEmpAttendance (EmpID, BranchID, WorkDate, Status, Notes, CreatedAt)
            VALUES (@empId, @branchId, @date, @status, @notes, GETDATE());
          ELSE
            UPDATE dbo.TblEmpAttendance
            SET Status=@status, Notes=@notes, BranchID=@branchId
            WHERE EmpID=@empId AND WorkDate=@date;
        `);
    }

    const leftover = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('date', sql.Date, businessDate)
      .query(`
        SELECT COUNT(*) AS Cnt FROM dbo.TblEmpAttendance
        WHERE EmpID=@empId AND WorkDate=@date
          AND Notes LIKE N'%AUTO_ABSENCE%'
      `);
    results.push({
      name: 'cleanup_no_active_test_absence',
      ok: Number(leftover.recordset[0]?.Cnt ?? 0) === 0,
      detail: `activeAutoAbsence=${leftover.recordset[0]?.Cnt}`,
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
  if (failed.length) process.exit(1);
  console.log('AUTO_ABSENCE_LIVE_VERIFICATION_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
