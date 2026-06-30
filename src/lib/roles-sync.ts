// SERVER-ONLY — sync supplemental roles into TblRoles on startup.
import 'server-only';

import { PARTNER_ROLE_KEY, PARTNERS_REPORT_PAGE_KEY } from './partnerAccess';

export const PARTNER_ROLE_DEFINITION = {
  key: PARTNER_ROLE_KEY,
  name: 'شريك',
  description: 'عرض تقرير الشركاء فقط',
} as const;

let synced = false;

export async function syncRolesRegistry(db: import('mssql').ConnectionPool): Promise<void> {
  if (synced) return;
  synced = true;

  try {
    const check = await db.request().query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('TblRoles','TblUserRoles','TblSystemPages','TblPageRoleAccess')
    `);
    if ((check.recordset[0]?.cnt ?? 0) < 4) return;

    await db.request()
      .input('key', PARTNER_ROLE_DEFINITION.key)
      .input('name', PARTNER_ROLE_DEFINITION.name)
      .input('desc', PARTNER_ROLE_DEFINITION.description)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.TblRoles WHERE RoleKey = @key)
          INSERT INTO dbo.TblRoles (RoleKey, RoleName, Description, IsActive)
          VALUES (@key, @name, @desc, 1)
        ELSE
          UPDATE dbo.TblRoles
          SET RoleName = @name, Description = @desc, IsActive = 1
          WHERE RoleKey = @key
      `);

    await db.request()
      .input('roleKey', PARTNER_ROLE_KEY)
      .input('pageKey', PARTNERS_REPORT_PAGE_KEY)
      .query(`
        DECLARE @roleId INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey = @roleKey AND IsActive = 1)
        DECLARE @pageId INT = (SELECT PageID FROM dbo.TblSystemPages WHERE PageKey = @pageKey AND IsActive = 1)

        IF @roleId IS NOT NULL AND @pageId IS NOT NULL
        BEGIN
          DELETE FROM dbo.TblPageRoleAccess
          WHERE RoleID = @roleId AND PageID <> @pageId

          IF NOT EXISTS (SELECT 1 FROM dbo.TblPageRoleAccess WHERE RoleID = @roleId AND PageID = @pageId)
            INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
            VALUES (@pageId, @roleId, 1, 0, 0)
          ELSE
            UPDATE dbo.TblPageRoleAccess
            SET CanView = 1, CanEdit = 0, CanDelete = 0
            WHERE RoleID = @roleId AND PageID = @pageId
        END
      `);

    console.log('[roles-sync] Partner role synced ✓');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.warn('[roles-sync] Sync failed (non-fatal):', message);
    synced = false;
  }
}
