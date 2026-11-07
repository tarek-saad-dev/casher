import 'server-only';

import type { ConnectionPool } from 'mssql';

let schemaReady: boolean | null = null;

/**
 * Read-only presence check for late-deduction schema.
 * Does NOT run DDL — schema is owned by DRVO migration `employee-late-deduction`.
 * Only caches a successful ready=true result; negative results are rechecked so a
 * live process can pick up a migration applied after boot without restart.
 */
export async function isLateDeductionSchemaReady(db: ConnectionPool): Promise<boolean> {
  if (schemaReady === true) return true;

  try {
    const result = await db.request().query(`
      SELECT
        CASE WHEN COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL THEN 0 ELSE 1 END AS HasExempt,
        CASE WHEN OBJECT_ID(N'dbo.TblHrFeatureSetting', N'U') IS NULL THEN 0 ELSE 1 END AS HasSettings,
        CASE WHEN OBJECT_ID(N'dbo.TblEmpLateDeductionCase', N'U') IS NULL THEN 0 ELSE 1 END AS HasCases
    `);
    const row = result.recordset[0] as
      | { HasExempt: number; HasSettings: number; HasCases: number }
      | undefined;
    const ok = Boolean(row?.HasExempt && row?.HasSettings && row?.HasCases);
    if (ok) {
      schemaReady = true;
      return true;
    }
    console.warn(
      '[late-deduction] schema not ready — apply DRVO migration employee-late-deduction',
    );
    return false;
  } catch (err) {
    console.warn('[late-deduction] schema check failed:', err);
    return false;
  }
}

/** @deprecated Use isLateDeductionSchemaReady — no runtime DDL. */
export async function ensureLateDeductionSchema(db: ConnectionPool): Promise<boolean> {
  return isLateDeductionSchemaReady(db);
}

/** Test helper — reset memoization between unit tests that mock DB. */
export function resetLateDeductionSchemaCache(): void {
  schemaReady = null;
}
