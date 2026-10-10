------------------------------------------------------------
-- Legacy schema compatibility: TblinvPurchaseHead.ClientID INT NULL
-- Phase 1J POST /api/purchases takes only { lines, notes, post } and inserts ClientID = NULL;
-- legacy databases still declare ClientID NOT NULL, so every purchase insert fails.
-- Idempotent: alters only while the column is NOT NULL. No data backfill.
-- FK_TblinvPurchaseHead_TblClient is re-created with the same name, column, actions and trust state.
-- Not a DRVO platform migration (ids 1-12 are unaffected).
------------------------------------------------------------
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @db SYSNAME = DB_NAME();
IF @db NOT IN (N'last132_agent', N'last132')
BEGIN
    RAISERROR(N'allow-null-purchase-client-id: unexpected database %s; expected last132_agent (staging) or last132 (production)', 16, 1, @db) WITH NOWAIT;
    SET NOEXEC ON;
END
ELSE IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'ClientID') IS NULL
BEGIN
    RAISERROR(N'allow-null-purchase-client-id: dbo.TblinvPurchaseHead.ClientID not found', 16, 1) WITH NOWAIT;
    SET NOEXEC ON;
END
ELSE IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND name = N'ClientID'
      AND system_type_id = TYPE_ID(N'int')
)
BEGIN
    RAISERROR(N'allow-null-purchase-client-id: ClientID is not INT; refusing to alter', 16, 1) WITH NOWAIT;
    SET NOEXEC ON;
END
GO

SELECT
    c.is_nullable AS ClientIdNullableBefore,
    fk.name AS ClientFkName,
    fk.is_not_trusted AS ClientFkNotTrusted,
    fk.is_disabled AS ClientFkDisabled
FROM sys.columns c
LEFT JOIN sys.foreign_key_columns fkc
    ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
LEFT JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND c.name = N'ClientID';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND name = N'ClientID' AND is_nullable = 0
)
BEGIN
    DECLARE @fkName SYSNAME, @refTable NVARCHAR(300), @refColumn SYSNAME,
            @onDelete NVARCHAR(60), @onUpdate NVARCHAR(60), @notTrusted BIT, @disabled BIT, @sql NVARCHAR(MAX);

    SELECT TOP 1
        @fkName = fk.name,
        @refTable = QUOTENAME(OBJECT_SCHEMA_NAME(fk.referenced_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fk.referenced_object_id)),
        @refColumn = COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id),
        @onDelete = REPLACE(fk.delete_referential_action_desc, N'_', N' '),
        @onUpdate = REPLACE(fk.update_referential_action_desc, N'_', N' '),
        @notTrusted = fk.is_not_trusted,
        @disabled = fk.is_disabled
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead')
      AND COL_NAME(fkc.parent_object_id, fkc.parent_column_id) = N'ClientID'
      AND (SELECT COUNT(*) FROM sys.foreign_key_columns x WHERE x.constraint_object_id = fk.object_id) = 1;

    BEGIN TRANSACTION;

    IF @fkName IS NOT NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.TblinvPurchaseHead DROP CONSTRAINT ' + QUOTENAME(@fkName) + N';';
        EXEC sys.sp_executesql @sql;
    END;

    ALTER TABLE dbo.TblinvPurchaseHead ALTER COLUMN ClientID INT NULL;

    IF @fkName IS NOT NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.TblinvPurchaseHead WITH ' + CASE WHEN @notTrusted = 1 THEN N'NOCHECK' ELSE N'CHECK' END
            + N' ADD CONSTRAINT ' + QUOTENAME(@fkName) + N' FOREIGN KEY (ClientID) REFERENCES ' + @refTable
            + N' (' + QUOTENAME(@refColumn) + N') ON DELETE ' + @onDelete + N' ON UPDATE ' + @onUpdate + N';';
        EXEC sys.sp_executesql @sql;
        IF @disabled = 1
        BEGIN
            SET @sql = N'ALTER TABLE dbo.TblinvPurchaseHead NOCHECK CONSTRAINT ' + QUOTENAME(@fkName) + N';';
            EXEC sys.sp_executesql @sql;
        END;
    END;

    COMMIT TRANSACTION;
    PRINT N'Altered TblinvPurchaseHead.ClientID to INT NULL' + ISNULL(N'; re-created ' + @fkName, N'');
END
ELSE
    PRINT N'TblinvPurchaseHead.ClientID already allows NULL; nothing to do';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND name = N'ClientID' AND is_nullable = 0
)
    RAISERROR(N'allow-null-purchase-client-id: ClientID is still NOT NULL', 16, 1);
GO

SELECT
    c.is_nullable AS ClientIdNullableAfter,
    fk.name AS ClientFkName,
    fk.is_not_trusted AS ClientFkNotTrusted,
    fk.is_disabled AS ClientFkDisabled
FROM sys.columns c
LEFT JOIN sys.foreign_key_columns fkc
    ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
LEFT JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
WHERE c.object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND c.name = N'ClientID';
GO

SET NOEXEC OFF;
GO
