/**
 * Phase 3B.1 — Workforce availability permission constants + DB helpers.
 * Idempotent grants; never deletes custom role access.
 */

import type { ConnectionPool } from 'mssql';

export const WORKFORCE_AVAILABILITY_PAGE_KEY = 'hr.workforce_availability';
export const WORKFORCE_AVAILABILITY_PAGE_PATH = '/admin/workforce/availability';
export const WORKFORCE_AVAILABILITY_EXPECTED_ROLES = [
  'super_admin',
  'admin',
  'manager',
  'receptionist',
] as const;

export type WorkforcePermissionVerifyResult = {
  ok: boolean;
  pageExists: boolean;
  missingRoleGrants: string[];
  grantedRoles: string[];
  message: string;
};

/** Ensure page row + expected role grants exist (IF NOT EXISTS). Does not revoke others. */
export async function ensureWorkforceAvailabilityGrants(
  db: ConnectionPool,
): Promise<{ pageEnsured: boolean; grantsAdded: number }> {
  await db
    .request()
    .input('key', WORKFORCE_AVAILABILITY_PAGE_KEY)
    .input('name', 'توافر الموظفين')
    .input('path', WORKFORCE_AVAILABILITY_PAGE_PATH)
    .input('section', 'الموارد البشرية')
    .input('access', 'roles')
    .input('sort', 93)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = @key)
        INSERT INTO dbo.TblSystemPages (PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
        VALUES (@key, @name, @path, @section, @access, @sort)
      ELSE
        UPDATE dbo.TblSystemPages
        SET PageName = @name, PagePath = @path, Section = @section, AccessMode = @access, SortOrder = @sort
        WHERE PageKey = @key
    `);

  let grantsAdded = 0;
  for (const roleKey of WORKFORCE_AVAILABILITY_EXPECTED_ROLES) {
    const res = await db
      .request()
      .input('roleKey', roleKey)
      .input('pageKey', WORKFORCE_AVAILABILITY_PAGE_KEY)
      .query(`
        DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
        DECLARE @pid INT = (SELECT PageID FROM dbo.TblSystemPages WHERE PageKey = @pageKey)
        IF @rid IS NOT NULL AND @pid IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.TblPageRoleAccess WHERE PageID=@pid AND RoleID=@rid)
        BEGIN
          INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
          VALUES (@pid, @rid, 1, 1, 0)
          SELECT 1 AS inserted
        END
        ELSE
          SELECT 0 AS inserted
      `);
    if (Number(res.recordset?.[0]?.inserted) === 1) grantsAdded += 1;
  }

  return { pageEnsured: true, grantsAdded };
}

/** Non-destructive verification — does not grant. */
export async function verifyWorkforceAvailabilityPermissions(
  db: ConnectionPool,
): Promise<WorkforcePermissionVerifyResult> {
  const pageRes = await db
    .request()
    .input('key', WORKFORCE_AVAILABILITY_PAGE_KEY)
    .query(`
      SELECT PageID, PagePath
      FROM dbo.TblSystemPages
      WHERE PageKey = @key
    `);
  const pageExists = pageRes.recordset.length > 0;

  if (!pageExists) {
    return {
      ok: false,
      pageExists: false,
      missingRoleGrants: [...WORKFORCE_AVAILABILITY_EXPECTED_ROLES],
      grantedRoles: [],
      message: `Missing page key ${WORKFORCE_AVAILABILITY_PAGE_KEY}`,
    };
  }

  const grantRes = await db
    .request()
    .input('pageKey', WORKFORCE_AVAILABILITY_PAGE_KEY)
    .query(`
      SELECT r.RoleKey
      FROM dbo.TblPageRoleAccess pra
      INNER JOIN dbo.TblSystemPages p ON p.PageID = pra.PageID
      INNER JOIN dbo.TblRoles r ON r.RoleID = pra.RoleID
      WHERE p.PageKey = @pageKey AND pra.CanView = 1
    `);

  const grantedRoles = grantRes.recordset.map((r: { RoleKey: string }) => String(r.RoleKey));
  const missingRoleGrants = WORKFORCE_AVAILABILITY_EXPECTED_ROLES.filter(
    (role) => !grantedRoles.includes(role),
  );

  const ok = missingRoleGrants.length === 0;
  return {
    ok,
    pageExists: true,
    missingRoleGrants: [...missingRoleGrants],
    grantedRoles,
    message: ok
      ? 'Workforce availability permissions OK'
      : `Missing role grants: ${missingRoleGrants.join(', ')}`,
  };
}
