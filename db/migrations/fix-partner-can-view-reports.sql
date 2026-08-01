-- Grant partners report visibility on their linked branches.
-- Root cause: Phase 1B backfill set CanViewReports=1 only for admins;
-- partner-role users could open /admin/reports/partners (page ACL) but
-- GET /api/admin/reports/partners returned 403 REPORT_NOT_ALLOWED.

SET NOCOUNT ON;

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
INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = N'partner'
WHERE ISNULL(u.isDeleted, 0) = 0
  AND uba.IsActive = 1
  AND uba.CanViewReports = 0;

PRINT CONCAT(N'Updated partner CanViewReports rows: ', @@ROWCOUNT);
