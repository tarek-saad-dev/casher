-- Booking Phase 6B — canonical WorkDate / dayOffset / absolute interval columns on Bookings
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.Bookings', N'PublicWorkDate') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings ADD PublicWorkDate DATE NULL;
  PRINT 'Added Bookings.PublicWorkDate';
END
GO

IF COL_LENGTH(N'dbo.Bookings', N'PublicDayOffset') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings ADD PublicDayOffset TINYINT NULL;
  PRINT 'Added Bookings.PublicDayOffset';
END
GO

IF COL_LENGTH(N'dbo.Bookings', N'AbsoluteStartUtc') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings ADD AbsoluteStartUtc DATETIME2(0) NULL;
  PRINT 'Added Bookings.AbsoluteStartUtc';
END
GO

IF COL_LENGTH(N'dbo.Bookings', N'AbsoluteEndUtc') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings ADD AbsoluteEndUtc DATETIME2(0) NULL;
  PRINT 'Added Bookings.AbsoluteEndUtc';
END
GO

IF COL_LENGTH(N'dbo.Bookings', N'PlanFingerprint') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings ADD PlanFingerprint NVARCHAR(128) NULL;
  PRINT 'Added Bookings.PlanFingerprint';
END
GO

IF COL_LENGTH(N'dbo.Bookings', N'IdempotencyRequestID') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings ADD IdempotencyRequestID BIGINT NULL;
  PRINT 'Added Bookings.IdempotencyRequestID';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_Bookings_AssignedEmp_AbsoluteStart'
    AND object_id = OBJECT_ID(N'dbo.Bookings')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_Bookings_AssignedEmp_AbsoluteStart
    ON dbo.Bookings (AssignedEmpID, AbsoluteStartUtc)
    INCLUDE (AbsoluteEndUtc, Status, BranchID, PublicWorkDate, PublicDayOffset)
    WHERE AbsoluteStartUtc IS NOT NULL;
  PRINT 'Created IX_Bookings_AssignedEmp_AbsoluteStart';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_Bookings_PublicWorkDate_Branch'
    AND object_id = OBJECT_ID(N'dbo.Bookings')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_Bookings_PublicWorkDate_Branch
    ON dbo.Bookings (BranchID, PublicWorkDate)
    INCLUDE (AssignedEmpID, PublicDayOffset, Status, BookingCode)
    WHERE PublicWorkDate IS NOT NULL;
  PRINT 'Created IX_Bookings_PublicWorkDate_Branch';
END
GO
