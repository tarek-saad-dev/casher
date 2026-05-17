-- ============================================================
--  Queue & Booking System Migration
--  Idempotent — safe to run multiple times
--  Does NOT drop or modify any existing tables
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1.  Bookings
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Bookings')
BEGIN
  CREATE TABLE [dbo].[Bookings] (
    [BookingID]          INT            IDENTITY(1,1) NOT NULL,
    [ClientID]           INT            NULL,
    [AssignedEmpID]      INT            NULL,
    [BookingDate]        DATE           NOT NULL,
    [StartTime]          TIME(0)        NOT NULL,
    [EndTime]            TIME(0)        NULL,
    [Status]             NVARCHAR(30)   NOT NULL DEFAULT 'pending',
        -- pending | confirmed | arrived | queued | in_service | completed | cancelled | no_show | rescheduled
    [Source]             NVARCHAR(30)   NOT NULL DEFAULT 'phone',
        -- walk_in | phone | whatsapp | website | admin
    [Notes]              NVARCHAR(500)  NULL,
    [QueueTicketID]      INT            NULL,
    [OldInvID]           INT            NULL,
    [OldInvType]         NVARCHAR(50)   NULL,
    [ConvertedInvID]     INT            NULL,
    [ConvertedInvType]   NVARCHAR(50)   NULL,
    [CreatedByUserID]    INT            NULL,
    [CreatedAt]          DATETIME       NOT NULL DEFAULT GETDATE(),
    [UpdatedAt]          DATETIME       NULL,
    [CancelledAt]        DATETIME       NULL,
    [CancelReason]       NVARCHAR(500)  NULL,
    CONSTRAINT [PK_Bookings] PRIMARY KEY CLUSTERED ([BookingID] ASC)
  );
  PRINT 'Created table: Bookings';
END
ELSE
  PRINT 'Table already exists: Bookings';

-- ──────────────────────────────────────────────────────────────
-- 2.  BookingServices
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BookingServices')
BEGIN
  CREATE TABLE [dbo].[BookingServices] (
    [BookingServiceID]   INT            IDENTITY(1,1) NOT NULL,
    [BookingID]          INT            NOT NULL,
    [ProID]              INT            NULL,
    [EmpID]              INT            NULL,
    [Qty]                DECIMAL(10,2)  NOT NULL DEFAULT 1,
    [Price]              DECIMAL(10,2)  NOT NULL DEFAULT 0,
    [DurationMinutes]    INT            NULL,
    [Notes]              NVARCHAR(300)  NULL,
    CONSTRAINT [PK_BookingServices] PRIMARY KEY CLUSTERED ([BookingServiceID] ASC),
    CONSTRAINT [FK_BookingServices_Bookings]
      FOREIGN KEY ([BookingID]) REFERENCES [dbo].[Bookings]([BookingID]) ON DELETE CASCADE
  );
  PRINT 'Created table: BookingServices';
END
ELSE
  PRINT 'Table already exists: BookingServices';

-- ──────────────────────────────────────────────────────────────
-- 3.  QueueTickets
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueueTickets')
BEGIN
  CREATE TABLE [dbo].[QueueTickets] (
    [QueueTicketID]      INT            IDENTITY(1,1) NOT NULL,
    [TicketCode]         NVARCHAR(20)   NOT NULL,   -- e.g. A1, B3
    [TicketNumber]       INT            NOT NULL,   -- numeric part only
    [TicketPrefix]       NVARCHAR(5)    NOT NULL DEFAULT 'A',
    [ClientID]           INT            NULL,
    [EmpID]              INT            NULL,
    [BookingID]          INT            NULL,
    [QueueDate]          DATE           NOT NULL,
    [CreatedTime]        TIME(0)        NOT NULL DEFAULT CONVERT(TIME(0), GETDATE()),
    [Status]             NVARCHAR(20)   NOT NULL DEFAULT 'waiting',
        -- waiting | called | arrived | in_service | done | skipped | cancelled | no_show
    [Source]             NVARCHAR(20)   NOT NULL DEFAULT 'walk_in',
        -- walk_in | booking | admin
    [Priority]           INT            NOT NULL DEFAULT 0,  -- 0=normal, 1=high
    [CalledAt]           DATETIME       NULL,
    [ArrivedAt]          DATETIME       NULL,
    [ServiceStartedAt]   DATETIME       NULL,
    [ServiceEndedAt]     DATETIME       NULL,
    [CancelledAt]        DATETIME       NULL,
    [CreatedByUserID]    INT            NULL,
    [Notes]              NVARCHAR(500)  NULL,
    [LegacySequenceID]   INT            NULL,  -- maps to old TblSequence.Num or PK
    CONSTRAINT [PK_QueueTickets] PRIMARY KEY CLUSTERED ([QueueTicketID] ASC),
    CONSTRAINT [UQ_QueueTickets_Code_Date] UNIQUE ([TicketCode], [QueueDate])
  );
  PRINT 'Created table: QueueTickets';
