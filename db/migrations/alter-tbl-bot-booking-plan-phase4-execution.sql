-- ============================================================
-- Migration: Phase 4 Booking Plan execution stages + booking link
-- Additive / idempotent. No DROP of business tables.
-- ============================================================
SET NOCOUNT ON;

-- Extend stage CHECK: drop old, add new
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_TblBotBookingPlan_Stage'
    AND parent_object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
)
BEGIN
  ALTER TABLE dbo.TblBotBookingPlan DROP CONSTRAINT CK_TblBotBookingPlan_Stage;
  PRINT N'Dropped CK_TblBotBookingPlan_Stage';
END
GO

ALTER TABLE dbo.TblBotBookingPlan WITH NOCHECK
ADD CONSTRAINT CK_TblBotBookingPlan_Stage CHECK ([Stage] IN (
  N'collecting',
  N'clarifying',
  N'choosing_slot',
  N'ready_to_confirm',
  N'confirmed_intent',
  N'executing',
  N'booked',
  N'execution_failed',
  N'abandoned'
));
PRINT N'Created CK_TblBotBookingPlan_Stage (Phase 4)';
GO

IF COL_LENGTH(N'dbo.TblBotBookingPlan', N'BookingID') IS NULL
BEGIN
  ALTER TABLE dbo.TblBotBookingPlan ADD [BookingID] INT NULL;
  PRINT N'Added BookingID';
END
GO

IF COL_LENGTH(N'dbo.TblBotBookingPlan', N'BookingCode') IS NULL
BEGIN
  ALTER TABLE dbo.TblBotBookingPlan ADD [BookingCode] NVARCHAR(40) NULL;
  PRINT N'Added BookingCode';
END
GO

IF COL_LENGTH(N'dbo.TblBotBookingPlan', N'IdempotencyKey') IS NULL
BEGIN
  ALTER TABLE dbo.TblBotBookingPlan ADD [IdempotencyKey] NVARCHAR(128) NULL;
  PRINT N'Added IdempotencyKey';
END
GO

IF COL_LENGTH(N'dbo.TblBotBookingPlan', N'ExecutionErrorCode') IS NULL
BEGIN
  ALTER TABLE dbo.TblBotBookingPlan ADD [ExecutionErrorCode] NVARCHAR(80) NULL;
  PRINT N'Added ExecutionErrorCode';
END
GO

-- Recreate filtered unique: executing counts as active; booked/failed/abandoned do not
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_TblBotBookingPlan_ConversationActive'
    AND object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
)
BEGIN
  DROP INDEX UX_TblBotBookingPlan_ConversationActive ON dbo.TblBotBookingPlan;
  PRINT N'Dropped UX_TblBotBookingPlan_ConversationActive';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_TblBotBookingPlan_ConversationActive'
    AND object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX UX_TblBotBookingPlan_ConversationActive
    ON dbo.TblBotBookingPlan (ConversationID)
    WHERE [Stage] IN (
      N'collecting',
      N'clarifying',
      N'choosing_slot',
      N'ready_to_confirm',
      N'confirmed_intent',
      N'executing'
    );
  PRINT N'Created UX_TblBotBookingPlan_ConversationActive (Phase 4)';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_TblBotBookingPlan_IdempotencyKey'
    AND object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX UX_TblBotBookingPlan_IdempotencyKey
    ON dbo.TblBotBookingPlan (IdempotencyKey)
    WHERE [IdempotencyKey] IS NOT NULL;
  PRINT N'Created UX_TblBotBookingPlan_IdempotencyKey';
END
GO
