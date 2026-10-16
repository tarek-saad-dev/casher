/*
 DRVO ERP staging schema compatibility — READ ONLY.
 Connect with the isolated staging login to last132_agent.
 No CREATE/ALTER/UPDATE/DELETE, no dynamic SQL, no GO batches.
 Does not verify backup restorability or approve migrations.
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51010, 'DRVO_COMPAT_WRONG_DATABASE', 1;

SELECT DB_NAME() AS DatabaseName, SUSER_SNAME() AS LoginName,
       HAS_DBACCESS(N'last132') AS ProductionAccess;

SELECT v.TableName,
  CASE WHEN OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NULL THEN N'MISSING' ELSE N'PRESENT' END AS TableState
FROM (VALUES (N'Tenant'), (N'TenantMembership'), (N'Location'),
  (N'DrvoTenantRole'), (N'DrvoTenantRolePermission'),
  (N'DrvoTenantRoleAssignment'), (N'DrvoTenantModuleEntitlement')) v(TableName)
ORDER BY v.TableName;

SELECT v.TableName, v.ColumnName,
  c.name AS ActualColumn, ty.name AS ActualType,
  c.max_length AS MaxLengthBytes, c.is_nullable AS IsNullable
FROM (VALUES
  (N'Tenant', N'TenantId'),
  (N'TenantMembership', N'TenantId'),
  (N'TenantMembership', N'MembershipId'),
  (N'TenantMembership', N'LegacyUserId')
) v(TableName, ColumnName)
LEFT JOIN sys.tables t ON t.name = v.TableName AND t.schema_id = SCHEMA_ID(N'dbo')
LEFT JOIN sys.columns c ON c.object_id = t.object_id AND c.name = v.ColumnName
LEFT JOIN sys.types ty ON ty.user_type_id = c.user_type_id
ORDER BY v.TableName, v.ColumnName;

SELECT t.name AS TableName, i.name AS IndexName, i.is_unique AS IsUnique,
  i.is_primary_key AS IsPrimaryKey, ic.key_ordinal AS KeyOrdinal,
  c.name AS ColumnName
FROM sys.tables t
JOIN sys.indexes i ON i.object_id = t.object_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
WHERE t.schema_id = SCHEMA_ID(N'dbo')
  AND t.name IN (N'Tenant', N'TenantMembership')
  AND ic.key_ordinal > 0
ORDER BY t.name, i.name, ic.key_ordinal;

-- Do not reference columns dynamically until metadata proves their presence.
IF COL_LENGTH(N'dbo.TenantMembership', N'TenantId') IS NOT NULL
   AND COL_LENGTH(N'dbo.TenantMembership', N'MembershipId') IS NOT NULL
BEGIN
  EXEC sys.sp_executesql N'
    SELECT TOP (20) TenantId, MembershipId, COUNT_BIG(*) AS DuplicateCount
    FROM dbo.TenantMembership
    GROUP BY TenantId, MembershipId
    HAVING COUNT_BIG(*) > 1
    ORDER BY DuplicateCount DESC';
END
ELSE SELECT N'SKIPPED_MISSING_COLUMNS' AS DuplicateCheck;

SELECT fk.name AS ForeignKeyName,
  OBJECT_NAME(fk.parent_object_id) AS ChildTable,
  OBJECT_NAME(fk.referenced_object_id) AS ParentTable,
  fk.is_disabled AS IsDisabled
FROM sys.foreign_keys fk
WHERE fk.parent_object_id IN
  (OBJECT_ID(N'dbo.TenantMembership'), OBJECT_ID(N'dbo.DrvoTenantRoleAssignment'))
ORDER BY ChildTable, ForeignKeyName;
