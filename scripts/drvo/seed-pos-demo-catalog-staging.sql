-- Explicit, idempotent demo-only POS catalog seed.
-- Never run against production. No invoices, no grants, no operational shifts.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' THROW 51000, 'STAGING_DATABASE_ONLY', 1;
DECLARE @tenant uniqueidentifier = 'B1CB423E-F36B-1410-8822-009EC495C7E1';
DECLARE @location uniqueidentifier = 'B3CB423E-F36B-1410-8822-009EC495C7E1';
DECLARE @branch int = 45;
DECLARE @emp int;
DECLARE @hair int;
DECLARE @beard int;
DECLARE @today date = CONVERT(date, SYSDATETIME());

BEGIN TRANSACTION;
IF NOT EXISTS (
 SELECT 1 FROM dbo.Tenant t WITH (UPDLOCK, HOLDLOCK)
 JOIN dbo.Location l ON l.TenantId = t.TenantId
 JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
 WHERE t.TenantId = @tenant AND t.Code = N'DRVO_DEMO_SALON_01'
   AND t.Status = N'active' AND l.LocationId = @location
   AND l.LegacyBranchId = @branch AND l.Status = N'active'
   AND b.BranchCode = N'DEMO_MAIN_01' AND b.IsActive = 1
) THROW 51001, 'DEMO_TENANT_BRANCH_NOT_VERIFIED', 1;

IF EXISTS (SELECT 1 FROM dbo.TblPro WHERE TenantId = @tenant
 AND ProName IN (N'DRVO Demo Haircut', N'DRVO Demo Beard'))
 AND (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId = @tenant
 AND ProName IN (N'DRVO Demo Haircut', N'DRVO Demo Beard')) <> 2
 THROW 51002, 'PARTIAL_DEMO_CATALOG_REQUIRES_REVIEW', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.TblPro WHERE TenantId = @tenant AND ProName = N'DRVO Demo Haircut')
 INSERT INTO dbo.TblPro (TenantId, ProName, ProNameAr, ProType, SPrice1, DurationMinutes, isDeleted)
 VALUES (@tenant, N'DRVO Demo Haircut', N'قص شعر تجريبي', N'S', 200, 30, 0);
IF NOT EXISTS (SELECT 1 FROM dbo.TblPro WHERE TenantId = @tenant AND ProName = N'DRVO Demo Beard')
 INSERT INTO dbo.TblPro (TenantId, ProName, ProNameAr, ProType, SPrice1, DurationMinutes, isDeleted)
 VALUES (@tenant, N'DRVO Demo Beard', N'تحديد دقن تجريبي', N'S', 100, 20, 0);

SELECT @hair = ProID FROM dbo.TblPro WHERE TenantId = @tenant AND ProName = N'DRVO Demo Haircut';
SELECT @beard = ProID FROM dbo.TblPro WHERE TenantId = @tenant AND ProName = N'DRVO Demo Beard';
IF @hair IS NULL OR @beard IS NULL THROW 51003, 'DEMO_SERVICE_LOOKUP_FAILED', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.TblEmp WHERE TenantId = @tenant AND EmpName = N'DRVO Demo Barber')
 INSERT INTO dbo.TblEmp (TenantId, EmpName, isActive, IsArchived, DisplaySortOrder)
 VALUES (@tenant, N'DRVO Demo Barber', 1, 0, 1);

IF (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId = @tenant AND EmpName = N'DRVO Demo Barber') <> 1
 THROW 51004, 'DEMO_EMPLOYEE_NOT_UNIQUE', 1;
SELECT @emp = EmpID FROM dbo.TblEmp WHERE TenantId = @tenant AND EmpName = N'DRVO Demo Barber';

IF NOT EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment WHERE EmpID = @emp AND BranchID = @branch AND IsActive = 1)
 INSERT INTO dbo.TblEmpBranchAssignment (EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom)
 VALUES (@emp, @branch, 1, 1, 1, @today);

IF NOT EXISTS (SELECT 1 FROM dbo.TblEmpServiceSettings WHERE EmpID = @emp AND ProID = @hair AND IsActive = 1)
 INSERT INTO dbo.TblEmpServiceSettings (EmpID, ProID, DurationMinutes, IsActive)
 VALUES (@emp, @hair, 30, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.TblEmpServiceSettings WHERE EmpID = @emp AND ProID = @beard AND IsActive = 1)
 INSERT INTO dbo.TblEmpServiceSettings (EmpID, ProID, DurationMinutes, IsActive)
 VALUES (@emp, @beard, 20, 1);

COMMIT TRANSACTION;
SELECT N'DEMO_CATALOG_SEEDED' AS Result, @tenant AS TenantId, @branch AS BranchID, @emp AS EmpID, @hair AS HairProID, @beard AS BeardProID;
