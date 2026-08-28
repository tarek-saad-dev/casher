/**
 * Move Abdou (EmpID 1192) attendance + payroll from Camp Caesar → Gleem
 * for August 2026 from day 15 through today (2026-08-28).
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const EMP_ID = 1192;
const FROM_BRANCH = 3; // كامب شيزار
const TO_BRANCH = 1; // جليم
const FROM = '2026-08-15';
const TO = '2026-08-28';
const REASON = 'نقل حضور ويوميات عبدو من كامب شيزار إلى جليم — أغسطس 2026';

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const day = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${mo}-${day}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { relocateEmployeeDayBranch, previewRelocateEmployeeDayBranch } = await import(
    '@/lib/hr/relocateEmployeeDayBranch'
  );

  const db = await getPool();
  const actorRes = await db.request().query(`
    SELECT TOP 1 UserID FROM dbo.TblUser
    WHERE ISNULL(isDeleted, 0) = 0
    ORDER BY CASE WHEN UserLevel IN (N'Admin', N'admin', N'1') THEN 0 ELSE 1 END, UserID
  `);
  const actorUserId = Number(actorRes.recordset[0]?.UserID);
  if (!Number.isFinite(actorUserId) || actorUserId <= 0) {
    throw new Error('لا يوجد مستخدم للتنفيذ');
  }

  const dates = eachDateInclusive(FROM, TO);
  const summary = {
    relocated: 0,
    skippedNoData: 0,
    skippedBlockers: [] as string[],
    failures: [] as string[],
    movedAttendance: 0,
    movedPayroll: 0,
  };

  console.log(`Abdou EmpID=${EMP_ID} CC(${FROM_BRANCH}) → Gleem(${TO_BRANCH}) ${FROM}→${TO}`);

  for (const workDate of dates) {
    const preview = await previewRelocateEmployeeDayBranch({
      empId: EMP_ID,
      workDate,
      fromBranchId: FROM_BRANCH,
      toBranchId: TO_BRANCH,
    });

    if (!preview.ok) {
      const codes = preview.blockers.map((b) => b.code).join(',');
      if (codes.includes('RELOCATE_NOTHING_TO_MOVE')) {
        summary.skippedNoData++;
        console.log(`SKIP no data ${workDate}`);
        continue;
      }
      summary.skippedBlockers.push(`${workDate}: ${preview.blockers.map((b) => b.message).join(' · ')}`);
      console.log(`SKIP blocked ${workDate}: ${preview.blockers.map((b) => b.message).join(' · ')}`);
      continue;
    }

    try {
      const result = await relocateEmployeeDayBranch({
        empId: EMP_ID,
        workDate,
        fromBranchId: FROM_BRANCH,
        toBranchId: TO_BRANCH,
        reason: REASON,
        actorUserId,
      });
      summary.relocated++;
      summary.movedAttendance += result.moved.attendance;
      summary.movedPayroll += result.moved.payroll;
      console.log(
        `OK ${workDate} att=${result.moved.attendance} pay=${result.moved.payroll} targets=${result.moved.targets}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failures.push(`${workDate}: ${msg}`);
      console.error(`FAIL ${workDate}: ${msg}`);
    }
  }

  // Update branch assignment: CC → Gleem (effective from Aug 15)
  const assignRes = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('fromBranch', sql.Int, FROM_BRANCH)
    .input('toBranch', sql.Int, TO_BRANCH)
    .input('effectiveFrom', sql.Date, FROM)
    .query(`
      SELECT TOP 1 ID AS AssignmentID, BranchID, EffectiveFrom, EffectiveTo
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @fromBranch
        AND EffectiveFrom <= @effectiveFrom
        AND (EffectiveTo IS NULL OR EffectiveTo >= @effectiveFrom)
      ORDER BY EffectiveFrom DESC
    `);
  const assignRow = assignRes.recordset[0] as
    | { AssignmentID: number; BranchID: number; EffectiveFrom: Date; EffectiveTo: Date | null }
    | undefined;

  if (assignRow) {
    await db
      .request()
      .input('id', sql.Int, assignRow.AssignmentID)
      .input('effectiveTo', sql.Date, '2026-08-14')
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET EffectiveTo = @effectiveTo, UpdatedAt = SYSDATETIME()
        WHERE ID = @id
      `);
    console.log(`ASSIGN closed CC assignment ${assignRow.AssignmentID} → 2026-08-14`);
  }

  const gleemAssign = await db
    .request()
    .input('empId', sql.Int, EMP_ID)
    .input('toBranch', sql.Int, TO_BRANCH)
    .input('effectiveFrom', sql.Date, FROM)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @toBranch AND EffectiveFrom = @effectiveFrom
    `);
  if (!gleemAssign.recordset[0]) {
    await db
      .request()
      .input('empId', sql.Int, EMP_ID)
      .input('toBranch', sql.Int, TO_BRANCH)
      .input('effectiveFrom', sql.Date, FROM)
      .query(`
        INSERT INTO dbo.TblEmpBranchAssignment (EmpID, BranchID, EffectiveFrom, EffectiveTo, CreatedAt)
        VALUES (@empId, @toBranch, @effectiveFrom, NULL, SYSDATETIME())
      `);
    console.log(`ASSIGN created Gleem from ${FROM}`);
  } else {
    console.log('ASSIGN Gleem already exists');
  }

  const verify2 = await db.request().query(`
    SELECT 'CC_ATT' AS kind, COUNT(*) AS cnt FROM dbo.TblEmpAttendance
      WHERE EmpID=${EMP_ID} AND BranchID=3 AND WorkDate>='${FROM}' AND WorkDate<='${TO}'
    UNION ALL
    SELECT 'GLEEM_ATT', COUNT(*) FROM dbo.TblEmpAttendance
      WHERE EmpID=${EMP_ID} AND BranchID=1 AND WorkDate>='${FROM}' AND WorkDate<='${TO}'
    UNION ALL
    SELECT 'CC_PAY', COUNT(*) FROM dbo.TblEmpDailyPayroll
      WHERE EmpID=${EMP_ID} AND BranchID=3 AND WorkDate>='${FROM}' AND WorkDate<='${TO}'
    UNION ALL
    SELECT 'GLEEM_PAY', COUNT(*) FROM dbo.TblEmpDailyPayroll
      WHERE EmpID=${EMP_ID} AND BranchID=1 AND WorkDate>='${FROM}' AND WorkDate<='${TO}'
  `);

  const gleemDays = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS WorkDate,
      CONVERT(varchar(5), CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), CheckOutTime, 108) AS CheckOut,
      p.DailyWage, p.ActualHours
    FROM dbo.TblEmpAttendance a
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID=a.EmpID AND p.BranchID=a.BranchID AND p.WorkDate=a.WorkDate
    WHERE a.EmpID=${EMP_ID} AND a.BranchID=1
      AND a.WorkDate>='${FROM}' AND a.WorkDate<='${TO}'
    ORDER BY a.WorkDate
  `);

  console.log('\n=== COUNTS ===');
  console.table(verify2.recordset);
  console.log('\n=== GLEEM DAYS ===');
  console.table(gleemDays.recordset);
  console.log('\n=== SUMMARY ===');
  console.log(summary);

  process.exit(summary.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
