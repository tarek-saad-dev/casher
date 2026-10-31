import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '020-employee-late-deduction',
  'schema.sql',
);

export async function verifyEmployeeLateDeductionSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  const exemptCol = await pool.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(exemptCol.recordset[0]?.ok) !== 1) {
    failures.push('Missing TblEmp.LateDeductionExempt');
  }

  const settings = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblHrFeatureSetting', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(settings.recordset[0]?.ok) !== 1) {
    failures.push('Missing TblHrFeatureSetting');
  } else {
    for (const col of ['SettingKey', 'SettingValue', 'UpdatedAt', 'UpdatedByUserID']) {
      const r = await pool.request().input('col', col).query(`
        SELECT CASE WHEN COL_LENGTH(N'dbo.TblHrFeatureSetting', @col) IS NULL THEN 0 ELSE 1 END AS ok;
      `);
      if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing TblHrFeatureSetting.${col}`);
    }
  }

  const cases = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblEmpLateDeductionCase', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(cases.recordset[0]?.ok) !== 1) {
    failures.push('Missing TblEmpLateDeductionCase');
    return { ok: false, failures };
  }

  for (const col of [
    'CaseID',
    'EmpID',
    'BranchID',
    'WorkDate',
    'AttendanceID',
    'ScheduledStartTime',
    'ScheduledEndTime',
    'LateMinutes',
    'DeductionKind',
    'Status',
    'DailyBasePay',
    'Amount',
    'LedgerEntryID',
    'NotifiedAt1',
    'NotifiedAt61',
    'NotifiedAt121',
    'NotifiedFinalAt',
    'DoNotAutoRecreate',
    'CreatedAt',
  ]) {
    const r = await pool.request().input('col', col).query(`
      SELECT CASE WHEN COL_LENGTH(N'dbo.TblEmpLateDeductionCase', @col) IS NULL THEN 0 ELSE 1 END AS ok;
    `);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing TblEmpLateDeductionCase.${col}`);
  }

  for (const name of [
    'UQ_TblEmpLateDeductionCase_Emp_Branch_WorkDate',
    'IX_TblEmpLateDeductionCase_Status_WorkDate',
    'IX_TblEmpLateDeductionCase_AttendanceID',
  ]) {
    const r = await pool.request().input('name', name).query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.TblEmpLateDeductionCase')
          AND name = @name
          AND is_disabled = 0
      ) THEN 1 ELSE 0 END AS ok;
    `);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing index ${name}`);
  }

  const statusCk = await pool.request().query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.TblEmpLateDeductionCase')
        AND name = N'CK_TblEmpLateDeductionCase_Status'
        AND is_disabled = 0
        AND is_not_trusted = 0
    ) THEN 1 ELSE 0 END AS ok;
  `);
  if (Number(statusCk.recordset[0]?.ok) !== 1) {
    failures.push('Missing/untrusted CK_TblEmpLateDeductionCase_Status');
  }

  return { ok: failures.length === 0, failures };
}

export const employeeLateDeductionMigration: DrvoMigrationDefinition = {
  migrationId: 20,
  migrationKey: 'employee-late-deduction',
  name: 'Automatic employee late deduction cases, settings, and exemption flag',
  dependencies: ['platform-core'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive HR schema only. Disable the feature switch and retain tables/column; do not drop historical case or ledger rows.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyEmployeeLateDeductionSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyEmployeeLateDeductionSchema(ctx.pool)).ok;
  },
};
