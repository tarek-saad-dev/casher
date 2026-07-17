import 'server-only';

import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool } from '@/lib/db';

export type EmployeeLedgerMigrateFailedStep =
  | 'create_table'
  | 'create_unique_index'
  | 'update_entry_reason_check';

export interface EmployeeLedgerMigrateSqlError {
  message: string;
  number: number | null;
}

export interface EmployeeLedgerMigrateSuccess {
  success: true;
  tableCreated: boolean;
  tableExists: boolean;
  uniqueIndexCreated: boolean;
  uniqueIndexExists: boolean;
  employeeFundingReasonAllowed: boolean;
  employeeTipReasonAllowed: boolean;
  entryReasonCheckUpdated: boolean;
}

export interface EmployeeLedgerMigrateFailure {
  success: false;
  failedStep: EmployeeLedgerMigrateFailedStep;
  sqlError: EmployeeLedgerMigrateSqlError;
}

export type EmployeeLedgerMigrateResult =
  | EmployeeLedgerMigrateSuccess
  | EmployeeLedgerMigrateFailure;

const TABLE_MIGRATION_FILE = 'create-tbl-emp-ledger-entry.sql';
const INDEX_MIGRATION_FILE = 'add-emp-ledger-entry-active-ref-unique.sql';
const FUNDING_REASON_MIGRATION_FILE = 'add-employee-ledger-employee-funding-reason.sql';
const TIP_REASON_MIGRATION_FILE = 'add-employee-ledger-tip-reason.sql';

function migrationPath(filename: string): string {
  return join(process.cwd(), 'db', 'migrations', filename);
}

function readMigrationSql(filename: string): string {
  return readFileSync(migrationPath(filename), 'utf-8');
}

/** Split SSMS/sqlcmd scripts on GO batch separators for node-mssql execution. */
export function splitSqlBatches(sql: string): string[] {
  return sql
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function runMigrationSql(
  pool: { request: () => { query: (sql: string) => Promise<unknown> } },
  sql: string,
): Promise<void> {
  for (const batch of splitSqlBatches(sql)) {
    await pool.request().query(batch);
  }
}

export function extractSqlError(error: unknown): EmployeeLedgerMigrateSqlError {
  if (error && typeof error === 'object') {
    const err = error as { message?: string; number?: number; originalError?: { message?: string; number?: number } };
    const number = err.number ?? err.originalError?.number ?? null;
    const message = err.message ?? err.originalError?.message ?? 'Unknown SQL error';
    return { message, number: number != null ? Number(number) : null };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    number: null,
  };
}

export async function employeeLedgerTableExists(
  pool: { request: () => { query: (sql: string) => Promise<{ recordset: unknown[] }> } },
): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT 1 AS ok
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpLedgerEntry'
  `);
  return result.recordset.length > 0;
}

export async function employeeLedgerActiveRefUniqueIndexExists(
  pool: { request: () => { query: (sql: string) => Promise<{ recordset: unknown[] }> } },
): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT 1 AS ok
    FROM sys.indexes
    WHERE name = 'UX_TblEmpLedgerEntry_ActiveRefReason'
      AND object_id = OBJECT_ID('dbo.TblEmpLedgerEntry')
  `);
  return result.recordset.length > 0;
}

export async function employeeFundingReasonAllowed(
  pool: { request: () => { query: (sql: string) => Promise<{ recordset: Array<{ definition?: string | null }> }> } },
): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT cc.definition
    FROM sys.check_constraints cc
    WHERE cc.name = N'CK_TblEmpLedgerEntry_EntryReason'
      AND cc.parent_object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry')
  `);
  const definition = String(result.recordset[0]?.definition ?? '');
  return definition.includes('employee_funding');
}

export async function employeeTipReasonAllowed(
  pool: { request: () => { query: (sql: string) => Promise<{ recordset: Array<{ definition?: string | null }> }> } },
): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT cc.definition
    FROM sys.check_constraints cc
    WHERE cc.name = N'CK_TblEmpLedgerEntry_EntryReason'
      AND cc.parent_object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry')
  `);
  const definition = String(result.recordset[0]?.definition ?? '');
  return definition.includes("'tip'") || definition.includes('N\'tip\'') || definition.includes('tip');
}

export async function runEmployeeLedgerMigrations(): Promise<EmployeeLedgerMigrateResult> {
  const db = await getPool();
  const tableBefore = await employeeLedgerTableExists(db);

  try {
    const tableSql = readMigrationSql(TABLE_MIGRATION_FILE);
    await runMigrationSql(db, tableSql);
  } catch (error) {
    return {
      success: false,
      failedStep: 'create_table',
      sqlError: extractSqlError(error),
    };
  }

  const tableAfter = await employeeLedgerTableExists(db);
  const indexBefore = await employeeLedgerActiveRefUniqueIndexExists(db);

  try {
    const indexSql = readMigrationSql(INDEX_MIGRATION_FILE);
    await runMigrationSql(db, indexSql);
  } catch (error) {
    return {
      success: false,
      failedStep: 'create_unique_index',
      sqlError: extractSqlError(error),
    };
  }

  const indexAfter = await employeeLedgerActiveRefUniqueIndexExists(db);
  const fundingReasonBefore = await employeeFundingReasonAllowed(db);

  try {
    const fundingReasonSql = readMigrationSql(FUNDING_REASON_MIGRATION_FILE);
    await runMigrationSql(db, fundingReasonSql);
  } catch (error) {
    return {
      success: false,
      failedStep: 'update_entry_reason_check',
      sqlError: extractSqlError(error),
    };
  }

  const tipReasonBefore = await employeeTipReasonAllowed(db);

  try {
    const tipReasonSql = readMigrationSql(TIP_REASON_MIGRATION_FILE);
    await runMigrationSql(db, tipReasonSql);
  } catch (error) {
    return {
      success: false,
      failedStep: 'update_entry_reason_check',
      sqlError: extractSqlError(error),
    };
  }

  const fundingReasonAfter = await employeeFundingReasonAllowed(db);
  const tipReasonAfter = await employeeTipReasonAllowed(db);

  return {
    success: true,
    tableCreated: !tableBefore && tableAfter,
    tableExists: tableAfter,
    uniqueIndexCreated: !indexBefore && indexAfter,
    uniqueIndexExists: indexAfter,
    employeeFundingReasonAllowed: fundingReasonAfter,
    employeeTipReasonAllowed: tipReasonAfter,
    entryReasonCheckUpdated:
      (!fundingReasonBefore && fundingReasonAfter) || (!tipReasonBefore && tipReasonAfter),
  };
}
