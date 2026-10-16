/*
 DRVO ERP STAGING READINESS — READ ONLY
 Run manually against isolated staging last132_agent after verifying the
 connection target. Does NOT establish backup validity or approve migrations.
 No writes, no dynamic SQL, no database switches.
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51010, 'DRVO_READINESS_WRONG_DATABASE', 1;

SELECT DB_NAME() AS DatabaseName, SYSUTCDATETIME() AS CheckedAtUtc;


-- Required core tables and proposed RBAC/entitlement tables: presence is
-- reported explicitly, including missing tables (which column listings omit).
SELECT v.TableName,
       CASE WHEN OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NULL
            THEN N'MISSING' ELSE N'PRESENT' END AS TableState
FROM (VALUES
  (N'Tenant'), (N'TenantMembership'), (N'Location'),
  (N'DrvoTenantRole'), (N'DrvoTenantRolePermission'),
  (N'DrvoTenantRoleAssignment'), (N'DrvoTenantModuleEntitlement')
) AS v(TableName)
ORDER BY v.TableName;

-- Validate the columns assumed by the role-assignment composite FK.
-- Dynamic execution is intentionally avoided: this query is safe even if
-- TenantMembership or its columns are absent.
SELECT v.ColumnName,
       CASE WHEN COL_LENGTH(N'dbo.TenantMembership', v.ColumnName) IS NULL
            THEN N'MISSING' ELSE N'PRESENT' END AS ColumnState
FROM (VALUES (N'TenantId'), (N'MembershipId'), (N'LegacyUserId')) AS v(ColumnName);

-- A separate follow-up query for duplicate (TenantId, MembershipId) pairs
-- is required ONLY after confirming both columns exist. This avoids making
-- this preflight fail when the schema is not ready.

-- Inspect actual objects before applying any schema proposal.
SELECT s.name AS SchemaName, t.name AS TableName,
       c.column_id AS ColumnOrdinal, c.name AS ColumnName,
       ty.name AS SqlType, c.max_length AS MaxLength,
       c.is_nullable AS IsNullable
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE s.name = N'dbo'
  AND t.name IN (
    N'Tenant', N'TenantMembership', N'Location',
    N'DrvoTenantRole', N'DrvoTenantRolePermission',
    N'DrvoTenantRoleAssignment', N'DrvoTenantModuleEntitlement'
  )
ORDER BY t.name, c.column_id;

-- Review keys, uniqueness and constraints, including any existing indexes.
SELECT t.name AS TableName, i.name AS IndexName,
       i.is_unique AS IsUnique, i.is_primary_key AS IsPrimaryKey,
       ic.key_ordinal AS KeyOrdinal, c.name AS ColumnName
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.indexes AS i ON i.object_id = t.object_id
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE s.name = N'dbo'
  AND t.name IN (N'Tenant', N'TenantMembership', N'DrvoTenantRole',
                 N'DrvoTenantRoleAssignment', N'DrvoTenantModuleEntitlement')
  AND ic.key_ordinal > 0
ORDER BY t.name, i.name, ic.key_ordinal;

SELECT OBJECT_NAME(fk.parent_object_id) AS ChildTable,
       fk.name AS ForeignKeyName,
       OBJECT_NAME(fk.referenced_object_id) AS ParentTable,
       fk.is_disabled AS IsDisabled
FROM sys.foreign_keys AS fk
WHERE OBJECT_NAME(fk.parent_object_id) IN (
  N'TenantMembership', N'DrvoTenantRole', N'DrvoTenantRolePermission',
  N'DrvoTenantRoleAssignment', N'DrvoTenantModuleEntitlement'
)
ORDER BY ChildTable, ForeignKeyName;

-- Database backup metadata is advisory only: file existence, successful
-- RESTORE VERIFYONLY, and a restore drill must be checked independently.
SELECT TOP (10) bs.database_name, bs.backup_finish_date,
       bs.type AS BackupType, bs.is_copy_only AS IsCopyOnly,
       bmf.physical_device_name
FROM msdb.dbo.backupset AS bs
JOIN msdb.dbo.backupmediafamily AS bmf ON bmf.media_set_id = bs.media_set_id
WHERE bs.database_name = N'last132_agent'
ORDER BY bs.backup_finish_date DESC;
