-- Queue Lifecycle Enhancement Migration
-- Adds columns for effective status tracking, auto-close, and status history.

-- ─── QueueTickets additional columns ─────────────────────────────────────────

IF COL_LENGTH('dbo.QueueTickets', 'ExpectedStartAt') IS NULL
  ALTER TABLE dbo.QueueTickets ADD ExpectedStartAt DATETIME2 NULL;

IF COL_LENGTH('dbo.QueueTickets', 'ExpectedEndAt') IS NULL
  ALTER TABLE dbo.QueueTickets ADD ExpectedEndAt DATETIME2 NULL;

IF COL_LENGTH('dbo.QueueTickets', 'DurationMinutes') IS NULL
  ALTER TABLE dbo.QueueTickets ADD DurationMinutes INT NULL;

IF COL_LENGTH('dbo.QueueTickets', 'PrintedAt') IS NULL
  ALTER TABLE dbo.QueueTickets ADD PrintedAt DATETIME2 NULL;

IF COL_LENGTH('dbo.QueueTickets', 'PrintCount') IS NULL
  ALTER TABLE dbo.QueueTickets ADD PrintCount INT NOT NULL DEFAULT 0;

IF COL_LENGTH('dbo.QueueTickets', 'LastStatusChangedAt') IS NULL
  ALTER TABLE dbo.QueueTickets ADD LastStatusChangedAt DATETIME2 NULL;

IF COL_LENGTH('dbo.QueueTickets', 'AutoClosedAt') IS NULL
  ALTER TABLE dbo.QueueTickets ADD AutoClosedAt DATETIME2 NULL;

IF COL_LENGTH('dbo.QueueTickets', 'AutoCloseReason') IS NULL
  ALTER TABLE dbo.QueueTickets ADD AutoCloseReason NVARCHAR(100) NULL;

-- ─── QueueTicketStatusHistory table ──────────────────────────────────────────

IF OBJECT_ID('dbo.QueueTicketStatusHistory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.QueueTicketStatusHistory (
    ID                INT IDENTITY(1,1) PRIMARY KEY,
    QueueTicketID     INT NOT NULL,
    OldStatus         NVARCHAR(30) NULL,
    NewStatus         NVARCHAR(30) NOT NULL,
    ChangedAt         DATETIME2 NOT NULL DEFAULT GETDATE(),
    ChangedByUserID   INT NULL,
    Source            NVARCHAR(50) NULL,  -- 'operator', 'system', 'auto_close'
    Notes             NVARCHAR(500) NULL,
    CONSTRAINT FK_QTSH_QueueTicket
      FOREIGN KEY (QueueTicketID)
      REFERENCES dbo.QueueTickets(QueueTicketID)
  );

  CREATE INDEX IX_QTSH_TicketID ON dbo.QueueTicketStatusHistory(QueueTicketID);
  CREATE INDEX IX_QTSH_ChangedAt ON dbo.QueueTicketStatusHistory(ChangedAt);
END;
GO
