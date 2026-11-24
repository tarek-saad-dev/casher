// SERVER-ONLY — DB-dependent permission functions.
// Never import this in client components or client hooks.
import 'server-only';
import type { UserAccess } from './permissions-types';
import { userAccessMemo, userKey } from './auth/authMemo';
import {
  getDefaultLandingPath,
  isPartnerOnlyUser,
  PARTNERS_REPORT_PAGE_PATH,
} from './partnerAccess';

/** Once the permission tables exist they never disappear: check once per process. */
let permTablesConfirmed = false;

/** Check whether the new TblRoles tables exist */
async function permTablesExist(db: import('mssql').ConnectionPool): Promise<boolean> {
  if (permTablesConfirmed) return true;
  const r = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN ('TblRoles','TblUserRoles','TblSystemPages','TblPageRoleAccess')
  `);
  permTablesConfirmed = (r.recordset[0]?.cnt ?? 0) >= 4;
  return permTablesConfirmed;
}

/**
 * Load the full access profile for a user.
 * Falls back gracefully if tables don't exist yet (before migration).
 * Answers are memoized for a few seconds per user (see lib/auth/authMemo.ts);
 * a DB error is never cached — it returns the deny-all fallback once.
 */
export async function getUserAccess(userID: number, userName: string, userLevel: string): Promise<UserAccess> {
  try {
    return (await userAccessMemo.getOrLoad(userKey(userID, userName, userLevel), () =>
      loadUserAccess(userID, userName, userLevel),
    )) as UserAccess;
  } catch {
    return denyAllAccess(userID, userName, userLevel);
  }
}

function denyAllAccess(userID: number, userName: string, userLevel: string): UserAccess {
  return {
    userID, userName, userLevel,
    roles: [],
    isSuperAdmin: false,
    isPartnerOnly: false,
    defaultLandingPath: '/income/pos',
    allowedPagePaths: [],
    allowedPageKeys: [],
  };
}

async function loadUserAccess(userID: number, userName: string, userLevel: string): Promise<UserAccess> {
  // Fallback: no roles, no pages — deny all (pre-migration state)
  const fallback: UserAccess = {
    userID, userName, userLevel,
    roles: [],
    isSuperAdmin: false,
    isPartnerOnly: false,
    defaultLandingPath: '/income/pos',
    allowedPagePaths: [],
    allowedPageKeys: [],
  };

  try {
    const { getPool } = await import('./db');
    const db = await getPool();
    if (!(await permTablesExist(db))) return fallback;

    const rolesRes = await db.request()
      .input('uid', userID)
      .query(`
        SELECT r.RoleKey FROM dbo.TblUserRoles ur
        JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
        WHERE ur.UserID = @uid AND r.IsActive = 1
      `);
    const roles: string[] = rolesRes.recordset.map((x: { RoleKey: string }) => x.RoleKey);
    const isSuperAdmin = roles.includes('super_admin');
    const partnerOnly = isPartnerOnlyUser(roles);

    let allowedPagePaths: string[] = [];
    let allowedPageKeys: string[]  = [];

    if (isSuperAdmin) {
      const r = await db.request().query(`SELECT PageKey, PagePath FROM dbo.TblSystemPages WHERE IsActive = 1`);
      allowedPagePaths = r.recordset.map((x: { PagePath: string }) => x.PagePath);
      allowedPageKeys  = r.recordset.map((x: { PageKey: string }) => x.PageKey);
    } else if (partnerOnly) {
      const roleRes = await db.request().input('uid', userID).query(`
        SELECT DISTINCT sp.PageKey, sp.PagePath
        FROM dbo.TblPageRoleAccess pra
        JOIN dbo.TblSystemPages sp ON sp.PageID = pra.PageID
        JOIN dbo.TblUserRoles ur   ON ur.RoleID = pra.RoleID
        WHERE ur.UserID = @uid AND sp.IsActive = 1 AND pra.CanView = 1
      `);
      allowedPagePaths = [...new Set(roleRes.recordset.map((x: { PagePath: string }) => x.PagePath))];
      allowedPageKeys  = [...new Set(roleRes.recordset.map((x: { PageKey: string }) => x.PageKey))];
    } else {
      const allRes = await db.request().query(`
        SELECT PageKey, PagePath FROM dbo.TblSystemPages WHERE IsActive=1 AND AccessMode='all'
      `);
      const roleRes = await db.request().input('uid', userID).query(`
        SELECT DISTINCT sp.PageKey, sp.PagePath
        FROM dbo.TblPageRoleAccess pra
        JOIN dbo.TblSystemPages sp ON sp.PageID = pra.PageID
        JOIN dbo.TblUserRoles ur   ON ur.RoleID = pra.RoleID
        WHERE ur.UserID = @uid AND sp.IsActive = 1 AND pra.CanView = 1
      `);
      const combined: { PagePath: string; PageKey: string }[] = [
        ...allRes.recordset, ...roleRes.recordset,
      ];
      allowedPagePaths = [...new Set(combined.map(x => x.PagePath))];
      allowedPageKeys  = [...new Set(combined.map(x => x.PageKey))];
    }

    const access: UserAccess = {
      userID,
      userName,
      userLevel,
      roles,
      isSuperAdmin,
      isPartnerOnly: partnerOnly,
      defaultLandingPath: getDefaultLandingPath({ roles, isSuperAdmin }),
      allowedPagePaths,
      allowedPageKeys,
    };

    return access;
  } catch (err) {
    // Surface DB errors so the memo never caches a transient deny-all;
    // getUserAccess() turns them into the deny-all fallback.
    throw err;
  }
}

export async function canAccessPath(userID: number, userName: string, userLevel: string, path: string): Promise<boolean> {
  const access = await getUserAccess(userID, userName, userLevel);
  if (access.isSuperAdmin) return true;

  const clean = path.split('?')[0].replace(/\/$/, '') || '/';
  const partnersPath = PARTNERS_REPORT_PAGE_PATH.replace(/\/$/, '');

  if (access.isPartnerOnly) {
    return clean === partnersPath;
  }

  return access.allowedPagePaths.some((p: string) => {
    return (p.replace(/\/$/, '') || '/') === clean;
  });
}
