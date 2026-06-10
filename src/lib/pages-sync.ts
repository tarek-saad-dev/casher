// SERVER-ONLY — auto-sync SYSTEM_PAGES registry into TblSystemPages on startup.
import 'server-only';
import { SYSTEM_PAGES } from './pages-registry';

let synced = false; // run once per process

export async function syncPagesRegistry(db: import('mssql').ConnectionPool): Promise<void> {
  if (synced) return;
  synced = true;

  try {
    // Check tables exist first (migration may not have run yet)
    const check = await db.request().query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME IN ('TblSystemPages','TblRoles','TblPageRoleAccess')
    `);
    if ((check.recordset[0]?.cnt ?? 0) < 3) return;

    for (const page of SYSTEM_PAGES) {
      // Upsert page — insert if not exists, update name/path/section/sort if key exists
      await db.request()
        .input('key',     page.key)
        .input('name',    page.name)
        .input('path',    page.path)
        .input('section', page.section)
        .input('access',  page.accessMode)
        .input('sort',    page.sort)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = @key)
          BEGIN
            INSERT INTO dbo.TblSystemPages (PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
            VALUES (@key, @name, @path, @section, @access, @sort)
          END
          ELSE
          BEGIN
            UPDATE dbo.TblSystemPages
            SET PageName=@name, PagePath=@path, Section=@section, SortOrder=@sort
            WHERE PageKey=@key
          END
        `);

      // For newly inserted pages: assign defaultRoles if provided
      if (page.defaultRoles && page.defaultRoles.length > 0) {
        for (const roleKey of page.defaultRoles) {
          await db.request()
            .input('pk', page.key)
            .input('rk', roleKey)
            .query(`
              DECLARE @pid INT = (SELECT PageID FROM dbo.TblSystemPages WHERE PageKey=@pk)
              DECLARE @rid INT = (SELECT RoleID FROM dbo.TblRoles WHERE RoleKey=@rk)
              IF @pid IS NOT NULL AND @rid IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM dbo.TblPageRoleAccess WHERE PageID=@pid AND RoleID=@rid)
                INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
                VALUES (@pid, @rid, 1, 0, 0)
            `);
        }
      }
    }

    console.log('[pages-sync] Registry synced ✓');
  } catch (err: any) {
    // Non-fatal — log but don't crash the app
    console.warn('[pages-sync] Sync failed (non-fatal):', err.message);
    // Reset so it retries next time
    synced = false;
  }
}
