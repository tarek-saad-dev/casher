#!/usr/bin/env npx tsx
/**
 * DRVO-016 staging smoke — last132_agent / drvo_agent only.
 *
 * Two synthetic tenants each run the HR flow through the real services:
 *   create employee → record attendance → generate daily payroll → employee-ledger payout,
 * then prove isolation: neither tenant's branch sees, pays or summarises the other's employee,
 * and the tenant branch list never includes another tenant's (or CUT's) branches.
 * Full cleanup afterwards; CASHER_BOOT employee count unchanged.
 *
 * Never loads .env.local (it may point at production). Requires DRVO_STAGING_DB_PASSWORD.
 */
import Module from 'module';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, parent, isMain);
};

import sql from 'mssql';

const STAGING_DB = 'last132_agent';
const STAGING_LOGIN = 'drvo_agent';
const PRODUCTION_DB = 'last132';

const SMOKE_TENANTS = [
  { code: 'DRVO016_A', branch: 'DRVO016_ABR', login: 'drvo016_a_owner' },
  { code: 'DRVO016_B', branch: 'DRVO016_BBR', login: 'drvo016_b_owner' },
] as const;

const WORK_DATE = '2026-09-15';
const PAYROLL_MONTH = '2026-09';
const DAILY_RATE = 300;
const PAYOUT_AMOUNT = 50;

/** HR tables keyed by EmpID (no TenantId): cleaned by the smoke employees' ids. */
const EMP_KEYED_TABLES = [
  'TblEmpLedgerEntry',
  'TblEmpDailyTarget',
  'TblEmpDailyPayroll',
  'TblEmpAttendanceBreak',
  'TblEmpAttendance',
  'TblEmpBranchWorkSchedule',
  'TblEmpBranchPayrollPlan',
  'TblEmpWorkSchedule',
  'TblExpCatEmpMap',
  'TblEmpTemporaryBranchTransfer',
] as const;

const TENANT_TABLES = [
  'TblServicePackageItem',
  'TblServicePackage',
  'TblPro',
  'TblCat',
  'TblClient',
  'TblPaymentMethods',
  'TblExpINCat',
  'TblEmp',
] as const;

function forceStagingEnv(password: string) {
  const server = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: server,
    CLOUD_DB_PORT: port,
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: server,
    DB_PORT: port,
    DB_DATABASE: STAGING_DB,
    DB_USER: STAGING_LOGIN,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
    EMP_LEDGER_DUAL_WRITE_ENABLED: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function buildConfig(): sql.config {
  return {
    server: process.env.DB_SERVER || '',
    port: parseInt(process.env.DB_PORT || '14330', 10),
    database: process.env.DB_DATABASE || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  };
}

async function assertLiveDatabase(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login;`);
  const liveDb = String(result.recordset[0].db);
  const login = String(result.recordset[0].login);
  if (liveDb === PRODUCTION_DB) throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  if (liveDb !== STAGING_DB) throw new Error(`Refusing: expected ${STAGING_DB}, got ${liveDb}`);
  if (login.toLowerCase() !== STAGING_LOGIN) {
    throw new Error(`Refusing: expected login ${STAGING_LOGIN}, got ${login}`);
  }
  console.log(`  live database: ${liveDb} (${login})`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ok: ${message}`);
}

async function expectReject(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
  } catch (err) {
    check(true, `${message} (${err instanceof Error ? err.message : String(err)})`);
    return;
  }
  throw new Error(`${message}: expected a rejection, but it succeeded`);
}

async function bootEmployeeCount(pool: sql.ConnectionPool): Promise<number> {
  const r = await pool.request().query(`
    SELECT COUNT_BIG(*) AS cnt
    FROM dbo.TblEmp e WITH (NOLOCK)
    INNER JOIN dbo.Tenant t ON t.TenantId = e.TenantId
    WHERE t.Code = N'CASHER_BOOT';
  `);
  return Number(r.recordset[0].cnt);
}

