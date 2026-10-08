/**
 * DRVO-016 — HR / attendance / payroll / employee-ledger tenancy.
 *
 * Only `TblEmp` carries a TenantId among the HR tables; attendance, payroll and ledger rows are
 * scoped through their employee (`e.TenantId = @tenantId`) and/or the tenant's branch set
 * (active `Location` rows of the tenant). There is no default tenant: a missing or malformed
 * tenant fails closed before any SQL runs.
 */
import { getPool, sql } from '@/lib/db';
import { requireMasterDataTenantId, tenantIdForBranchContext } from '@/platform/masterData/tenantScope';
import { TenantContextError, type TenantSqlExecutor } from '@/platform/tenant/tenantContext';
import {
  hrBranchLabel,
  LEGACY_HR_PRIMARY_BRANCH_CODE,
  legacyHrAllScopeBranches,
} from '@/lib/hr/legacyHrBranchPolicy';

export const DEFAULT_HR_TIME_ZONE = 'Africa/Cairo';

export function requireHrTenantId(tenantId: string | null | undefined, where: string): string {
  return requireMasterDataTenantId(tenantId, where);
}

/** Tenant of an HR request's branch context (DRVO-013 stamp, else the branch's Location). */
export async function hrTenantIdForBranch(
  branch: { branchId: number; tenantId?: string | null },
  executor?: TenantSqlExecutor,
): Promise<string> {
  return tenantIdForBranchContext(branch, executor);
}

/**
 * Whose employees an HR query may touch: an explicit tenant, or the tenant that owns a branch
 * (a branch belongs to exactly one tenant, so branch-scoped work can never reach another
 * tenant's employees).
 */
export type HrEmpTenantScope = { tenantId: string } | { branchId: number };

/**
 * SQL predicate that binds `<alias>.TenantId` to the scope's tenant and declares its inputs on
 * `req`. Interpolate the returned fragment into the WHERE / JOIN of a TblEmp query.
 */
export function bindEmpTenantPredicate(
  req: { input: (name: string, type: unknown, value: unknown) => unknown },
  alias: string,
  scope: HrEmpTenantScope,
): string {
  const col = alias ? `${alias}.TenantId` : 'TenantId';
  if ('tenantId' in scope) {
    req.input('hrTenantId', sql.UniqueIdentifier, requireHrTenantId(scope.tenantId, 'HR employee scope'));
    return `${col} = @hrTenantId`;
  }
  if (!Number.isInteger(scope.branchId) || scope.branchId <= 0) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `HR employee scope: invalid branch ${scope.branchId}`);
  }
  req.input('hrTenantBranchId', sql.Int, scope.branchId);
  return `${col} IN (SELECT l.TenantId FROM dbo.Location l WHERE l.LegacyBranchId = @hrTenantBranchId)`;
}

/** An employee of another tenant is indistinguishable from a missing one. */
export class HrEmployeeNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'EMPLOYEE_NOT_FOUND';
  constructor(readonly empId: number) {
    super('الموظف غير موجود');
    this.name = 'HrEmployeeNotFoundError';
  }
}

export function isHrEmployeeNotFoundError(err: unknown): err is HrEmployeeNotFoundError {
  return err instanceof HrEmployeeNotFoundError;
}

async function exec(ex?: TenantSqlExecutor): Promise<TenantSqlExecutor> {
  return ex ?? (await getPool());
}

