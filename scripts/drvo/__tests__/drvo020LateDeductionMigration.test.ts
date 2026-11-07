import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { checksumFile } from '../checksum';
import { DRVO_MIGRATIONS, assertDrvoMigrationManifestValid } from '../migrations/index';
import { employeeLateDeductionMigration } from '../migrations/020-employee-late-deduction';
import { readSqlBatches } from '../sqlBatch';

const SQL_PATH = path.join(
  process.cwd(),
  'db/drvo-migrations/020-employee-late-deduction/schema.sql',
);
const sqlText = fs.readFileSync(SQL_PATH, 'utf8');
const sqlNoComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

describe('DRVO migration 020 employee-late-deduction', () => {
  const m = DRVO_MIGRATIONS.find((x) => x.migrationKey === 'employee-late-deduction')!;

  it('is registered as id 20 with control metadata', () => {
    expect(() => assertDrvoMigrationManifestValid()).not.toThrow();
    expect(m).toBe(employeeLateDeductionMigration);
    expect(m.migrationId).toBe(20);
    expect(m.dependencies).toEqual(['platform-core']);
    expect(m.control).toMatchObject({
      kind: 'schema',
      risk: 'LOW',
      requiresBackup: false,
      lockProfile: 'short',
    });
    expect(m.checksum).toBe(checksumFile(SQL_PATH));
  });

  it('SQL is a single transactional batch and does not destroy data', () => {
    expect(readSqlBatches(SQL_PATH)).toHaveLength(1);
    expect(sqlNoComments).toContain('SET XACT_ABORT ON');
    expect(sqlNoComments).toContain('BEGIN TRAN');
    expect(sqlNoComments).toContain('COMMIT TRAN');
    expect(sqlNoComments).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlNoComments).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('creates exemption column, settings table, and case table with finalize_pending', () => {
    expect(sqlNoComments).toContain('LateDeductionExempt');
    expect(sqlNoComments).toContain('TblHrFeatureSetting');
    expect(sqlNoComments).toContain('TblEmpLateDeductionCase');
    expect(sqlNoComments).toContain("N'finalize_pending'");
    expect(sqlNoComments).toContain('UQ_TblEmpLateDeductionCase_Emp_Branch_WorkDate');
  });

  it('runtime late-deduction schema helper does not execute DDL', () => {
    const schemaSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/hr/late-deduction/schema.ts'),
      'utf8',
    );
    expect(schemaSrc).toContain('isLateDeductionSchemaReady');
    expect(schemaSrc).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(schemaSrc).not.toMatch(/\bCREATE\s+TABLE\b/i);
  });
});
