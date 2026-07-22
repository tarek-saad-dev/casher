-- ============================================================
-- Phase 1B: Multi-branch foundation
-- Creates ONLY:
--   dbo.TblBranch
--   dbo.TblUserBranchAccess
--   dbo.TblEmpBranchAssignment
-- Seeds founding branch GLEEM and backfills current identities.
-- Idempotent. Does NOT add BranchID to operational/financial tables.
-- Does NOT modify TblNewDay, TblShiftMove, invoices, cash, bookings,
-- queue, attendance, payroll, targets, or ledger.
-- ============================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

------------------------------------------------------------
-- 1) TblBranch
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblBranch', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblBranch] (
        [BranchID]               INT            IDENTITY(1,1) NOT NULL,
        [BranchCode]             NVARCHAR(30)   NOT NULL,
        [BranchName]             NVARCHAR(100)  NOT NULL,
        [ShortName]              NVARCHAR(50)   NULL,
        [Address]                NVARCHAR(250)  NULL,
        [Phone]                  NVARCHAR(30)   NULL,
        [TimeZone]               NVARCHAR(64)   NOT NULL
            CONSTRAINT [DF_TblBranch_TimeZone] DEFAULT (N'Africa/Cairo'),
        [BusinessDayCutoffTime]  TIME(0)        NOT NULL
            CONSTRAINT [DF_TblBranch_BusinessDayCutoffTime] DEFAULT ('04:00'),
        [DefaultOpenTime]        TIME(0)        NULL,
        [DefaultCloseTime]       TIME(0)        NULL,
        [IsActive]               BIT            NOT NULL
            CONSTRAINT [DF_TblBranch_IsActive] DEFAULT (1),
        [CreatedAt]              DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblBranch_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]              DATETIME2(0)   NULL,
        [CreatedByUserID]        INT            NULL,
        CONSTRAINT [PK_TblBranch] PRIMARY KEY CLUSTERED ([BranchID]),
        CONSTRAINT [UQ_TblBranch_BranchCode] UNIQUE ([BranchCode]),
        CONSTRAINT [CK_TblBranch_BranchCode_NotBlank]
            CHECK (LEN(LTRIM(RTRIM([BranchCode]))) > 0),
        CONSTRAINT [CK_TblBranch_BranchName_NotBlank]
            CHECK (LEN(LTRIM(RTRIM([BranchName]))) > 0),
        CONSTRAINT [CK_TblBranch_BranchCode_Normalized]
            CHECK ([BranchCode] = UPPER(LTRIM(RTRIM([BranchCode])))),
        CONSTRAINT [FK_TblBranch_CreatedByUserID]
            FOREIGN KEY ([CreatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID])
    );
    PRINT 'Created TblBranch';
END
ELSE
    PRINT 'TblBranch already exists';

-- Seed GLEEM exactly once by BranchCode (never assume BranchID = 1)
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblBranch] WHERE [BranchCode] = N'GLEEM'
)
BEGIN
    INSERT INTO [dbo].[TblBranch] (
        [BranchCode], [BranchName], [ShortName],
        [TimeZone], [BusinessDayCutoffTime], [IsActive]
    )
    VALUES (
        N'GLEEM',
        N'جليم – سابا باشا',
        N'جليم',
        N'Africa/Cairo',
        '04:00',
        1
    );
    PRINT 'Seeded founding branch GLEEM';
END
ELSE
    PRINT 'Founding branch GLEEM already present';

