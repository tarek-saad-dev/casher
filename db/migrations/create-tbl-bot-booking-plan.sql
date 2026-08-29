-- ============================================================
-- Migration: TblBotBookingPlan (Phase 3 Booking Planner state)
-- Idempotent. Safe to re-run.
-- One ACTIVE plan per conversation via filtered unique index.
-- READ-ONLY relative to bookings: no holds/creates.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblBotBookingPlan', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBotBookingPlan] (
        [PlanID]                    BIGINT         IDENTITY(1,1) NOT NULL,
        [ConversationID]            BIGINT         NOT NULL,
        [Stage]                     NVARCHAR(40)   NOT NULL
            CONSTRAINT [DF_TblBotBookingPlan_Stage] DEFAULT (N'collecting'),
        [Version]                   INT            NOT NULL
            CONSTRAINT [DF_TblBotBookingPlan_Version] DEFAULT (1),
        [BranchID]                  INT            NULL,
        [BranchCode]                NVARCHAR(50)   NULL,
        [BranchName]                NVARCHAR(200)  NULL,
        [ServiceIdsJson]            NVARCHAR(200)  NULL,
        [ServiceNamesJson]          NVARCHAR(500)  NULL,
        [EmpID]                     INT            NULL,
        [EmployeeName]              NVARCHAR(200)  NULL,
        [RequestedDate]             DATE           NULL,
        [TimePreferenceJson]        NVARCHAR(300)  NULL,
        [CandidateSlotsJson]        NVARCHAR(MAX)  NULL,
        [SelectedSlotJson]          NVARCHAR(500)  NULL,
        [ClientID]                  INT            NULL,
        [MissingFieldsJson]         NVARCHAR(300)  NULL,
        [LastAvailabilityCheckedAt] DATETIME2(3)   NULL,
        [LastTurnID]                BIGINT         NULL,
        [TraceJson]                 NVARCHAR(MAX)  NULL,
        [CreatedAt]                 DATETIME2(3)   NOT NULL
            CONSTRAINT [DF_TblBotBookingPlan_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]                 DATETIME2(3)   NULL,
        [CompletedAt]               DATETIME2(3)   NULL,
        CONSTRAINT [PK_TblBotBookingPlan] PRIMARY KEY CLUSTERED ([PlanID]),
        CONSTRAINT [CK_TblBotBookingPlan_Stage] CHECK ([Stage] IN (
            N'collecting',
            N'clarifying',
            N'choosing_slot',
            N'ready_to_confirm',
            N'confirmed_intent',
            N'abandoned'
        )),
        CONSTRAINT [FK_TblBotBookingPlan_ConversationID]
            FOREIGN KEY ([ConversationID]) REFERENCES [dbo].[TblBotConversation] ([ConversationID])
    );
    PRINT N'Created TblBotBookingPlan';
END
ELSE
    PRINT N'TblBotBookingPlan already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblBotBookingPlan_ConversationActive'
      AND object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblBotBookingPlan_ConversationActive]
        ON [dbo].[TblBotBookingPlan] ([ConversationID])
        WHERE [Stage] IN (
            N'collecting',
            N'clarifying',
            N'choosing_slot',
            N'ready_to_confirm',
            N'confirmed_intent'
        );
    PRINT N'Created UX_TblBotBookingPlan_ConversationActive';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBotBookingPlan_ConversationUpdated'
      AND object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblBotBookingPlan_ConversationUpdated]
        ON [dbo].[TblBotBookingPlan] ([ConversationID], [UpdatedAt] DESC);
    PRINT N'Created IX_TblBotBookingPlan_ConversationUpdated';
END
GO
