import 'server-only';

import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool } from '@/lib/db';

export type EmployeeLedgerMigrateFailedStep = 'create_table' | 'create_unique_index';

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

  return {
    success: true,
    tableCreated: !tableBefore && tableAfter,
    tableExists: tableAfter,
    uniqueIndexCreated: !indexBefore && indexAfter,
    uniqueIndexExists: indexAfter,
  };
}