END
ELSE
  PRINT 'Table already exists: QueueTickets';

-- ──────────────────────────────────────────────────────────────
-- 4.  QueueTicketHistory
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueueTicketHistory')
BEGIN
  CREATE TABLE [dbo].[QueueTicketHistory] (
    [ID]                 INT            IDENTITY(1,1) NOT NULL,
    [QueueTicketID]      INT            NOT NULL,
    [OldStatus]          NVARCHAR(20)   NULL,
    [NewStatus]          NVARCHAR(20)   NOT NULL,
    [ActionType]         NVARCHAR(50)   NULL,
        -- created | called | arrived | start_service | done | skipped | cancelled | no_show | transfer | reschedule
    [ActionByUserID]     INT            NULL,
    [ActionAt]           DATETIME       NOT NULL DEFAULT GETDATE(),
    [Notes]              NVARCHAR(500)  NULL,
    CONSTRAINT [PK_QueueTicketHistory] PRIMARY KEY CLUSTERED ([ID] ASC),
    CONSTRAINT [FK_QueueTicketHistory_Tickets]
      FOREIGN KEY ([QueueTicketID]) REFERENCES [dbo].[QueueTickets]([QueueTicketID]) ON DELETE CASCADE
  );
  PRINT 'Created table: QueueTicketHistory';
END
ELSE
  PRINT 'Table already exists: QueueTicketHistory';

-- ──────────────────────────────────────────────────────────────
-- 5.  QueueBookingSettings
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueueBookingSettings')
BEGIN
  CREATE TABLE [dbo].[QueueBookingSettings] (
    [SettingID]              INT            IDENTITY(1,1) NOT NULL,
    [QueuePrefix]            NVARCHAR(5)    NOT NULL DEFAULT 'A',
    [QueueStartNumber]       INT            NOT NULL DEFAULT 1,   -- 0 or 1
    [ResetQueueDaily]        BIT            NOT NULL DEFAULT 1,
    [DefaultServiceMinutes]  INT            NOT NULL DEFAULT 30,
    [BookingGracePeriod]     INT            NOT NULL DEFAULT 15,  -- minutes
    [AutoNoShowAfterMin]     INT            NOT NULL DEFAULT 30,
    [AllowDoubleBooking]     BIT            NOT NULL DEFAULT 0,
    [BookingPriorityMode]    NVARCHAR(20)   NOT NULL DEFAULT 'fifo',
    [UpdatedAt]              DATETIME       NULL,
    [UpdatedByUserID]        INT            NULL,
    CONSTRAINT [PK_QueueBookingSettings] PRIMARY KEY CLUSTERED ([SettingID] ASC)
  );
  INSERT INTO [dbo].[QueueBookingSettings] DEFAULT VALUES;
  PRINT 'Created table: QueueBookingSettings with default row';
END
ELSE
  PRINT 'Table already exists: QueueBookingSettings';

-- ──────────────────────────────────────────────────────────────
-- 6.  Indexes
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QueueTickets_Date_Emp_Status')
BEGIN
  CREATE INDEX [IX_QueueTickets_Date_Emp_Status]
    ON [dbo].[QueueTickets] ([QueueDate], [EmpID], [Status]);
  PRINT 'Created index: IX_QueueTickets_Date_Emp_Status';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QueueTickets_Date_Number')
BEGIN
  CREATE INDEX [IX_QueueTickets_Date_Number]
    ON [dbo].[QueueTickets] ([QueueDate], [TicketNumber]);
  PRINT 'Created index: IX_QueueTickets_Date_Number';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Bookings_Date_Emp_Status')
BEGIN
  CREATE INDEX [IX_Bookings_Date_Emp_Status]
    ON [dbo].[Bookings] ([BookingDate], [AssignedEmpID], [Status]);
  PRINT 'Created index: IX_Bookings_Date_Emp_Status';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BookingServices_BookingID')
