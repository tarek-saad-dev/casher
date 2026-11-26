import 'server-only';
import { getPool,sql } from '@/lib/db';
import { buildAnalytics,type AnalyticsPeriod,type CohortCounts } from './analyticsModel';

/** Aggregate-only; a rolling cohort by initial persisted registration date.
 * Excludes demo and non-salon registrations. No visitor tracking or contact data.
 * Operational evidence is current and uses existing tenant/branch ownership.
 */
export async function loadOnboardingAnalytics(days:AnalyticsPeriod){
  const pool=await getPool();
  const result=await pool.request().input('days',sql.Int,days).query(`
    WITH cohort AS (
      SELECT SignupId, Status, TenantId, ProvisionedAt
      FROM dbo.PublicSignupRegistration
      WHERE CreatedAt >= DATEADD(DAY,-@days,SYSUTCDATETIME())
        AND IndustryCode=N'salon' AND StartMode=N'real'
    ),
    evidence AS (
      SELECT c.Status,
        CASE WHEN c.Status=N'provisioned' AND c.TenantId IS NOT NULL AND c.ProvisionedAt IS NOT NULL THEN 1 ELSE 0 END AS provisioned,
        ISNULL(branchEvidence.branchReady,0) AS branchReady,
        ISNULL(branchEvidence.teamReady,0) AS teamReady,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.TblPro p WHERE p.TenantId=c.TenantId AND ISNULL(p.isDeleted,0)=0) THEN 1 ELSE 0 END AS catalogReady,
        ISNULL(branchEvidence.dayReady,0) AS dayReady,
        ISNULL(branchEvidence.shiftReady,0) AS shiftReady,
        sale.firstSaleDate,
        CASE WHEN EXISTS (
          SELECT 1 FROM dbo.Bookings k INNER JOIN dbo.Location l ON l.LegacyBranchId=k.BranchID
          WHERE l.TenantId=c.TenantId
        ) THEN 1 ELSE 0 END AS booked,
        CASE WHEN sale.firstSaleDate >= CAST(c.ProvisionedAt AS date)
          THEN DATEDIFF(DAY,CAST(c.ProvisionedAt AS date),sale.firstSaleDate) ELSE NULL END AS firstSaleDays
      FROM cohort c
      OUTER APPLY (
        SELECT MAX(CASE WHEN f.branchReady=1 THEN 1 ELSE 0 END) AS branchReady,
          MAX(CASE WHEN f.branchReady=1 AND f.teamReady=1 THEN 1 ELSE 0 END) AS teamReady,
          MAX(CASE WHEN f.branchReady=1 AND f.teamReady=1 AND f.dayReady=1 THEN 1 ELSE 0 END) AS dayReady,
          MAX(CASE WHEN f.branchReady=1 AND f.teamReady=1 AND f.dayReady=1 AND f.shiftReady=1 THEN 1 ELSE 0 END) AS shiftReady
        FROM (
          SELECT
            CASE WHEN b.IsActive=1 AND l.Status=N'active'
              AND b.LifecycleStatus IN (N'INTERNAL_LIVE',N'PUBLIC_LIVE')
              AND NULLIF(LTRIM(RTRIM(b.Address)),N'') IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(b.Phone)),N'') IS NOT NULL
              AND b.DefaultOpenTime IS NOT NULL AND b.DefaultCloseTime IS NOT NULL
              AND b.DefaultOpenTime<>b.DefaultCloseTime THEN 1 ELSE 0 END AS branchReady,
            CASE WHEN EXISTS (
              SELECT 1 FROM dbo.TblEmp e INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID=e.EmpID
              WHERE e.TenantId=c.TenantId AND a.BranchID=b.BranchID AND ISNULL(e.isActive,1)=1 AND a.IsActive=1
                AND a.EffectiveFrom<=CAST(GETUTCDATE() AS date)
                AND (a.EffectiveTo IS NULL OR a.EffectiveTo>=CAST(GETUTCDATE() AS date))
            ) THEN 1 ELSE 0 END AS teamReady,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.TblNewDay d WHERE d.BranchID=b.BranchID) THEN 1 ELSE 0 END AS dayReady,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.TblShiftMove s WHERE s.BranchID=b.BranchID) THEN 1 ELSE 0 END AS shiftReady
          FROM dbo.Location l INNER JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
          WHERE l.TenantId=c.TenantId
        ) f
      ) branchEvidence
      OUTER APPLY (
        SELECT MIN(CAST(h.invDate AS date)) AS firstSaleDate
        FROM dbo.TblinvServHead h INNER JOIN dbo.Location l ON l.LegacyBranchId=h.BranchID
        WHERE l.TenantId=c.TenantId AND h.invType=N'مبيعات'
      ) sale
    )
    SELECT COUNT_BIG(*) AS submitted,
      SUM(CONVERT(bigint,provisioned)) AS provisioned,
      SUM(CASE WHEN Status=N'failed' THEN CONVERT(bigint,1) ELSE 0 END) AS failed,
      SUM(CASE WHEN Status=N'provisioning' THEN CONVERT(bigint,1) ELSE 0 END) AS provisioning,
      SUM(CASE WHEN provisioned=1 AND branchReady=1 THEN CONVERT(bigint,1) ELSE 0 END) AS branch,
      SUM(CASE WHEN provisioned=1 AND branchReady=1 AND catalogReady=1 THEN CONVERT(bigint,1) ELSE 0 END) AS catalog,
      SUM(CASE WHEN provisioned=1 AND catalogReady=1 AND teamReady=1 THEN CONVERT(bigint,1) ELSE 0 END) AS team,
      SUM(CASE WHEN provisioned=1 AND catalogReady=1 AND dayReady=1 THEN CONVERT(bigint,1) ELSE 0 END) AS day,
      SUM(CASE WHEN provisioned=1 AND catalogReady=1 AND shiftReady=1 THEN CONVERT(bigint,1) ELSE 0 END) AS shift,
      SUM(CASE WHEN provisioned=1 AND firstSaleDate IS NOT NULL THEN CONVERT(bigint,1) ELSE 0 END) AS sold,
      SUM(CASE WHEN provisioned=1 AND booked=1 THEN CONVERT(bigint,1) ELSE 0 END) AS booked,
      SUM(CASE WHEN provisioned=1 AND firstSaleDays IS NOT NULL THEN CONVERT(bigint,firstSaleDays) ELSE 0 END) AS firstSaleDaysTotal,
      SUM(CASE WHEN provisioned=1 AND firstSaleDays IS NOT NULL THEN CONVERT(bigint,1) ELSE 0 END) AS firstSaleMeasured
    FROM evidence;
  `);
  const row=result.recordset[0]??{};
  const keys=['submitted','provisioned','failed','provisioning','branch','catalog','team','day','shift','sold','booked','firstSaleDaysTotal','firstSaleMeasured'] as const;
  const counts=Object.fromEntries(keys.map(k=>[k,Number(row[k]??0)])) as CohortCounts;
  return {period:days,generatedAtUtc:new Date().toISOString(),...buildAnalytics(counts)};
}