------------------------------------------------------------
-- 2) TblUserBranchAccess
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblUserBranchAccess', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblUserBranchAccess] (
        [ID]               BIGINT         IDENTITY(1,1) NOT NULL,
        [UserID]           INT            NOT NULL,
        [BranchID]         INT            NOT NULL,
        [IsDefault]        BIT            NOT NULL
            CONSTRAINT [DF_TblUserBranchAccess_IsDefault] DEFAULT (0),
        [CanOperate]       BIT            NOT NULL
            CONSTRAINT [DF_TblUserBranchAccess_CanOperate] DEFAULT (1),
        [CanViewReports]   BIT            NOT NULL
            CONSTRAINT [DF_TblUserBranchAccess_CanViewReports] DEFAULT (0),
        [CanSwitch]        BIT            NOT NULL
            CONSTRAINT [DF_TblUserBranchAccess_CanSwitch] DEFAULT (0),
        [IsActive]         BIT            NOT NULL
            CONSTRAINT [DF_TblUserBranchAccess_IsActive] DEFAULT (1),
        [ValidFrom]        DATETIME2(0)   NOT NULL,
        [ValidTo]          DATETIME2(0)   NULL,
        [GrantedByUserID]  INT            NULL,
        [GrantReason]      NVARCHAR(250)  NULL,
        [CreatedAt]        DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblUserBranchAccess_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]        DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblUserBranchAccess] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [UQ_TblUserBranchAccess_User_Branch] UNIQUE ([UserID], [BranchID]),
        CONSTRAINT [FK_TblUserBranchAccess_UserID]
            FOREIGN KEY ([UserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [FK_TblUserBranchAccess_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID]),
        CONSTRAINT [FK_TblUserBranchAccess_GrantedByUserID]
            FOREIGN KEY ([GrantedByUserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [CK_TblUserBranchAccess_ValidRange]
            CHECK ([ValidTo] IS NULL OR [ValidTo] > [ValidFrom])
    );
    PRINT 'Created TblUserBranchAccess';
END
ELSE
    PRINT 'TblUserBranchAccess already exists';

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblUserBranchAccess_OneActiveDefault'
      AND object_id = OBJECT_ID(N'dbo.TblUserBranchAccess')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblUserBranchAccess_OneActiveDefault]
        ON [dbo].[TblUserBranchAccess] ([UserID])
        WHERE [IsDefault] = 1 AND [IsActive] = 1;
    PRINT 'Created UX_TblUserBranchAccess_OneActiveDefault';
END

------------------------------------------------------------
-- 3) TblEmpBranchAssignment
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblEmpBranchAssignment', N'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[TblEmpBranchAssignment] (
        [ID]                   BIGINT         IDENTITY(1,1) NOT NULL,
        [EmpID]                INT            NOT NULL,
        [BranchID]             INT            NOT NULL,
        [IsHomeBranch]         BIT            NOT NULL
            CONSTRAINT [DF_TblEmpBranchAssignment_IsHomeBranch] DEFAULT (0),
        [CanReceiveBookings]   BIT            NOT NULL
            CONSTRAINT [DF_TblEmpBranchAssignment_CanReceiveBookings] DEFAULT (1),
        [IsActive]             BIT            NOT NULL
            CONSTRAINT [DF_TblEmpBranchAssignment_IsActive] DEFAULT (1),
        [EffectiveFrom]        DATE           NOT NULL,
        [EffectiveTo]          DATE           NULL,
        [CreatedAt]            DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblEmpBranchAssignment_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]            DATETIME2(0)   NULL,
        [CreatedByUserID]      INT            NULL,
        [Notes]                NVARCHAR(250)  NULL,
        CONSTRAINT [PK_TblEmpBranchAssignment] PRIMARY KEY CLUSTERED ([ID]),
        CONSTRAINT [FK_TblEmpBranchAssignment_EmpID]
            FOREIGN KEY ([EmpID]) REFERENCES [dbo].[TblEmp] ([EmpID]),
        CONSTRAINT [FK_TblEmpBranchAssignment_BranchID]
            FOREIGN KEY ([BranchID]) REFERENCES [dbo].[TblBranch] ([BranchID]),
        CONSTRAINT [FK_TblEmpBranchAssignment_CreatedByUserID]
            FOREIGN KEY ([CreatedByUserID]) REFERENCES [dbo].[TblUser] ([UserID]),
        CONSTRAINT [CK_TblEmpBranchAssignment_EffectiveRange]
            CHECK ([EffectiveTo] IS NULL OR [EffectiveTo] >= [EffectiveFrom])
    );
    PRINT 'Created TblEmpBranchAssignment';
