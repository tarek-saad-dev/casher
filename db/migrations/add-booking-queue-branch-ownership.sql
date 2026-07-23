-- ============================================================
-- Phase 1F: Booking / Queue / Settings branch ownership
-- Adds BranchID to Bookings, QueueTickets, QueueBookingSettings
-- Backfills all existing rows to GLEEM (BranchCode = N'GLEEM')
-- Replaces UQ_QueueTickets_Code_Date with (BranchID, QueueDate, TicketCode)
-- Preserves UX_Bookings_BookingCode (global booking codes)
-- Idempotent. Does not change codes, times, statuses, estimates.
-- ============================================================
SET NOCOUNT ON;
GO

DECLARE @GleemBranchID INT;
SELECT @GleemBranchID = BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM';
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1F requires founding branch GLEEM', 16, 1);
END;
GO

------------------------------------------------------------
-- 1) Bookings.BranchID
------------------------------------------------------------
IF COL_LENGTH(N'dbo.Bookings', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD BranchID INT NULL;
    PRINT 'Added Bookings.BranchID';
END
GO

DECLARE @GleemBranchID INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

UPDATE dbo.Bookings
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

IF EXISTS (SELECT 1 FROM dbo.Bookings WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'Bookings.BranchID still null after GLEEM backfill', 16, 1);
END;

PRINT 'Backfilled Bookings.BranchID to GLEEM';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Bookings') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.Bookings ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'Bookings.BranchID set NOT NULL';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Bookings_BranchID')
BEGIN
    ALTER TABLE dbo.Bookings
        ADD CONSTRAINT FK_Bookings_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_Bookings_BranchID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_Bookings_Branch_BookingDate' AND object_id = OBJECT_ID(N'dbo.Bookings')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Bookings_Branch_BookingDate
        ON dbo.Bookings (BranchID, BookingDate)
        INCLUDE (AssignedEmpID, Status, StartTime, EndTime, BookingCode);
    PRINT 'Created IX_Bookings_Branch_BookingDate';
END
GO

-- Preserve global UX_Bookings_BookingCode (do not weaken)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_Bookings_BookingCode' AND object_id = OBJECT_ID(N'dbo.Bookings')
)
BEGIN
    PRINT 'WARNING: UX_Bookings_BookingCode missing — not recreating automatically';
END
ELSE
    PRINT 'Preserved UX_Bookings_BookingCode (global booking codes)';
GO

------------------------------------------------------------
-- 2) QueueTickets.BranchID + uniqueness
------------------------------------------------------------
IF COL_LENGTH(N'dbo.QueueTickets', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.QueueTickets ADD BranchID INT NULL;
    PRINT 'Added QueueTickets.BranchID';
END
GO

DECLARE @GleemBranchID INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

UPDATE dbo.QueueTickets
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

IF EXISTS (SELECT 1 FROM dbo.QueueTickets WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'QueueTickets.BranchID still null after GLEEM backfill', 16, 1);
END;

-- Pre-check: after GLEEM stamp, (BranchID, QueueDate, TicketCode) must be unique
IF EXISTS (
    SELECT 1
    FROM dbo.QueueTickets
    GROUP BY BranchID, QueueDate, TicketCode
    HAVING COUNT(*) > 1
)
BEGIN
    RAISERROR(N'Cannot replace queue uniqueness: duplicate (BranchID, QueueDate, TicketCode)', 16, 1);
END;

PRINT 'Backfilled QueueTickets.BranchID to GLEEM';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.QueueTickets') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.QueueTickets ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'QueueTickets.BranchID set NOT NULL';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_QueueTickets_BranchID')
BEGIN
    ALTER TABLE dbo.QueueTickets
        ADD CONSTRAINT FK_QueueTickets_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_QueueTickets_BranchID';
END
GO

-- Drop old global date/code unique if present
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_QueueTickets_Code_Date' AND object_id = OBJECT_ID(N'dbo.QueueTickets')
)
BEGIN
    ALTER TABLE dbo.QueueTickets DROP CONSTRAINT UQ_QueueTickets_Code_Date;
    PRINT 'Dropped UQ_QueueTickets_Code_Date';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_QueueTickets_Branch_Date_Code' AND object_id = OBJECT_ID(N'dbo.QueueTickets')
)
BEGIN
    ALTER TABLE dbo.QueueTickets
        ADD CONSTRAINT UQ_QueueTickets_Branch_Date_Code
        UNIQUE (BranchID, QueueDate, TicketCode);
    PRINT 'Created UQ_QueueTickets_Branch_Date_Code';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_QueueTickets_Branch_QueueDate' AND object_id = OBJECT_ID(N'dbo.QueueTickets')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_QueueTickets_Branch_QueueDate
        ON dbo.QueueTickets (BranchID, QueueDate)
        INCLUDE (EmpID, Status, TicketCode, TicketNumber);
    PRINT 'Created IX_QueueTickets_Branch_QueueDate';
END
GO

------------------------------------------------------------
-- 3) QueueBookingSettings.BranchID (one row per branch)
------------------------------------------------------------
IF COL_LENGTH(N'dbo.QueueBookingSettings', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.QueueBookingSettings ADD BranchID INT NULL;
    PRINT 'Added QueueBookingSettings.BranchID';
END
GO

DECLARE @GleemBranchID INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

UPDATE dbo.QueueBookingSettings
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

IF EXISTS (SELECT 1 FROM dbo.QueueBookingSettings WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'QueueBookingSettings.BranchID still null after GLEEM backfill', 16, 1);
END;

IF EXISTS (
    SELECT 1
    FROM dbo.QueueBookingSettings
    GROUP BY BranchID
    HAVING COUNT(*) > 1
)
BEGIN
    RAISERROR(N'Duplicate QueueBookingSettings rows per BranchID', 16, 1);
END;

PRINT 'Backfilled QueueBookingSettings.BranchID to GLEEM';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.QueueBookingSettings') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.QueueBookingSettings ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'QueueBookingSettings.BranchID set NOT NULL';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_QueueBookingSettings_BranchID')
BEGIN
    ALTER TABLE dbo.QueueBookingSettings
        ADD CONSTRAINT FK_QueueBookingSettings_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_QueueBookingSettings_BranchID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_QueueBookingSettings_BranchID' AND object_id = OBJECT_ID(N'dbo.QueueBookingSettings')
)
BEGIN
    ALTER TABLE dbo.QueueBookingSettings
        ADD CONSTRAINT UQ_QueueBookingSettings_BranchID UNIQUE (BranchID);
    PRINT 'Created UQ_QueueBookingSettings_BranchID';
END
GO

PRINT 'Phase 1F booking/queue branch ownership migration complete';
GO
