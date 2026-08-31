-- ============================================================
-- Migration: TblBotBookingManagementPlan (Booking Management V1)
-- Idempotent. Safe to re-run.
-- One ACTIVE management plan per conversation (filtered unique index).
-- Writes to Bookings happen ONLY via cancelPublicBooking / reschedulePublicBooking.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblBotBookingManagementPlan', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotBookingManagementPlan] (
        [PlanID]                    BIGINT         IDENTITY(1,1) NOT NULL,
        [ConversationID]            BIGINT         NOT NULL,
        [Operation]                 NVARCHAR(20)   NOT NULL,
        [Stage]                     NVARCHAR(40)   NOT NULL
            CONSTRAINT [DF_TblBotBookingMgmtPlan_Stage] DEFAULT (N'RESOLVING_BOOKING'),
        [Version]                   INT            NOT NULL
            CONSTRAINT [DF_TblBotBookingMgmtPlan_Version] DEFAULT (1),
        [ConfirmationVersion]       INT            NOT NULL
            CONSTRAINT [DF_TblBotBookingMgmtPlan_ConfVer] DEFAULT (1),
        [TargetBookingID]           INT            NULL,
        [TargetBookingCode]         NVARCHAR(40)   NULL,
        [OriginalSnapshotJson]      NVARCHAR(MAX)  NULL,
        [DesiredChangesJson]        NVARCHAR(MAX)  NULL,
        [ValidatedDesiredStateJson] NVARCHAR(MAX)  NULL,
        [CandidateAlternativesJson] NVARCHAR(MAX)  NULL,
        [IdempotencyKey]            NVARCHAR(200)  NULL,
        [LastTurnID]                BIGINT         NULL,
        [TraceJson]                 NVARCHAR(MAX)  NULL,
        [CreatedAt]                 DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblBotBookingMgmtPlan_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]                 DATETIME2(3)   NULL,
        [CompletedAt]               DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblBotBookingManagementPlan] PRIMARY KEY CLUSTERED ([PlanID]),
        CONSTRAINT [CK_TblBotBookingMgmtPlan_Op] CHECK ([Operation] IN (N'CANCEL', N'MODIFY')),
        CONSTRAINT [CK_TblBotBookingMgmtPlan_Stage] CHECK ([Stage] IN (
            N'RESOLVING_BOOKING',
            N'COLLECTING_CHANGE',
            N'VALIDATING',
            N'CHOOSING_ALTERNATIVE',
            N'READY_TO_CONFIRM',
            N'EXECUTING',
            N'COMPLETED',
            N'FAILED',
            N'ABANDONED'
        ))
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBotBookingManagementPlan_ActiveConversation'
      AND object_id = OBJECT_ID(N'dbo.TblBotBookingManagementPlan')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblBotBookingManagementPlan_ActiveConversation]
    ON [dbo].[TblBotBookingManagementPlan] ([ConversationID])
    WHERE [Stage] IN (
        N'RESOLVING_BOOKING',
        N'COLLECTING_CHANGE',
        N'VALIDATING',
        N'CHOOSING_ALTERNATIVE',
        N'READY_TO_CONFIRM',
        N'EXECUTING'
    )
      AND [CompletedAt] IS NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotBookingManagementPlan_Conversation'
      AND object_id = OBJECT_ID(N'dbo.TblBotBookingManagementPlan')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotBookingManagementPlan_Conversation]
    ON [dbo].[TblBotBookingManagementPlan] ([ConversationID], [UpdatedAt] DESC);
END
GO
