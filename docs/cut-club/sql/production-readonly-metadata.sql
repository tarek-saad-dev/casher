/*
 CUT CLUB 2.0 — PRODUCTION READ-ONLY METADATA INSPECTION PROPOSAL.

 Owner approved direct Production DB discovery. HOWEVER, this is a script
 for a separately connected, least-privilege production operator; GitHub
 access does not execute SQL. No production connection was made here.
 Set @ExpectedDb from verified operator configuration before executing.
 Do NOT run with broad UPDATE/ALTER permissions. No user rows queried.
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 3000;

DECLARE @ExpectedDb sysname = N'__OPERATOR_VERIFY_DATABASE_NAME__';
IF DB_NAME() <> @ExpectedDb OR @ExpectedDb = N'__OPERATOR_VERIFY_DATABASE_NAME__'
  THROW 51980, 'CUT CLUB read-only metadata: unverified production DB', 1;

SELECT DB_NAME() AS DatabaseName,
       DB_ID() AS DatabaseId,
       @@SERVERNAME AS ServerName;

-- Schema columns and data types ONLY; no customer records, phone or balances.
SELECT s.name AS SchemaName, t.name AS TableName,
       c.name AS ColumnName, ty.name AS DataType,
       c.is_nullable AS Nullable, c.max_length AS MaxLength
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
WHERE s.name = N'dbo'
  AND t.name IN (
    N'Tenant', N'LegacyIdMap', N'Location',
    N'TblClient', N'TblClientLoyalty', N'TblLoyaltyTier',
    N'TblLoyaltyPointLedger', N'TblClientInventory',
    N'TblLoyaltyStoreItem', N'TblClientReferral',
    N'CustomerOtpChallenge', N'CustomerSession'
  )
ORDER BY t.name, c.column_id;

SELECT OBJECT_SCHEMA_NAME(fk.parent_object_id) AS ChildSchema,
       OBJECT_NAME(fk.parent_object_id) AS ChildTable,
       fk.name AS ForeignKeyName,
       OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS ParentSchema,
       OBJECT_NAME(fk.referenced_object_id) AS ParentTable
FROM sys.foreign_keys AS fk
WHERE OBJECT_NAME(fk.parent_object_id) IN (
  N'LegacyIdMap', N'Location', N'TblClientLoyalty',
  N'TblLoyaltyPointLedger', N'TblClientInventory',
  N'CustomerSession'
)
ORDER BY ChildTable, ForeignKeyName;

-- Index definitions, not row counts or index contents.
SELECT OBJECT_NAME(i.object_id) AS TableName,
       i.name AS IndexName,
       i.is_unique AS IsUnique,
       i.is_primary_key AS IsPrimaryKey,
       i.has_filter AS HasFilter,
       i.filter_definition AS FilterDefinition
FROM sys.indexes AS i
WHERE OBJECT_NAME(i.object_id) IN (
  N'LegacyIdMap', N'TblClient', N'TblClientLoyalty',
  N'TblLoyaltyPointLedger', N'TblClientInventory'
)
AND i.index_id > 0
ORDER BY TableName, IndexName;
