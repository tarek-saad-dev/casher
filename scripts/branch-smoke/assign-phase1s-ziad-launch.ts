/**
 * Phase 1S — assign real GLEEM barber زياد (#12) to Camp Caesar launch roster.
 * Friday only (GLEEM Fri=OFF). Explicit GLEEM hourly rate. Explicit NO_TARGET.
 * Does not invent salary/target values.
 */
import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const { commitEmployeeBranchAssignment } = await import(
    '../../src/lib/branch/employeeAssignmentCommit'
  );
  const { loadBookableServiceCatalog } = await import('../../src/lib/branch/launchRosterService');
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');

  const EMP_ID = 12; // زياد — GLEEM Fri=OFF
  const BRANCH_ID = 3;
  const ACTOR = 10;
  const EFFECTIVE = '2026-07-27';
  // Explicit confirmed copy of current GLEEM plan (probe 2026-07-27) — not invented
  const HOURLY = 27.2727;

  const db = await getPool();
  const emp = await db
    .request()
    .input('e', sql.Int, EMP_ID)
    .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID=@e AND ISNULL(isActive,1)=1`);
  if (!emp.recordset[0]) throw new Error('Employee 12 not found/active');
  console.log('Assigning', emp.recordset[0].EmpName);

  const gleemPay = await db.request().input('e', sql.Int, EMP_ID).query(`
    SELECT TOP 1 PayType, HourlyRate FROM dbo.TblEmpBranchPayrollPlan
    WHERE EmpID=@e AND BranchID=1 AND IsActive=1 ORDER BY EffectiveFrom DESC
  `);
  const gp = gleemPay.recordset[0];
  if (!gp || String(gp.PayType) !== 'hourly' || Number(gp.HourlyRate) !== HOURLY) {
    throw new Error(
      `Refusing assign: GLEEM plan mismatch expected hourly ${HOURLY}, got ${JSON.stringify(gp)}`,
    );
  }

  const services = await loadBookableServiceCatalog();
  if (!services.length) throw new Error('No bookable services');
  const serviceProIds = services.map((s) => s.proId);

  const schedule = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isWorkingDay: dayOfWeek === 5, // Friday only
    startTime: dayOfWeek === 5 ? '11:00' : null,
    endTime: dayOfWeek === 5 ? '01:30' : null,
  }));

  const result = await commitEmployeeBranchAssignment({
    empId: EMP_ID,
    branchId: BRANCH_ID,
    effectiveFrom: EFFECTIVE,
    canOperate: true,
    canReceiveBookings: true,
    isHomeBranch: false,
    schedule,
    serviceProIds,
    payroll: {
      payType: 'hourly',
      hourlyRate: HOURLY,
      effectiveFrom: EFFECTIVE,
    },
    target: {
      policy: 'NO_TARGET',
      notes: 'NO_TARGET — إطلاق كامب شيزار (قرار صريح)',
    },
    actorUserId: ACTOR,
  });

  console.log('commit result', result);
  const readiness = await evaluateBranchReadiness(BRANCH_ID);
  console.log(
    JSON.stringify(
      {
        assignmentId: result.assignmentId,
        payrollPlanId: result.payrollPlanId,
        targetPolicy: result.targetPolicy,
        score: readiness.score,
        isReadyForInternalLive: readiness.isReadyForInternalLive,
        remainingInternal: readiness.blockers
          .filter((b) => b.requiredFor.includes('internal_live'))
          .map((b) => b.key),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
