-- FORENSIC INVESTIGATION: TblCashMove Duplicate Insertion
-- Date: 2026-04-06
-- Issue: invID appears twice in TblCashMove but only once in TblinvServHead

USE HawaiDB;
GO

PRINT '========================================';
PRINT 'QUERY 1: All Triggers on Sales/Cash Tables';
PRINT '========================================';
SELECT
    t.name AS TriggerName,
    OBJECT_SCHEMA_NAME(t.parent_id) AS ParentSchema,
    OBJECT_NAME(t.parent_id) AS ParentTable,
    t.is_disabled,
    t.is_instead_of_trigger,
    CASE 
        WHEN t.is_instead_of_trigger = 1 THEN 'INSTEAD OF'
        ELSE 'AFTER'
    END AS TriggerType,
    m.definition
FROM sys.triggers t
JOIN sys.sql_modules m ON m.object_id = t.object_id
WHERE OBJECT_NAME(t.parent_id) IN ('TblinvServHead', 'TblCashMove', 'TblinvServPayment')
ORDER BY ParentTable, TriggerName;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 2: All Database Modules that INSERT into TblCashMove';
PRINT '========================================';
SELECT
    o.type_desc AS ObjectType,
    s.name AS SchemaName,
    o.name AS ObjectName,
    CASE o.type
        WHEN 'P' THEN 'Stored Procedure'
        WHEN 'FN' THEN 'Scalar Function'
        WHEN 'IF' THEN 'Inline Table Function'
        WHEN 'TF' THEN 'Table Function'
        WHEN 'TR' THEN 'Trigger'
        WHEN 'V' THEN 'View'
        ELSE o.type_desc
    END AS ObjectTypeReadable,
    LEN(m.definition) AS DefinitionLength,
    m.definition
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE m.definition LIKE '%INSERT%TblCashMove%'
   OR m.definition LIKE '%INTO [dbo].[TblCashMove]%'
   OR m.definition LIKE '%INTO dbo.TblCashMove%'
   OR m.definition LIKE '%INSERT INTO TblCashMove%'
ORDER BY ObjectType, ObjectName;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 3: Code Paths with TblinvServHead + TblCashMove';
PRINT '========================================';
SELECT
    o.type_desc AS ObjectType,
    s.name AS SchemaName,
    o.name AS ObjectName,
    CASE 
        WHEN m.definition LIKE '%AFTER INSERT%' THEN 'Has AFTER INSERT'
        WHEN m.definition LIKE '%INSTEAD OF INSERT%' THEN 'Has INSTEAD OF INSERT'
        ELSE ''
    END AS TriggerPattern,
    CASE
        WHEN m.definition LIKE '%DELETE FROM TblCashMove%' THEN 'Deletes TblCashMove'
        WHEN m.definition LIKE '%UPDATE TblCashMove%' THEN 'Updates TblCashMove'
        ELSE ''
    END AS ModificationPattern
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE m.definition LIKE '%TblinvServHead%'
  AND m.definition LIKE '%TblCashMove%'
ORDER BY ObjectType, ObjectName;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 4: All Stored Procedures Related to Sales/Invoice Saving';
PRINT '========================================';
SELECT
    s.name AS SchemaName,
    o.name AS ProcedureName,
    CASE
        WHEN m.definition LIKE '%TblinvServHead%' THEN 'YES'
        ELSE 'NO'
    END AS UsesTblinvServHead,
    CASE
        WHEN m.definition LIKE '%TblCashMove%' THEN 'YES'
        ELSE 'NO'
    END AS UsesTblCashMove,
    CASE
        WHEN m.definition LIKE '%TblinvServPayment%' THEN 'YES'
        ELSE 'NO'
    END AS UsesTblinvServPayment,
    CASE
        WHEN m.definition LIKE '%INSERT INTO TblinvServHead%' THEN 'YES'
        ELSE 'NO'
    END AS InsertsSalesHeader,
    CASE
        WHEN m.definition LIKE '%INSERT%TblCashMove%' THEN 'YES'
        ELSE 'NO'
    END AS InsertsCashMove
FROM sys.procedures p
JOIN sys.objects o ON o.object_id = p.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE m.definition LIKE '%TblinvServHead%'
   OR m.definition LIKE '%مبيعات%'
   OR m.definition LIKE '%Invoice%'
   OR m.definition LIKE '%Sale%'
ORDER BY ProcedureName;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 5: Trigger Details - Full Definition';
PRINT '========================================';
SELECT
    t.name AS TriggerName,
    OBJECT_NAME(t.parent_id) AS ParentTable,
    'Definition:' AS Label,
    m.definition AS FullDefinition
FROM sys.triggers t
JOIN sys.sql_modules m ON m.object_id = t.object_id
WHERE OBJECT_NAME(t.parent_id) IN ('TblinvServHead', 'TblCashMove', 'TblinvServPayment')
ORDER BY ParentTable, TriggerName;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 6: Find Procedures Called by Other Procedures (Chain)';
PRINT '========================================';
SELECT DISTINCT
    'Caller: ' + OBJECT_SCHEMA_NAME(o1.object_id) + '.' + o1.name AS CallerProcedure,
    'Calls: ' + OBJECT_SCHEMA_NAME(o2.object_id) + '.' + o2.name AS CalledProcedure
FROM sys.sql_modules m1
JOIN sys.objects o1 ON o1.object_id = m1.object_id
CROSS APPLY (
    SELECT o2.object_id, o2.name
    FROM sys.objects o2
    WHERE o2.type = 'P'
      AND m1.definition LIKE '%' + o2.name + '%'
) o2
WHERE o1.type = 'P'
  AND (
    m1.definition LIKE '%TblinvServHead%'
    OR m1.definition LIKE '%TblCashMove%'
  )
ORDER BY CallerProcedure, CalledProcedure;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 7: Sample Duplicate Data from TblCashMove';
PRINT '========================================';
SELECT TOP 10
    cm.ID,
    cm.invID,
    cm.invType,
    cm.MoveDate,
    cm.MoveType,
    cm.Amount,
    cm.ShiftMoveID,
    cm.UserID,
    cm.Notes,
    COUNT(*) OVER (PARTITION BY cm.invID, cm.invType) AS DuplicateCount
FROM dbo.TblCashMove cm
WHERE cm.invID IN (
    SELECT invID
    FROM dbo.TblCashMove
    WHERE invType = N'مبيعات'
      AND CAST(MoveDate AS DATE) >= '2026-04-01'
    GROUP BY invID, invType
    HAVING COUNT(*) > 1
)
ORDER BY cm.invID, cm.ID;

PRINT '';
PRINT '========================================';
PRINT 'QUERY 8: Check for Transaction/Rollback Patterns';
PRINT '========================================';
SELECT
    o.type_desc AS ObjectType,
    s.name AS SchemaName,
    o.name AS ObjectName,
    CASE WHEN m.definition LIKE '%BEGIN TRAN%' OR m.definition LIKE '%BEGIN TRANSACTION%' THEN 'YES' ELSE 'NO' END AS UsesTransaction,
    CASE WHEN m.definition LIKE '%ROLLBACK%' THEN 'YES' ELSE 'NO' END AS HasRollback,
    CASE WHEN m.definition LIKE '%COMMIT%' THEN 'YES' ELSE 'NO' END AS HasCommit,
    CASE WHEN m.definition LIKE '%TRY%CATCH%' THEN 'YES' ELSE 'NO' END AS UsesTryCatch
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE (m.definition LIKE '%TblinvServHead%' OR m.definition LIKE '%TblCashMove%')
  AND o.type = 'P'
ORDER BY ObjectName;