/** Throws `HrEmployeeNotFoundError` unless the employee belongs to the tenant. */
export async function assertEmployeeInTenant(
  tenantId: string,
  empId: number,
  executor?: TenantSqlExecutor,
): Promise<{ empId: number; empName: string }> {
  const tid = requireHrTenantId(tenantId, 'assertEmployeeInTenant');
  if (!Number.isInteger(empId) || empId <= 0) throw new HrEmployeeNotFoundError(empId);
  const ex = await exec(executor);
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tid)
    .input('empId', sql.Int, empId)
    .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId AND TenantId = @tenantId`);
  const row = result.recordset[0] as { EmpID: number; EmpName: string } | undefined;
  if (!row) throw new HrEmployeeNotFoundError(empId);
  return { empId: Number(row.EmpID), empName: String(row.EmpName ?? '') };
}

/** Subset of `empIds` that belong to the tenant (order preserved, duplicates dropped). */
export async function filterEmployeeIdsInTenant(
  tenantId: string,
  empIds: readonly number[],
  executor?: TenantSqlExecutor,
): Promise<number[]> {
  const tid = requireHrTenantId(tenantId, 'filterEmployeeIdsInTenant');
  const ids = [...new Set(empIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  const ex = await exec(executor);
  const req = ex.request().input('tenantId', sql.UniqueIdentifier, tid);
  const ph = ids.map((id, i) => {
    req.input(`e${i}`, sql.Int, id);
    return `@e${i}`;
  });
  const result = await req.query(
    `SELECT EmpID FROM dbo.TblEmp WHERE TenantId = @tenantId AND EmpID IN (${ph.join(',')})`,
  );
  const allowed = new Set((result.recordset as Array<{ EmpID: number }>).map((r) => Number(r.EmpID)));
  return ids.filter((id) => allowed.has(id));
}

export interface TenantHrBranch {
  branchId: number;
  branchCode: string;
  branchName: string;
  /** Tab label: CUT's legacy label for its branches, else the branch name. */
  label: string;
  timeZone: string;
  /** Active Location of the tenant and active TblBranch. */
  isActive: boolean;
}

/**
 * The tenant's active HR branches (active Location of the tenant + active TblBranch), ordered by
 * branch id. Replaces the former hard-coded GLEEM + CAMP_CAESAR pair.
 */
export async function listTenantHrBranches(
  tenantId: string,
  executor?: TenantSqlExecutor,
  opts: {
    /**
     * Also list the tenant's inactive branches (ledger history: entries booked at a branch stay
     * visible after it is deactivated).
     */
    includeInactive?: boolean;
  } = {},
): Promise<TenantHrBranch[]> {
  const tid = requireHrTenantId(tenantId, 'listTenantHrBranches');
  const ex = await exec(executor);
  const activeFilter = opts.includeInactive ? '' : `AND l.Status = N'active' AND b.IsActive = 1`;
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tid)
    .query(`
      SELECT DISTINCT b.BranchID, b.BranchCode, b.BranchName, b.TimeZone,
        CAST(CASE WHEN l.Status = N'active' AND b.IsActive = 1 THEN 1 ELSE 0 END AS BIT) AS IsHrActive
      FROM dbo.Location l
      INNER JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
      WHERE l.TenantId = @tenantId ${activeFilter}
      ORDER BY b.BranchID
    `);
  return (result.recordset as Array<Record<string, unknown>>).map((r) => {
    const branchCode = String(r.BranchCode ?? '');
    const branchName = String(r.BranchName ?? '');
    return {
      branchId: Number(r.BranchID),
      branchCode,
      branchName,
      label: hrBranchLabel({ branchCode, branchName }),
      timeZone: String(r.TimeZone ?? '').trim() || DEFAULT_HR_TIME_ZONE,
      isActive: r.IsHrActive == null ? true : Boolean(r.IsHrActive),
    };
  });
}

/**
 * Branch tabs / badge order for HR UI: the tenant's active HR branches (CUT keeps its legacy
 * two-salon set), ordered by branch id. Clients colour badges by index in this list.
 */
export async function listTenantHrBranchOptions(
  tenantId: string,
  executor?: TenantSqlExecutor,
): Promise<Array<{ code: string; label: string }>> {
  const branches = await listTenantHrBranches(tenantId, executor);
  return legacyHrAllScopeBranches(branches).map((b) => ({ code: b.branchCode, label: b.label }));
}

/**
 * HR time zone of a set of branches (one tenant): the time zone of the lowest branch id,
 * `Africa/Cairo` when unset. Used for the nightly close work date.
 */
export async function resolveHrTimeZoneForBranches(
  branchIds: readonly number[],
  executor?: TenantSqlExecutor,
): Promise<string> {
  const ids = [...new Set(branchIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  if (ids.length === 0) return DEFAULT_HR_TIME_ZONE;
  const ex = await exec(executor);
  const req = ex.request();
  const ph = ids.map((id, i) => {
    req.input(`b${i}`, sql.Int, id);
    return `@b${i}`;
  });
  const result = await req.query(
    `SELECT TOP 1 TimeZone FROM dbo.TblBranch WHERE BranchID IN (${ph.join(',')}) ORDER BY BranchID`,
  );
  const tz = String(result.recordset[0]?.TimeZone ?? '').trim();
  return isValidTimeZone(tz) ? tz : DEFAULT_HR_TIME_ZONE;
}

type HrSqlRequester = { request: () => sql.Request };

/**
 * The employee's tenant's legacy primary branch (CUT's GLEEM) — the only branch whose employees
 * may fall back to legacy `TblEmpWorkSchedule` rows. `null` for every other tenant.
 */
export async function legacyPrimaryBranchIdForEmployee(
  db: HrSqlRequester,
  empId: number,
): Promise<number | null> {
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('legacyPrimaryCode', sql.NVarChar(40), LEGACY_HR_PRIMARY_BRANCH_CODE)
    .query(`
      SELECT TOP 1 b.BranchID
      FROM dbo.TblEmp e
      INNER JOIN dbo.Location l ON l.TenantId = e.TenantId
      INNER JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
      WHERE e.EmpID = @empId AND b.BranchCode = @legacyPrimaryCode
    `);
  const id = Number(result.recordset[0]?.BranchID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Last-resort branch for an employee with no attendance row or assignment: CUT's legacy primary
 * branch for CUT employees, else the lowest active branch of the employee's tenant.
 */
export async function fallbackBranchIdForEmployee(
  db: HrSqlRequester,
  empId: number,
): Promise<number | null> {
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('legacyPrimaryCode', sql.NVarChar(40), LEGACY_HR_PRIMARY_BRANCH_CODE)
    .query(`
      SELECT TOP 1 b.BranchID
      FROM dbo.TblEmp e
      INNER JOIN dbo.Location l ON l.TenantId = e.TenantId
      INNER JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
      WHERE e.EmpID = @empId
      ORDER BY
        CASE WHEN b.BranchCode = @legacyPrimaryCode THEN 0 ELSE 1 END,
        CASE WHEN l.Status = N'active' AND b.IsActive = 1 THEN 0 ELSE 1 END,
        b.BranchID
    `);
  const id = Number(result.recordset[0]?.BranchID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
