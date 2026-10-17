-- Read-only staging catalog / employee / invoice schema discovery.
-- Never execute against production. No data mutations.
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51010, 'STAGING_ONLY', 1;

PRINT '=== CANDIDATE TABLES ===';
SELECT t.name AS TableName
FROM sys.tables AS t
WHERE t.name LIKE '%Pro%' OR t.name LIKE '%Service%'
   OR t.name LIKE '%Emp%Branch%' OR t.name LIKE '%Branch%Emp%'
   OR t.name LIKE '%Price%' OR t.name LIKE '%Invoice%'
ORDER BY t.name;

PRINT '=== RELEVANT COLUMNS ===';
SELECT t.name AS TableName, c.column_id, c.name AS ColumnName,
       TYPE_NAME(c.user_type_id) AS SqlType, c.max_length, c.is_nullable
FROM sys.tables AS t
JOIN sys.columns AS c ON c.object_id = t.object_id
WHERE t.name IN (
  N'TblPro', N'TblEmp', N'TblinvServHead', N'TblinvServDetail',
  N'TblEmpBranchAssignment', N'TblEmpPro', N'TblBranchService',
  N'TblServiceBranch', N'TblEmpService', N'TblEmpServiceAssignment',
  N'TblBranch', N'Location'
)
OR (t.name LIKE '%Service%' AND
    (c.name LIKE '%Branch%' OR c.name LIKE '%Pro%' OR
     c.name LIKE '%Price%' OR c.name LIKE '%Emp%'))
ORDER BY t.name, c.column_id;

PRINT '=== FOREIGN KEYS ===';
SELECT fk.name AS ForeignKeyName, OBJECT_NAME(fk.parent_object_id) AS ParentTable,
       pc.name AS ParentColumn, OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
       rc.name AS ReferencedColumn
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns AS pc ON pc.object_id = fk.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.columns AS rc ON rc.object_id = fk.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE OBJECT_NAME(fk.parent_object_id) IN (
  N'TblPro', N'TblEmp', N'TblinvServDetail', N'TblinvServHead',
  N'TblEmpBranchAssignment'
) OR OBJECT_NAME(fk.referenced_object_id) IN (N'TblPro', N'TblEmp')
ORDER BY ParentTable, ForeignKeyName;

PRINT '=== DEMO BRANCH STATUS ===';
SELECT b.BranchID, b.BranchCode, b.BranchName, b.IsActive,
       b.LifecycleStatus, l.LocationId, l.TenantId, l.Status AS LocationStatus
FROM dbo.TblBranch AS b
JOIN dbo.Location AS l ON l.LegacyBranchId = b.BranchID
WHERE b.BranchID = 45
  AND l.TenantId = 'B1CB423E-F36B-1410-8822-009EC495C7E1';

PRINT '=== DEMO INVOICE COUNT ===';
SELECT COUNT_BIG(*) AS InvoiceCount
FROM dbo.TblinvServHead
WHERE BranchID = 45 AND invType = N'مبيعات';

PRINT '=== CATALOG SIZE ===';
SELECT COUNT_BIG(*) AS ActiveGlobalServices
FROM dbo.TblPro
WHERE ISNULL(isDeleted, 0) = 0;
