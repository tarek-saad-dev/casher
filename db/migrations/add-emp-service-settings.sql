-- ============================================================
--  TblEmpServiceSettings — per-barber service duration overrides
--  Idempotent — safe to run multiple times
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TblEmpServiceSettings')
BEGIN
  CREATE TABLE dbo.TblEmpServiceSettings (
    ID              INT           IDENTITY(1,1) NOT NULL,
    EmpID           INT           NOT NULL,
    ProID           INT           NOT NULL,
    DurationMinutes INT           NOT NULL,
    IsActive        BIT           NOT NULL DEFAULT 1,
    Notes           NVARCHAR(255) NULL,
    CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt       DATETIME2     NULL,
    CONSTRAINT PK_TblEmpServiceSettings PRIMARY KEY CLUSTERED (ID ASC)
  );
  PRINT 'Created table: TblEmpServiceSettings';
END
ELSE
  PRINT 'Table already exists: TblEmpServiceSettings';
GO

-- Unique index: one row per (EmpID, ProID)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_TblEmpServiceSettings_EmpID_ProID'
    AND object_id = OBJECT_ID('dbo.TblEmpServiceSettings')
)
BEGIN
  CREATE UNIQUE INDEX UX_TblEmpServiceSettings_EmpID_ProID
  ON dbo.TblEmpServiceSettings (EmpID, ProID);
  PRINT 'Created index: UX_TblEmpServiceSettings_EmpID_ProID';
END
ELSE
  PRINT 'Index already exists: UX_TblEmpServiceSettings_EmpID_ProID';
GO

-- Performance index
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TblEmpServiceSettings_EmpID_ProID_IsActive'
    AND object_id = OBJECT_ID('dbo.TblEmpServiceSettings')
)
BEGIN
  CREATE INDEX IX_TblEmpServiceSettings_EmpID_ProID_IsActive
  ON dbo.TblEmpServiceSettings (EmpID, ProID, IsActive);
  PRINT 'Created index: IX_TblEmpServiceSettings_EmpID_ProID_IsActive';
END
ELSE
  PRINT 'Index already exists: IX_TblEmpServiceSettings_EmpID_ProID_IsActive';
GO

-- Seed test data (idempotent via MERGE)
MERGE dbo.TblEmpServiceSettings AS target
USING (VALUES
  (12, 1049, 20, 1, N'Test override: EmpID=12 takes 20 min for Advanced Cut'),
  (13, 1049, 40, 1, N'Test override: EmpID=13 takes 40 min for Advanced Cut')
) AS source (EmpID, ProID, DurationMinutes, IsActive, Notes)
ON target.EmpID = source.EmpID AND target.ProID = source.ProID
WHEN MATCHED THEN
  UPDATE SET DurationMinutes = source.DurationMinutes,
             IsActive        = source.IsActive,
             Notes           = source.Notes,
             UpdatedAt       = SYSDATETIME()
WHEN NOT MATCHED THEN
  INSERT (EmpID, ProID, DurationMinutes, IsActive, Notes)
  VALUES (source.EmpID, source.ProID, source.DurationMinutes, source.IsActive, source.Notes);
PRINT 'Seeded test rows into TblEmpServiceSettings';
GO

PRINT '============================================================';
PRINT ' TblEmpServiceSettings migration COMPLETE';
PRINT '============================================================';