END
ELSE
    PRINT 'TblEmpBranchAssignment already exists';

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblEmpBranchAssignment_OneActiveHome'
      AND object_id = OBJECT_ID(N'dbo.TblEmpBranchAssignment')
)
BEGIN
    -- Phase 1B seed creates one home; overlapping multi-home later enforced in services too.
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblEmpBranchAssignment_OneActiveHome]
        ON [dbo].[TblEmpBranchAssignment] ([EmpID])
        WHERE [IsHomeBranch] = 1 AND [IsActive] = 1;
    PRINT 'Created UX_TblEmpBranchAssignment_OneActiveHome';
END

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblEmpBranchAssignment_Emp_Branch'
      AND object_id = OBJECT_ID(N'dbo.TblEmpBranchAssignment')
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_TblEmpBranchAssignment_Emp_Branch]
        ON [dbo].[TblEmpBranchAssignment] ([EmpID], [BranchID], [IsActive], [EffectiveFrom], [EffectiveTo]);
    PRINT 'Created IX_TblEmpBranchAssignment_Emp_Branch';
END

------------------------------------------------------------
-- 4) Backfill current users → GLEEM access (idempotent; no overwrite)
------------------------------------------------------------
DECLARE @GleemBranchID INT;
SELECT @GleemBranchID = [BranchID]
FROM [dbo].[TblBranch]
WHERE [BranchCode] = N'GLEEM';

IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'GLEEM branch missing after seed', 16, 1);
END;

DECLARE @Now DATETIME2(0) = SYSUTCDATETIME();
DECLARE @Today DATE = CAST(@Now AS DATE);

;WITH CurrentUsers AS (
    SELECT
        u.UserID,
        CASE
            WHEN LOWER(LTRIM(RTRIM(ISNULL(u.UserLevel, N'')))) = N'admin' THEN 1
            WHEN EXISTS (
                SELECT 1
                FROM [dbo].[TblUserRoles] ur
                INNER JOIN [dbo].[TblRoles] r ON r.RoleID = ur.RoleID
                WHERE ur.UserID = u.UserID
                  AND r.IsActive = 1
                  AND r.RoleKey IN (N'admin', N'super_admin')
            ) THEN 1
            ELSE 0
        END AS IsAuthoritativeAdmin
    FROM [dbo].[TblUser] u
    WHERE ISNULL(u.isDeleted, 0) = 0
)
INSERT INTO [dbo].[TblUserBranchAccess] (
    [UserID], [BranchID], [IsDefault], [CanOperate], [CanViewReports], [CanSwitch],
    [IsActive], [ValidFrom], [ValidTo], [GrantedByUserID], [GrantReason], [CreatedAt]
)
SELECT
    cu.UserID,
    @GleemBranchID,
    1,
    1,
    CASE WHEN cu.IsAuthoritativeAdmin = 1 THEN 1 ELSE 0 END,
    CASE WHEN cu.IsAuthoritativeAdmin = 1 THEN 1 ELSE 0 END,
    1,
    @Now,
    NULL,
    NULL,
    N'Phase 1B founding backfill to GLEEM',
    @Now
FROM CurrentUsers cu
WHERE NOT EXISTS (
    SELECT 1
    FROM [dbo].[TblUserBranchAccess] uba
    WHERE uba.UserID = cu.UserID
      AND uba.BranchID = @GleemBranchID
);

PRINT CONCAT('User GLEEM mappings inserted: ', @@ROWCOUNT);

------------------------------------------------------------
-- 5) Backfill active employees → GLEEM home assignment
------------------------------------------------------------
INSERT INTO [dbo].[TblEmpBranchAssignment] (
    [EmpID], [BranchID], [IsHomeBranch], [CanReceiveBookings], [IsActive],
    [EffectiveFrom], [EffectiveTo], [CreatedAt], [CreatedByUserID], [Notes]
)
SELECT
    e.EmpID,
    @GleemBranchID,
    1,
    1,
    1,
    @Today,
    NULL,
    @Now,
    NULL,
    N'Phase 1B founding home assignment to GLEEM'
FROM [dbo].[TblEmp] e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
      SELECT 1
      FROM [dbo].[TblEmpBranchAssignment] ea
      WHERE ea.EmpID = e.EmpID
        AND ea.BranchID = @GleemBranchID
  );

PRINT CONCAT('Employee GLEEM assignments inserted: ', @@ROWCOUNT);

COMMIT TRANSACTION;
PRINT 'Phase 1B multi-branch foundation migration complete';
