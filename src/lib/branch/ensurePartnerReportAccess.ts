import 'server-only';
import { getPool, sql } from '@/lib/db';
import { PARTNER_ROLE_KEY } from '@/lib/partnerAccess';

export type EnsurePartnerReportAccessResult = {
  updatedAccessRows: number;
};

/**
 * Partner accounts exist to view the partners report. Ensure every active
 * branch-access row for users with the partner role has CanViewReports = 1.
 *
 * Safe to call repeatedly (idempotent).
 */
export async function ensurePartnerUsersCanViewReports(
  userId?: number,
): Promise<EnsurePartnerReportAccessResult> {
  const db = await getPool();
  const req = db.request();
  let userFilter = '';
  if (userId != null) {
    req.input('userId', sql.Int, userId);
    userFilter = 'AND u.UserID = @userId';
  }

  const result = await req
    .input('roleKey', sql.NVarChar(50), PARTNER_ROLE_KEY)
    .query(`
    UPDATE uba
    SET CanViewReports = 1,
        UpdatedAt = SYSUTCDATETIME(),
        GrantReason = CASE
          WHEN uba.GrantReason IS NULL OR LTRIM(RTRIM(uba.GrantReason)) = N''
            THEN N'partner-role-report-access'
          WHEN uba.GrantReason LIKE N'%partner-role-report-access%'
            THEN uba.GrantReason
          ELSE uba.GrantReason + N';partner-role-report-access'
        END
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    INNER JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = @roleKey
    WHERE ISNULL(u.isDeleted, 0) = 0
      AND uba.IsActive = 1
      AND uba.CanViewReports = 0
      ${userFilter}
  `);

  return { updatedAccessRows: Number(result.rowsAffected?.[0] ?? 0) };
}
