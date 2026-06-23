-- ============================================================
--  Customer Follow-Up Table
--  Idempotent — safe to run multiple times
--  Records the result of a customer-service call per monthly
--  follow-up cycle (one record per ClientID + FollowUpMonth).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1.  TblCustomerFollowUp
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TblCustomerFollowUp' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE [dbo].[TblCustomerFollowUp] (
    [ID]                  INT            IDENTITY(1,1) NOT NULL,
    [ClientID]            INT            NOT NULL,
    [FollowUpMonth]       DATE           NOT NULL,   -- always the 1st of the month
    [ResultType]          NVARCHAR(40)   NOT NULL,   -- outside_governorate | outside_country | complaint | other_reason
    [ComplaintType]       NVARCHAR(40)   NULL,       -- barber | place | cleanliness | other  (only when ResultType = complaint)
    [ComplaintEmpID]      INT            NULL,       -- FK -> TblEmp (only when ComplaintType = barber)
    [ReasonText]          NVARCHAR(1000) NULL,
    [Notes]               NVARCHAR(1000) NULL,
    [ContactedAt]         DATETIME2      NOT NULL,
    [ContactedByUserID]   INT            NULL,       -- FK -> TblUser
    [CreatedAt]           DATETIME2      NOT NULL    DEFAULT SYSDATETIME(),
    [UpdatedAt]           DATETIME2      NULL,

    CONSTRAINT [PK_TblCustomerFollowUp] PRIMARY KEY CLUSTERED ([ID] ASC),

    CONSTRAINT [FK_TblCustomerFollowUp_Client]
      FOREIGN KEY ([ClientID]) REFERENCES [dbo].[TblClient]([ClientID]),

    CONSTRAINT [FK_TblCustomerFollowUp_Emp]
      FOREIGN KEY ([ComplaintEmpID]) REFERENCES [dbo].[TblEmp]([EmpID]),

    CONSTRAINT [FK_TblCustomerFollowUp_User]
      FOREIGN KEY ([ContactedByUserID]) REFERENCES [dbo].[TblUser]([UserID])
  );
  PRINT 'Created table: TblCustomerFollowUp';
END
ELSE
  PRINT 'Table already exists: TblCustomerFollowUp';
GO

-- ──────────────────────────────────────────────────────────────
-- 2.  Unique index: one result per customer per follow-up month
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_TblCustomerFollowUp_ClientMonth'
    AND object_id = OBJECT_ID('dbo.TblCustomerFollowUp')
)
BEGIN
  CREATE UNIQUE INDEX [UX_TblCustomerFollowUp_ClientMonth]
  ON [dbo].[TblCustomerFollowUp] ([ClientID], [FollowUpMonth]);
  PRINT 'Created index: UX_TblCustomerFollowUp_ClientMonth';
END
ELSE
  PRINT 'Index already exists: UX_TblCustomerFollowUp_ClientMonth';
GO

-- ──────────────────────────────────────────────────────────────
-- 3.  Supporting non-clustered indexes for common look-ups
-- ──────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TblCustomerFollowUp_FollowUpMonth'
    AND object_id = OBJECT_ID('dbo.TblCustomerFollowUp')
)
BEGIN
  CREATE NONCLUSTERED INDEX [IX_TblCustomerFollowUp_FollowUpMonth]
  ON [dbo].[TblCustomerFollowUp] ([FollowUpMonth]);
  PRINT 'Created index: IX_TblCustomerFollowUp_FollowUpMonth';
END
ELSE
  PRINT 'Index already exists: IX_TblCustomerFollowUp_FollowUpMonth';
GO

PRINT '============================================================';
PRINT ' TblCustomerFollowUp migration COMPLETE';
GO
