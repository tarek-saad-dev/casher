-- ============================================================
--  Queue Estimate Migration
--  Idempotent — safe to run multiple times
--
--  NOTE: Employee working hours are already stored in:
--    dbo.TblEmpWorkSchedule  (per-day schedule: IsWorkingDay, StartTime, EndTime)
--    dbo.TblEmpDayOff        (specific date off records)
--  Do NOT create duplicate schedule tables.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. QueueTickets — add estimation columns if missing
-- ──────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueueTickets')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_NAME='QueueTickets' AND COLUMN_NAME='EstimatedStartTime')
    ALTER TABLE [dbo].[QueueTickets] ADD [EstimatedStartTime] DATETIME2 NULL;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_NAME='QueueTickets' AND COLUMN_NAME='EstimatedWaitMinutes')
    ALTER TABLE [dbo].[QueueTickets] ADD [EstimatedWaitMinutes] INT NULL;

  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_NAME='QueueTickets' AND COLUMN_NAME='WaitingCountAtCreation')
    ALTER TABLE [dbo].[QueueTickets] ADD [WaitingCountAtCreation] INT NULL;

  PRINT 'QueueTickets estimation columns ensured';
END

-- ──────────────────────────────────────────────────────────────
-- 2. QueueTicketServices — link services to queue tickets
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueueTicketServices')
BEGIN
  CREATE TABLE [dbo].[QueueTicketServices] (
    [ID]              INT IDENTITY(1,1) NOT NULL,
    [QueueTicketID]   INT NOT NULL,
    [ProID]           INT NULL,
    [ProName]         NVARCHAR(200) NULL,
    [Qty]             DECIMAL(10,2) NOT NULL DEFAULT 1,
    [DurationMinutes] INT NULL,
    [Price]           DECIMAL(10,2) NULL,
    CONSTRAINT [PK_QueueTicketServices] PRIMARY KEY CLUSTERED ([ID] ASC),
    CONSTRAINT [FK_QTS_QueueTickets]
      FOREIGN KEY ([QueueTicketID]) REFERENCES [dbo].[QueueTickets]([QueueTicketID]) ON DELETE CASCADE
  );

  CREATE INDEX [IX_QTS_TicketID]
    ON [dbo].[QueueTicketServices] ([QueueTicketID]);

  PRINT 'Created table: QueueTicketServices';
END
ELSE
  PRINT 'Table already exists: QueueTicketServices';