BEGIN
  CREATE INDEX [IX_BookingServices_BookingID]
    ON [dbo].[BookingServices] ([BookingID]);
  PRINT 'Created index: IX_BookingServices_BookingID';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_QueueTicketHistory_TicketID')
BEGIN
  CREATE INDEX [IX_QueueTicketHistory_TicketID]
    ON [dbo].[QueueTicketHistory] ([QueueTicketID]);
  PRINT 'Created index: IX_QueueTicketHistory_TicketID';
END

-- ──────────────────────────────────────────────────────────────
-- 7.  Migration: TblSequence → QueueTickets (idempotent)
-- ──────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TblSequence')
BEGIN
  INSERT INTO [dbo].[QueueTickets]
    ([TicketCode], [TicketNumber], [TicketPrefix], [ClientID], [EmpID],
     [QueueDate], [CreatedTime], [Status], [Source], [LegacySequenceID])
  SELECT
    'A' + CAST(TRY_CAST(s.Num AS INT) AS NVARCHAR),
    TRY_CAST(s.Num AS INT),
    'A',
    s.ClientID,
    s.EmpID,
    CAST(s.DateSequence AS DATE),
    ISNULL(CONVERT(TIME(0), s.TimeSequence), '00:00:00'),
    'done',
    'walk_in',
    TRY_CAST(s.Num AS INT)
  FROM [dbo].[TblSequence] s
  WHERE TRY_CAST(s.Num AS INT) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM [dbo].[QueueTickets] qt
      WHERE qt.LegacySequenceID = TRY_CAST(s.Num AS INT)
        AND qt.QueueDate = CAST(s.DateSequence AS DATE)
        AND qt.EmpID = s.EmpID
    );
  PRINT 'Migrated TblSequence rows to QueueTickets';
END
ELSE
  PRINT 'TblSequence not found — skipping migration';

-- ──────────────────────────────────────────────────────────────
-- 8.  Migration: TblinvServHead (حجز) → Bookings (idempotent)
-- ──────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TblinvServHead')
BEGIN
  -- Migrate old booking invoices to Bookings table
  INSERT INTO [dbo].[Bookings]
    ([ClientID], [AssignedEmpID], [BookingDate], [StartTime],
     [Status], [Source], [Notes],
     [OldInvID], [OldInvType], [CreatedByUserID], [CreatedAt])
  SELECT
    h.ClientID,
    NULL,
    ISNULL(CAST(h.ReservDate AS DATE), CAST(h.invDate AS DATE)),
    ISNULL(CONVERT(TIME(0), h.ReservTime), '09:00:00'),
    'completed',
    'phone',
    h.Notes,
    h.invID,
    h.invType,
    h.UserID,
    ISNULL(h.invDate, GETDATE())
  FROM [dbo].[TblinvServHead] h
  WHERE h.invType IN (N'حجز', N'حجز بالكارت')
    AND NOT EXISTS (
      SELECT 1 FROM [dbo].[Bookings] b
      WHERE b.OldInvID = h.invID AND b.OldInvType = h.invType
    );
  PRINT 'Migrated TblinvServHead booking rows to Bookings';
END
ELSE
  PRINT 'TblinvServHead not found — skipping booking migration';

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TblinvServDetail')
BEGIN
  -- Migrate booking services
  INSERT INTO [dbo].[BookingServices]
    ([BookingID], [ProID], [EmpID], [Qty], [Price])
  SELECT
    bk.BookingID,
    d.ProID,
    d.EmpID,
    d.Qty,
    d.SPrice
  FROM [dbo].[TblinvServDetail] d
  INNER JOIN [dbo].[Bookings] bk
    ON bk.OldInvID = d.invID AND bk.OldInvType = d.invType
  WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[BookingServices] bs
    WHERE bs.BookingID = bk.BookingID
      AND ISNULL(bs.ProID, 0) = ISNULL(d.ProID, 0)
      AND ISNULL(bs.EmpID, 0) = ISNULL(d.EmpID, 0)
  );
  PRINT 'Migrated TblinvServDetail booking services to BookingServices';
END
ELSE
  PRINT 'TblinvServDetail not found — skipping services migration';

PRINT '============================================================';
PRINT ' Queue & Booking System Migration COMPLETE';
PRINT '============================================================';
