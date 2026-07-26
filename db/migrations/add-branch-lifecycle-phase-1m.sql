/*
  Phase 1M — Branch lifecycle, public booking gate, smoke run registry.

  Extends TblBranch without replacing IsActive:
  - LifecycleStatus drives SETUP / SMOKE_TEST / INTERNAL_LIVE / PUBLIC_LIVE / SUSPENDED
  - PublicBookingEnabled is independent of operational IsActive
  - IsActive remains the production ops + nightly gate (synced by transition service)

  Does NOT activate PH1GTEST. Does NOT create a real second branch.

  NOTE: ALTER COLUMN and references must be separate batches (Azure SQL).
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- ── Batch 1: columns ────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.TblBranch', 'LifecycleStatus') IS NULL
BEGIN
  ALTER TABLE dbo.TblBranch
    ADD LifecycleStatus NVARCHAR(30) NOT NULL
      CONSTRAINT DF_TblBranch_LifecycleStatus DEFAULT (N'SETUP');
END;
GO

IF COL_LENGTH('dbo.TblBranch', 'PublicBookingEnabled') IS NULL
BEGIN
  ALTER TABLE dbo.TblBranch
    ADD PublicBookingEnabled BIT NOT NULL
      CONSTRAINT DF_TblBranch_PublicBookingEnabled DEFAULT (0);
END;
GO

IF COL_LENGTH('dbo.TblBranch', 'ExternalNotificationsEnabled') IS NULL
BEGIN
  ALTER TABLE dbo.TblBranch
    ADD ExternalNotificationsEnabled BIT NOT NULL
      CONSTRAINT DF_TblBranch_ExternalNotificationsEnabled DEFAULT (0);
END;
GO

IF COL_LENGTH('dbo.TblBranch', 'SmokeAllowlistJson') IS NULL
BEGIN
  ALTER TABLE dbo.TblBranch
    ADD SmokeAllowlistJson NVARCHAR(MAX) NULL;
END;
GO

-- ── Batch 2: check constraint ───────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_TblBranch_LifecycleStatus' AND parent_object_id = OBJECT_ID(N'dbo.TblBranch')
)
BEGIN
  ALTER TABLE dbo.TblBranch WITH NOCHECK
    ADD CONSTRAINT CK_TblBranch_LifecycleStatus CHECK (
      LifecycleStatus IN (
        N'SETUP', N'SMOKE_TEST', N'INTERNAL_LIVE', N'PUBLIC_LIVE', N'SUSPENDED'
      )
    );
END;
GO

-- ── Batch 3: backfill ───────────────────────────────────────────────────────
-- Explicit: PH1GTEST must never be public / operational from this migration
UPDATE dbo.TblBranch
SET
  LifecycleStatus = N'SETUP',
  IsActive = 0,
  PublicBookingEnabled = 0,
  ExternalNotificationsEnabled = 0
WHERE BranchCode = N'PH1GTEST';

-- GLEEM remains the sole production public branch if active
UPDATE dbo.TblBranch
SET
  LifecycleStatus = N'PUBLIC_LIVE',
  PublicBookingEnabled = 1,
  ExternalNotificationsEnabled = 1
WHERE BranchCode = N'GLEEM' AND IsActive = 1;

-- Any other active branch (should not exist today) → INTERNAL_LIVE without public
UPDATE dbo.TblBranch
SET
  LifecycleStatus = N'INTERNAL_LIVE',
  PublicBookingEnabled = 0,
  ExternalNotificationsEnabled = 0
WHERE IsActive = 1
  AND BranchCode NOT IN (N'GLEEM', N'PH1GTEST')
  AND LifecycleStatus = N'SETUP';

-- Remaining inactive non-PH1GTEST stay SETUP
UPDATE dbo.TblBranch
SET
  LifecycleStatus = N'SETUP',
  PublicBookingEnabled = 0,
  ExternalNotificationsEnabled = 0
WHERE IsActive = 0
  AND BranchCode <> N'PH1GTEST'
  AND LifecycleStatus = N'SETUP';
GO

-- ── Batch 4: lifecycle audit ────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.TblBranchLifecycleAudit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBranchLifecycleAudit (
    AuditID           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    BranchID          INT NOT NULL,
    FromStatus        NVARCHAR(30) NOT NULL,
    ToStatus          NVARCHAR(30) NOT NULL,
    Reason            NVARCHAR(500) NOT NULL,
    ActorUserID       INT NULL,
    ReadinessJson     NVARCHAR(MAX) NULL,
    CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_TblBranchLifecycleAudit_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_TblBranchLifecycleAudit_Branch
      FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch(BranchID)
  );
  CREATE INDEX IX_TblBranchLifecycleAudit_Branch
    ON dbo.TblBranchLifecycleAudit (BranchID, CreatedAt DESC);
END;
GO

-- ── Batch 5: smoke run registry ─────────────────────────────────────────────
IF OBJECT_ID(N'dbo.TblBranchSmokeRun', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBranchSmokeRun (
    SmokeRunID                    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    BranchID                      INT NOT NULL,
    Status                        NVARCHAR(30) NOT NULL
      CONSTRAINT DF_TblBranchSmokeRun_Status DEFAULT (N'RUNNING'),
    StartedAt                     DATETIME2 NOT NULL
      CONSTRAINT DF_TblBranchSmokeRun_StartedAt DEFAULT (SYSUTCDATETIME()),
    CompletedAt                   DATETIME2 NULL,
    StartedByUserID               INT NULL,
    Purpose                       NVARCHAR(200) NOT NULL,
    ExternalSideEffectsEnabled    BIT NOT NULL
      CONSTRAINT DF_TblBranchSmokeRun_ExtFX DEFAULT (0),
    BeforeFingerprintJson         NVARCHAR(MAX) NULL,
    AfterFingerprintJson          NVARCHAR(MAX) NULL,
    ResultJson                    NVARCHAR(MAX) NULL,
    CleanupStatus                 NVARCHAR(30) NOT NULL
      CONSTRAINT DF_TblBranchSmokeRun_Cleanup DEFAULT (N'NONE'),
    CONSTRAINT FK_TblBranchSmokeRun_Branch
      FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch(BranchID),
    CONSTRAINT CK_TblBranchSmokeRun_Status CHECK (
      Status IN (N'RUNNING', N'PASSED', N'FAILED', N'ABORTED', N'CLEANED')
    )
  );
  CREATE INDEX IX_TblBranchSmokeRun_Branch
    ON dbo.TblBranchSmokeRun (BranchID, StartedAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.TblBranchSmokeArtifact', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBranchSmokeArtifact (
    SmokeArtifactID   BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    SmokeRunID        BIGINT NOT NULL,
    EntityType        NVARCHAR(80) NOT NULL,
    EntityID          NVARCHAR(80) NOT NULL,
    CreatedAt         DATETIME2 NOT NULL
      CONSTRAINT DF_TblBranchSmokeArtifact_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CleanupOrder      INT NOT NULL CONSTRAINT DF_TblBranchSmokeArtifact_Order DEFAULT (100),
    CleanupStatus     NVARCHAR(30) NOT NULL
      CONSTRAINT DF_TblBranchSmokeArtifact_Cleanup DEFAULT (N'PENDING'),
    CleanupNote       NVARCHAR(400) NULL,
    CONSTRAINT FK_TblBranchSmokeArtifact_Run
      FOREIGN KEY (SmokeRunID) REFERENCES dbo.TblBranchSmokeRun(SmokeRunID)
  );
  CREATE INDEX IX_TblBranchSmokeArtifact_Run
    ON dbo.TblBranchSmokeArtifact (SmokeRunID, CleanupOrder);
END;
GO
