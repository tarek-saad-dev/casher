-- DRVO: Widen TblBookingHold.HoldKey for tenant-namespaced hold keys.
-- Idempotent. Preserves rows and unique HoldKey constraint/index.

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblBookingHold', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBookingHold (
    HoldID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    BranchID INT NOT NULL,
    EmpID INT NOT NULL,
    BusinessDate DATE NOT NULL,
    StartAt DATETIME2 NOT NULL,
    EndAt DATETIME2 NOT NULL,
    ExpiresAt DATETIME2 NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_TblBookingHold_Status DEFAULT (N'active'),
    HoldKey NVARCHAR(200) NOT NULL,
    SessionKey NVARCHAR(120) NULL,
    ClientRequestId NVARCHAR(80) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TblBookingHold_Created DEFAULT (SYSUTCDATETIME()),
    ConsumedAt DATETIME2 NULL,
    ReleasedAt DATETIME2 NULL,
    CONSTRAINT UQ_TblBookingHold_HoldKey UNIQUE (HoldKey)
  );
  CREATE INDEX IX_TblBookingHold_Emp_Start_Active
    ON dbo.TblBookingHold (EmpID, StartAt, EndAt, Status, ExpiresAt);
  CREATE INDEX IX_TblBookingHold_Branch_Date
    ON dbo.TblBookingHold (BranchID, BusinessDate, Status);
  PRINT 'Created TblBookingHold with HoldKey NVARCHAR(200)';
END
ELSE
BEGIN
  DECLARE @maxLen INT =
    (
      SELECT CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo'
        AND TABLE_NAME = N'TblBookingHold'
        AND COLUMN_NAME = N'HoldKey'
    );

  IF @maxLen IS NULL OR @maxLen < 200
  BEGIN
    -- Drop unique constraint/index on HoldKey if present, widen, recreate.
    DECLARE @uqName SYSNAME =
      (
        SELECT kc.name
        FROM sys.key_constraints kc
        INNER JOIN sys.index_columns ic
          ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
        INNER JOIN sys.columns c
          ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE kc.parent_object_id = OBJECT_ID(N'dbo.TblBookingHold')
          AND kc.type = N'UQ'
          AND c.name = N'HoldKey'
      );

    IF @uqName IS NOT NULL
    BEGIN
      DECLARE @dropSql NVARCHAR(400) = N'ALTER TABLE dbo.TblBookingHold DROP CONSTRAINT ' + QUOTENAME(@uqName);
      EXEC sp_executesql @dropSql;
    END

    ALTER TABLE dbo.TblBookingHold ALTER COLUMN HoldKey NVARCHAR(200) NOT NULL;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.key_constraints kc
      INNER JOIN sys.index_columns ic
        ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE kc.parent_object_id = OBJECT_ID(N'dbo.TblBookingHold')
        AND kc.type = N'UQ'
        AND c.name = N'HoldKey'
    )
    BEGIN
      ALTER TABLE dbo.TblBookingHold
        ADD CONSTRAINT UQ_TblBookingHold_HoldKey UNIQUE (HoldKey);
    END

    PRINT 'Widened TblBookingHold.HoldKey to NVARCHAR(200)';
  END
  ELSE
    PRINT 'TblBookingHold.HoldKey already >= 200';
END
GO
