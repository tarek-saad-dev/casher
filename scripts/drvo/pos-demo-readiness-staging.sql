-- Read-only POS demo readiness report. Never run on production.
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51030, 'STAGING_ONLY', 1;
DECLARE @tenant UNIQUEIDENTIFIER = 'B1CB423E-F36B-1410-8822-009EC495C7E1';
DECLARE @branch INT = 45;
IF (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenant AND LegacyBranchId=@branch AND Status=N'active') <> 1
  THROW 51031, 'DEMO_LOCATION_NOT_ACTIVE', 1;
PRINT '=== DEMO POS READINESS ===';
SELECT
 (SELECT COUNT_BIG(*) FROM dbo.TblPro WHERE TenantId=@tenant AND ISNULL(isDeleted,0)=0) AS TenantActiveServices,
 (SELECT COUNT_BIG(*) FROM dbo.TblPro WHERE TenantId=@tenant AND ISNULL(isDeleted,0)=0 AND SPrice1 IS NOT NULL AND SPrice1 >= 0) AS TenantPricedServices,
 (SELECT COUNT_BIG(*) FROM dbo.TblEmp e WHERE e.TenantId=@tenant AND ISNULL(e.isActive,0)=1 AND e.IsArchived=0
    AND EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment a WHERE a.EmpID=e.EmpID AND a.BranchID=@branch AND a.IsActive=1
      AND a.EffectiveFrom<=CONVERT(date,SYSDATETIME()) AND (a.EffectiveTo IS NULL OR a.EffectiveTo>=CONVERT(date,SYSDATETIME())))) AS BranchActiveEmployees,
 (SELECT COUNT_BIG(*) FROM dbo.TblinvServHead WHERE BranchID=@branch AND invType=N'مبيعات') AS BranchSales;
PRINT '=== TENANT SERVICES (FIRST 20) ===';
SELECT TOP (20) ProID, ProName, ProNameAr, SPrice1, DurationMinutes
FROM dbo.TblPro WHERE TenantId=@tenant AND ISNULL(isDeleted,0)=0 ORDER BY ProID;
PRINT '=== BRANCH EMPLOYEES (FIRST 20) ===';
SELECT TOP (20) e.EmpID, e.EmpName, a.EffectiveFrom, a.EffectiveTo
FROM dbo.TblEmp e JOIN dbo.TblEmpBranchAssignment a ON a.EmpID=e.EmpID
WHERE e.TenantId=@tenant AND a.BranchID=@branch AND a.IsActive=1 AND e.IsArchived=0
ORDER BY e.EmpID;
