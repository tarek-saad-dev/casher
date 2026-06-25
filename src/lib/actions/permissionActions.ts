/**
 * Permissions domain actions — single execution path for user roles and page access.
 */

import { sql } from '@/lib/db';

export interface UserRolesSnapshot {
  userId: number;
  oldRoles: string[];
  newRoles: string[];
}

export interface PageAccessSnapshot {
  pageKey: string;
  oldAccessMode: string;
  newAccessMode: string;
  oldRoles: string[];
  newRoles: string[];
}

export async function getUserRolesSnapshot(
  transaction: sql.Transaction,
  userId: number,
): Promise<{ roles: string[]; roleIds: number[] }> {
  const result = await new sql.Request(transaction)
    .input('uid', sql.Int, userId)
    .query(`
      SELECT r.RoleKey, r.RoleID
      FROM dbo.TblUserRoles ur
      JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
      WHERE ur.UserID = @uid AND r.IsActive = 1
    `);

  return {
    roles: result.recordset.map((r) => r.RoleKey as string),
    roleIds: result.recordset.map((r) => r.RoleID as number),
  };
}

export async function updateUserRoles(
  transaction: sql.Transaction,
  userId: number,
  roleKeys: string[],
): Promise<UserRolesSnapshot> {
  const old = await getUserRolesSnapshot(transaction, userId);

  await new sql.Request(transaction)
    .input('uid', sql.Int, userId)
    .query(`DELETE FROM dbo.TblUserRoles WHERE UserID = @uid`);

  for (const roleKey of roleKeys) {
    await new sql.Request(transaction)
      .input('uid', sql.Int, userId)
      .input('roleKey', sql.NVarChar, roleKey)
      .query(`
        DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
        IF @rid IS NOT NULL INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@uid, @rid)
      `);
  }

  const newRoles = await getUserRolesSnapshot(transaction, userId);

  return {
    userId,
    oldRoles: old.roles,
    newRoles: newRoles.roles,
  };
}

export async function getPageAccessSnapshot(
  transaction: sql.Transaction,
  pageKey: string,
): Promise<PageAccessSnapshot | null> {
  const pageRes = await new sql.Request(transaction)
    .input('key', sql.NVarChar, pageKey)
    .query(`
      SELECT TOP 1 PageID, PageKey, AccessMode
      FROM dbo.TblSystemPages
      WHERE PageKey = @key
    `);

  if (pageRes.recordset.length === 0) return null;

  const page = pageRes.recordset[0];
  const rolesRes = await new sql.Request(transaction)
    .input('pid', sql.Int, page.PageID)
    .query(`
      SELECT r.RoleKey
      FROM dbo.TblPageRoleAccess pra
      JOIN dbo.TblRoles r ON r.RoleID = pra.RoleID
      WHERE pra.PageID = @pid AND r.IsActive = 1
    `);

  return {
    pageKey,
    oldAccessMode: page.AccessMode,
    newAccessMode: page.AccessMode,
    oldRoles: rolesRes.recordset.map((r) => r.RoleKey as string),
    newRoles: rolesRes.recordset.map((r) => r.RoleKey as string),
  };
}

export async function createPage(
  transaction: sql.Transaction,
  input: {
    pageKey: string;
    pageName: string;
    pagePath: string;
    section?: string | null;
    accessMode: 'all' | 'roles' | 'super_admin_only';
    sortOrder?: number;
    roles?: string[];
  },
): Promise<{ pageID: number; pageKey: string; accessMode: string; roles: string[] }> {
  const dup = await new sql.Request(transaction)
    .input('key', sql.NVarChar, input.pageKey)
    .query(`SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = @key`);
  if (dup.recordset.length > 0) {
    const error = new Error('مفتاح الصفحة موجود بالفعل');
    (error as Error & { code?: string }).code = 'DUPLICATE_PAGE_KEY';
    throw error;
  }

  const ins = await new sql.Request(transaction)
    .input('key', sql.NVarChar, input.pageKey)
    .input('name', sql.NVarChar, input.pageName)
    .input('path', sql.NVarChar, input.pagePath)
    .input('section', sql.NVarChar, input.section || null)
    .input('access', sql.NVarChar, input.accessMode)
    .input('sort', sql.Int, input.sortOrder ?? 999)
    .query(`
      INSERT INTO dbo.TblSystemPages (PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
      OUTPUT INSERTED.PageID
      VALUES (@key, @name, @path, @section, @access, @sort)
    `);

  const pageID = ins.recordset[0]?.PageID as number;
  const roles = input.roles ?? [];

  for (const roleKey of roles) {
    await new sql.Request(transaction)
      .input('pid', sql.Int, pageID)
      .input('roleKey', sql.NVarChar, roleKey)
      .query(`
        DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
        IF @rid IS NOT NULL
          INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
          VALUES (@pid, @rid, 1, 0, 0)
      `);
  }

  return { pageID, pageKey: input.pageKey, accessMode: input.accessMode, roles };
}

export async function updatePageAccess(
  transaction: sql.Transaction,
  pageKey: string,
  accessMode: 'all' | 'roles' | 'super_admin_only',
  roles: string[],
): Promise<PageAccessSnapshot> {
  const oldSnapshot = await getPageAccessSnapshot(transaction, pageKey);

  await new sql.Request(transaction)
    .input('mode', sql.NVarChar, accessMode)
    .input('key', sql.NVarChar, pageKey)
    .query(`UPDATE dbo.TblSystemPages SET AccessMode = @mode WHERE PageKey = @key`);

  const pidRes = await new sql.Request(transaction)
    .input('key', sql.NVarChar, pageKey)
    .query(`SELECT PageID FROM dbo.TblSystemPages WHERE PageKey = @key`);
  const pageID = pidRes.recordset[0]?.PageID;

  if (pageID && Array.isArray(roles)) {
    await new sql.Request(transaction)
      .input('pid', sql.Int, pageID)
      .query(`DELETE FROM dbo.TblPageRoleAccess WHERE PageID = @pid`);

    for (const roleKey of roles) {
      await new sql.Request(transaction)
        .input('pid', sql.Int, pageID)
        .input('roleKey', sql.NVarChar, roleKey)
        .query(`
          DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey)
          IF @rid IS NOT NULL
            INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
            VALUES (@pid, @rid, 1, 0, 0)
        `);
    }
  }

  const newRoles = await new sql.Request(transaction)
    .input('pid', sql.Int, pageID)
    .query(`
      SELECT r.RoleKey
      FROM dbo.TblPageRoleAccess pra
      JOIN dbo.TblRoles r ON r.RoleID = pra.RoleID
      WHERE pra.PageID = @pid AND r.IsActive = 1
    `);

  return {
    pageKey,
    oldAccessMode: oldSnapshot?.oldAccessMode ?? accessMode,
    newAccessMode: accessMode,
    oldRoles: oldSnapshot?.oldRoles ?? [],
    newRoles: newRoles.recordset.map((r) => r.RoleKey as string),
  };
}
