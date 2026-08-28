-- ============================================================
-- Migration: TblWhatsAppGroup — WhatsApp group notification targets
-- Idempotent. Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblWhatsAppGroup', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblWhatsAppGroup] (
        [ID]                INT            IDENTITY(1,1) NOT NULL,
        [Name]              NVARCHAR(200)  NOT NULL,
        [InviteLink]        NVARCHAR(500)  NOT NULL,
        [SubscribedEvents]  NVARCHAR(MAX)  NOT NULL
            CONSTRAINT [DF_TblWhatsAppGroup_SubscribedEvents] DEFAULT (N'[]'),
        [BranchID]          INT            NULL,
        [IsActive]          BIT            NOT NULL
            CONSTRAINT [DF_TblWhatsAppGroup_IsActive] DEFAULT (1),
        [CreatedAt]         DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppGroup_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]         DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblWhatsAppGroup] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblWhatsAppGroup_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID])
    );
    PRINT N'Created TblWhatsAppGroup';
END
ELSE
    PRINT N'TblWhatsAppGroup already exists — skipped';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblWhatsAppGroup_IsActive'
      AND object_id = OBJECT_ID(N'dbo.TblWhatsAppGroup')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblWhatsAppGroup_IsActive]
        ON [dbo].[TblWhatsAppGroup] ([IsActive])
        INCLUDE ([BranchID], [SubscribedEvents]);
    PRINT N'Created IX_TblWhatsAppGroup_IsActive';
END
GO