async function deleteIfTable(tx: sql.Transaction, table: string, where: string, bind: (r: sql.Request) => void) {
  const r = new sql.Request(tx);
  bind(r);
  await r.query(`IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL DELETE FROM dbo.${table} WHERE ${where};`);
}

async function cleanupTenant(pool: sql.ConnectionPool, tenantCode: string): Promise<void> {
  // Covers tables added by later DRVO branches (master data, brand, messaging, HR, booking).
  const { purgeSmokeTenant } = await import('./smokeTenantPurge');
  if (await purgeSmokeTenant(pool, tenantCode)) {
    console.log(`  cleanup: removed ${tenantCode}`);
    return;
  }
  const tenant = await pool
    .request()
    .input('code', sql.NVarChar(64), tenantCode)
    .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code;`);
  if (!tenant.recordset.length) return;
  const tenantId = String(tenant.recordset[0].TenantId);

  const branchIds = (
    await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { LegacyBranchId: number }) => Number(r.LegacyBranchId));
  const userIds = (
    await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT LegacyUserId FROM dbo.TenantMembership WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { LegacyUserId: number }) => Number(r.LegacyUserId));
  const empIds = (
    await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT EmpID FROM dbo.TblEmp WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { EmpID: number }) => Number(r.EmpID));

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const branchId of branchIds) {
      await deleteIfTable(tx, 'TblCashMove', 'BranchID = @branchId', (r) => r.input('branchId', sql.Int, branchId));
    }
    for (const empId of empIds) {
      for (const table of EMP_KEYED_TABLES) {
        await deleteIfTable(tx, table, 'EmpID = @empId', (r) => r.input('empId', sql.Int, empId));
      }
    }
    for (const t of TENANT_TABLES) {
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`DELETE FROM dbo.${t} WHERE TenantId = @tenantId;`);
    }
    await new sql.Request(tx).input('tenantId', sql.UniqueIdentifier, tenantId).query(`
      DELETE FROM dbo.PlatformOutbox WHERE TenantId = @tenantId;
      DELETE FROM dbo.SalonPackConfig WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantIndustryPack WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantSubscription WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantAppEntitlement WHERE TenantId = @tenantId;
      DELETE FROM dbo.LegacyIdMap WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantMembership WHERE TenantId = @tenantId;
      DELETE FROM dbo.Location WHERE TenantId = @tenantId;
      DELETE FROM dbo.Tenant WHERE TenantId = @tenantId;
    `);
    for (const userId of userIds) {
      await new sql.Request(tx).input('userId', sql.Int, userId).query(`
        DELETE FROM dbo.TblUserBranchAccess WHERE UserID = @userId;
        DELETE FROM dbo.TblUser WHERE UserID = @userId;
      `);
    }
    for (const branchId of branchIds) {
      await new sql.Request(tx).input('branchId', sql.Int, branchId).query(`
        DELETE FROM dbo.QueueBookingSettings WHERE BranchID = @branchId;
        DELETE FROM dbo.TblBranch WHERE BranchID = @branchId;
      `);
    }
    await tx.commit();
    console.log(`  cleanup: removed ${tenantCode}`);
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function cleanupAll(pool: sql.ConnectionPool) {
  for (const t of SMOKE_TENANTS) await cleanupTenant(pool, t.code);
}

/** Same statement shape as POST /api/employees (legacy payload). */
async function createEmployee(pool: sql.ConnectionPool, tenantId: string, name: string): Promise<number> {
  const r = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('empName', sql.NVarChar(200), name)
    .input('isActive', sql.Bit, 1)
    .query(`
      INSERT INTO dbo.TblEmp (TenantId, EmpName, isActive)
      VALUES (@tenantId, @empName, @isActive);
      SELECT EmpID FROM dbo.TblEmp WHERE EmpID = SCOPE_IDENTITY() AND TenantId = @tenantId;
    `);
  return Number(r.recordset[0].EmpID);
}

async function addDailyPayPlan(pool: sql.ConnectionPool, empId: number, branchId: number) {
  await pool.request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('daily', sql.Decimal(18, 4), DAILY_RATE)
    .input('from', sql.Date, '2026-01-01')
    .query(`
      INSERT INTO dbo.TblEmpBranchPayrollPlan (
        EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
        EffectiveFrom, EffectiveTo, IsActive, SourceNotes
      )
      VALUES (@empId, @branchId, N'daily', 0, @daily, 0, @from, NULL, 1, N'DRVO-016 smoke');
    `);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD || '';
  if (!password) {
    console.error('Missing DRVO_STAGING_DB_PASSWORD (staging only; .env.local is never read).');
    process.exit(1);
  }
  forceStagingEnv(password);

  const config = buildConfig();
  if (config.database !== STAGING_DB || config.user !== STAGING_LOGIN) {
    console.error(`Refusing: database must be ${STAGING_DB} as ${STAGING_LOGIN}`);
    process.exit(1);
  }

  const { provisionTenant } = await import('../../src/platform/onboarding/provisionTenant');
  const { SALON_PACK } = await import('../../src/packs/salon/public');
  const { getPool } = await import('../../src/lib/db');
  const hr = await import('../../src/lib/hr/hrTenantScope');
  const attendance = await import('../../src/modules/attendance/infra/AttendanceRepository');
  const { executeDailyPayrollGenerate } = await import('../../src/lib/payroll/dailyPayrollGenerateCore');
  const { executeEmployeePayout } = await import('../../src/lib/services/employeeLedgerPayoutService');
  const { getEmployeeLedgerSummary } = await import('../../src/lib/services/employeeLedgerService');

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);
    await cleanupAll(pool);
    const bootBefore = await bootEmployeeCount(pool);
    console.log(`  CASHER_BOOT employees before: ${bootBefore}`);

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo016-smoke' };

    console.log('Scenario 1 — provision two tenants');
    const tenants: Array<{ code: string; tenantId: string; branchId: number }> = [];
    for (const def of SMOKE_TENANTS) {
      const p = await provisionTenant(
        {
          tenantCode: def.code,
          tenantDisplayName: `DRVO-016 ${def.code}`,
          defaultTimezone: 'Africa/Cairo',
          ownerUserName: `${def.code} Owner`,
          ownerLoginName: def.login,
          ownerPassword: 'smoke-pass-change-me',
          firstBranchCode: def.branch,
          firstBranchName: `${def.code} Branch`,
          industryPack: SALON_PACK,
          subscriptionStatus: 'active',
        },
        actor,
      );
      tenants.push({ code: def.code, tenantId: p.tenantId.toLowerCase(), branchId: p.legacyBranchId });
    }
    const [A, B] = tenants;
    check(A.tenantId !== B.tenantId && A.branchId !== B.branchId, 'two distinct tenants with their own branch');

    const db = await getPool();
    const emp: Record<string, number> = {};

    for (const t of tenants) {
      console.log(`Scenario 2 — ${t.code}: employee → attendance → daily payroll → payout`);
      const empId = await createEmployee(pool, t.tenantId, 'DRVO016 Ahmed');
      emp[t.code] = empId;
      await addDailyPayPlan(pool, empId, t.branchId);
      check((await hr.assertEmployeeInTenant(t.tenantId, empId)).empId === empId, `${t.code} owns its employee ${empId}`);

      check(await attendance.employeeExists(db, empId, t.branchId), `${t.code} branch sees its employee for attendance`);
      await attendance.mergeLegacyEmployeeAttendance({
        db,
        branchId: t.branchId,
        empId,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        checkOutTime: '18:00',
        status: 'Present',
        notes: 'DRVO-016 smoke',
      });
      const att = await pool.request()
        .input('empId', sql.Int, empId).input('branchId', sql.Int, t.branchId).input('d', sql.Date, WORK_DATE)
        .query(`SELECT COUNT(*) AS cnt FROM dbo.TblEmpAttendance WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @d;`);
      check(Number(att.recordset[0].cnt) === 1, `${t.code} attendance recorded`);

      const gen = await executeDailyPayrollGenerate(db, WORK_DATE, { branchId: t.branchId, empIds: [empId] });
      const pay = await pool.request()
        .input('empId', sql.Int, empId).input('branchId', sql.Int, t.branchId).input('d', sql.Date, WORK_DATE)
        .query(`SELECT DailyWage FROM dbo.TblEmpDailyPayroll WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @d;`);
      check(pay.recordset.length === 1, `${t.code} daily payroll generated (generatedCount=${gen.generatedCount}, wage=${pay.recordset[0]?.DailyWage})`);

      const pm = await pool.request().input('tenantId', sql.UniqueIdentifier, t.tenantId)
        .query(`SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods WHERE TenantId = @tenantId ORDER BY PaymentID;`);
      check(pm.recordset.length === 1, `${t.code} has a seeded payment method`);
      const payout = await executeEmployeePayout({
        empId,
        amount: PAYOUT_AMOUNT,
        paymentMethodId: Number(pm.recordset[0].PaymentID),
        payoutDate: WORK_DATE,
        notes: 'DRVO-016 smoke',
        createdByUserId: actor.actorUserId,
        allowOverpay: true,
        branchId: t.branchId,
        businessDayId: null,
      });
      check(payout.success && payout.ledgerEntryId > 0, `${t.code} employee-ledger payout posted (entry ${payout.ledgerEntryId})`);
    }

    console.log('Scenario 3 — isolation');
    for (const [self, other] of [[A, B], [B, A]] as const) {
      const foreignEmp = emp[other.code];
      await expectReject(() => hr.assertEmployeeInTenant(self.tenantId, foreignEmp), `${self.code} cannot resolve ${other.code}'s employee`);
      check(!(await attendance.employeeExists(db, foreignEmp, self.branchId)), `${self.code} branch cannot record attendance for ${other.code}'s employee`);
      await expectReject(
        () => executeEmployeePayout({
          empId: foreignEmp,
          amount: PAYOUT_AMOUNT,
          paymentMethodId: 1,
          payoutDate: WORK_DATE,
          allowOverpay: true,
          branchId: self.branchId,
          businessDayId: null,
        }),
        `${self.code} branch cannot pay ${other.code}'s employee`,
      );
      const summary = await getEmployeeLedgerSummary(PAYROLL_MONTH, null, { tenantId: self.tenantId });
      const ids = summary.employees.map((e) => e.empId);
      check(ids.includes(emp[self.code]) && !ids.includes(foreignEmp), `${self.code} ledger summary lists only its employee`);
      const branches = await hr.listTenantHrBranches(self.tenantId);
      check(branches.length === 1 && branches[0].branchId === self.branchId, `${self.code} HR branch list is its own branch only`);
      const filtered = await hr.filterEmployeeIdsInTenant(self.tenantId, [emp[A.code], emp[B.code]]);
      check(filtered.length === 1 && filtered[0] === emp[self.code], `${self.code} employee filter drops the foreign employee`);
    }

    console.log('Scenario 4 — cleanup; CASHER_BOOT unchanged');
    await cleanupAll(pool);
    const residue = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code LIKE N'DRVO016[_]%';`);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO016 tenants left');
    for (const code of Object.keys(emp)) {
      const left = await pool.request().input('empId', sql.Int, emp[code])
        .query(`SELECT COUNT(*) AS cnt FROM dbo.TblEmp WHERE EmpID = @empId;`);
      check(Number(left.recordset[0].cnt) === 0, `${code} smoke employee removed`);
    }
    check((await bootEmployeeCount(pool)) === bootBefore, `CASHER_BOOT employee count unchanged (${bootBefore})`);

    console.log('DRVO-016 smoke PASS');
  } finally {
    try {
      await cleanupAll(pool);
    } catch {
      /* best effort */
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-016 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
