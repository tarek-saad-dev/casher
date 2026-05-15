-- ============================================================
-- Migration: Create TblAutoGenLog for auto-generate audit trail
-- Run once against the database.
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'TblAutoGenLog'
)
BEGIN
    CREATE TABLE [dbo].[TblAutoGenLog] (
        [ID]             INT            IDENTITY(1,1) PRIMARY KEY,
        [WorkDate]       DATE           NOT NULL,
        [Success]        BIT            NOT NULL DEFAULT 0,
        [EmployeesCount] INT            NULL,
        [TotalHours]     DECIMAL(10,2)  NULL,
        [TotalWages]     DECIMAL(12,2)  NULL,
        [MissingJson]    NVARCHAR(MAX)  NULL,
        [CreatedAt]      DATETIME       NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_TblAutoGenLog_WorkDate ON [dbo].[TblAutoGenLog] ([WorkDate] DESC);
    PRINT 'Created TblAutoGenLog';
END
ELSE
    PRINT 'TblAutoGenLog already exists';
GO
