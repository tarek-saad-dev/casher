-- Read-only DRVO POS write-readiness inspection.
-- Run ONLY against isolated staging database last132_agent.
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent' THROW 51000, 'STAGING_DATABASE_ONLY', 1;
DECLARE @tenant uniqueidentifier = 'B1CB423E-F36B-1410-8822-009EC495C7E1';
DECLARE @branch int = 45;

PRINT '=== TENANT SERVICES (NO GLOBAL FALLBACK) ===';
SELECT COUNT(*) AS TenantActiveServices,
       SUM(CASE WHEN SPrice1 IS NOT NULL AND SPrice1 >= 0 THEN 1 ELSE 0 END) AS PricedServices
FROM dbo.TblPro WHERE TenantId = @tenant AND ISNULL(isDeleted, 0) = 0;
SELECT TOP (15) ProID, ProName, ProNameAr, SPrice1, ProType, DurationMinutes
FROM dbo.TblPro WHERE TenantId = @tenant AND ISNULL(isDeleted, 0) = 0 ORDER BY ProID;

PRINT '=== TENANT BRANCH EMPLOYEES ===';
SELECT COUNT(DISTINCT e.EmpID) AS AssignedActiveEmployees
FROM dbo.TblEmp e JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
WHERE e.TenantId = @tenant AND a.BranchID = @branch
  AND ISNULL(e.isActive, 0) = 1 AND e.IsArchived = 0
  AND a.IsActive = 1
  AND a.EffectiveFrom <= CONVERT(date, SYSDATETIME())
  AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CONVERT(date, SYSDATETIME()));
SELECT TOP (15) e.EmpID, e.EmpName, a.BranchID, a.IsActive, a.EffectiveFrom, a.EffectiveTo
FROM dbo.TblEmp e JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
WHERE e.TenantId = @tenant AND a.BranchID = @branch ORDER BY e.EmpID;

PRINT '=== WRITE DEPENDENCY TABLE COLUMNS ===';
SELECT tb.name AS TableName, c.column_id, c.name AS ColumnName,
       ty.name AS SqlType, c.is_nullable, c.is_identity, dc.definition AS DefaultValue
FROM sys.tables tb JOIN sys.columns c ON c.object_id = tb.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE tb.schema_id = SCHEMA_ID('dbo')
AND tb.name IN ('TblClient','TblPaymentMethods','TblNewDay','TblShiftMove',
 'TblEmpServiceSettings','TblinvServHead','TblinvServDetail','TblPro','TblEmp',
 'TblEmpBranchAssignment','DrvoTenantRolePermission')
ORDER BY tb.name, c.column_id;

PRINT '=== INVOICE INDEXES AND UNIQUENESS ===';
SELECT tb.name AS TableName, ix.name AS IndexName, ix.is_unique, ix.is_primary_key,
       ic.key_ordinal, col.name AS ColumnName
FROM sys.tables tb JOIN sys.indexes ix ON ix.object_id = tb.object_id
JOIN sys.index_columns ic ON ic.object_id = ix.object_id AND ic.index_id = ix.index_id
JOIN sys.columns col ON col.object_id = tb.object_id AND col.column_id = ic.column_id
WHERE tb.name IN ('TblinvServHead','TblinvServDetail','TblClient','TblNewDay')
  AND ix.index_id > 0 AND ic.key_ordinal > 0
ORDER BY tb.name, ix.name, ic.key_ordinal;

PRINT '=== PAYMENT METHODS ===';
SELECT TOP (20) * FROM dbo.TblPaymentMethods ORDER BY PaymentID;

PRINT '=== DEMO BRANCH BUSINESS DAYS (READ ONLY) ===';
SELECT TOP (5) * FROM dbo.TblNewDay WHERE BranchID = @branch ORDER BY ID DESC;

PRINT '=== POS ROLE GRANTS ===';
SELECT r.RoleKey, rp.PermissionKey
FROM dbo.DrvoTenantRole r JOIN dbo.DrvoTenantRolePermission rp
  ON rp.TenantId = r.TenantId AND rp.RoleId = r.RoleId
WHERE r.TenantId = @tenant AND rp.PermissionKey IN (N'pos.read',N'pos.sell')
ORDER BY r.RoleKey, rp.PermissionKey;
