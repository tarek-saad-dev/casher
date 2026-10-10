/*
  DRVO-012 Commercial plans, subscription lifecycle, tenant industry pack state
  and tenant installed-app state.

  Additive only: new tables, new columns with defaults, insert-only seeds and
  backfills. No existing row changes its effective Enabled state.
  Every tenant that exists before this migration is grandfathered on the
  non-public `internal` plan, status `active`, with no trial/period/expiry dates.
  Statements that reference columns added to an existing table run through
  sp_executesql so the batch compiles before those columns exist.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.SaaSPlan', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.SaaSPlan (
      PlanCode NVARCHAR(32) NOT NULL,
      DisplayName NVARCHAR(128) NOT NULL,
      IsPublic BIT NOT NULL CONSTRAINT DF_SaaSPlan_IsPublic DEFAULT 1,
      IsActive BIT NOT NULL CONSTRAINT DF_SaaSPlan_IsActive DEFAULT 1,
      SortOrder INT NOT NULL CONSTRAINT DF_SaaSPlan_SortOrder DEFAULT 0,
      MaxBranches INT NULL,
      MaxUsers INT NULL,
      TrialDays INT NOT NULL CONSTRAINT DF_SaaSPlan_TrialDays DEFAULT 14,
      PastDueGraceDays INT NOT NULL CONSTRAINT DF_SaaSPlan_PastDueGraceDays DEFAULT 7,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_SaaSPlan_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_SaaSPlan_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_SaaSPlan PRIMARY KEY (PlanCode),
      CONSTRAINT CK_SaaSPlan_MaxBranches CHECK (MaxBranches IS NULL OR MaxBranches >= 1),
      CONSTRAINT CK_SaaSPlan_MaxUsers CHECK (MaxUsers IS NULL OR MaxUsers >= 1),
      CONSTRAINT CK_SaaSPlan_TrialDays CHECK (TrialDays >= 0),
      CONSTRAINT CK_SaaSPlan_PastDueGraceDays CHECK (PastDueGraceDays >= 0)
    );
  END;

  /* Provisional, editable plan data. Insert-only: never overwrites later edits. */
  IF NOT EXISTS (SELECT 1 FROM dbo.SaaSPlan WHERE PlanCode = N'starter')
    INSERT INTO dbo.SaaSPlan (PlanCode, DisplayName, IsPublic, IsActive, SortOrder, MaxBranches, MaxUsers, TrialDays, PastDueGraceDays)
    VALUES (N'starter', N'Starter', 1, 1, 10, 1, 5, 14, 7);
  IF NOT EXISTS (SELECT 1 FROM dbo.SaaSPlan WHERE PlanCode = N'growth')
    INSERT INTO dbo.SaaSPlan (PlanCode, DisplayName, IsPublic, IsActive, SortOrder, MaxBranches, MaxUsers, TrialDays, PastDueGraceDays)
    VALUES (N'growth', N'Growth', 1, 1, 20, 3, 20, 14, 7);
  IF NOT EXISTS (SELECT 1 FROM dbo.SaaSPlan WHERE PlanCode = N'pro')
    INSERT INTO dbo.SaaSPlan (PlanCode, DisplayName, IsPublic, IsActive, SortOrder, MaxBranches, MaxUsers, TrialDays, PastDueGraceDays)
    VALUES (N'pro', N'Pro', 1, 1, 30, 10, 75, 14, 7);
  IF NOT EXISTS (SELECT 1 FROM dbo.SaaSPlan WHERE PlanCode = N'internal')
    INSERT INTO dbo.SaaSPlan (PlanCode, DisplayName, IsPublic, IsActive, SortOrder, MaxBranches, MaxUsers, TrialDays, PastDueGraceDays)
    VALUES (N'internal', N'Internal (grandfathered)', 0, 1, 1000, NULL, NULL, 0, 0);

  IF OBJECT_ID(N'dbo.TenantSubscription', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantSubscription (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PlanCode NVARCHAR(32) NOT NULL,
      Status NVARCHAR(20) NOT NULL,
      Origin NVARCHAR(32) NOT NULL,
      TrialStartedAt DATETIME2 NULL,
      TrialEndsAt DATETIME2 NULL,
      CurrentPeriodEndsAt DATETIME2 NULL,
      PastDueSince DATETIME2 NULL,
      SuspendedAt DATETIME2 NULL,
      CancelledAt DATETIME2 NULL,
      Revision INT NOT NULL CONSTRAINT DF_TenantSubscription_Revision DEFAULT 1,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantSubscription_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantSubscription_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantSubscription PRIMARY KEY (TenantId),
      CONSTRAINT FK_TenantSubscription_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT FK_TenantSubscription_Plan FOREIGN KEY (PlanCode) REFERENCES dbo.SaaSPlan (PlanCode),
      CONSTRAINT CK_TenantSubscription_Status CHECK (
        Status IN (N'trial', N'active', N'past_due', N'suspended', N'cancelled')
      ),
      CONSTRAINT CK_TenantSubscription_Origin CHECK (
        Origin IN (N'migration_grandfathered', N'onboarding', N'platform_admin')
      ),
      CONSTRAINT CK_TenantSubscription_TrialEnds CHECK (Status <> N'trial' OR TrialEndsAt IS NOT NULL),
      CONSTRAINT CK_TenantSubscription_PastDueSince CHECK (Status <> N'past_due' OR PastDueSince IS NOT NULL)
    );
  END;

  IF OBJECT_ID(N'dbo.TenantIndustryPack', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantIndustryPack (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PackCode NVARCHAR(64) NOT NULL,
      PackVersion INT NOT NULL CONSTRAINT DF_TenantIndustryPack_PackVersion DEFAULT 1,
      ConfigJson NVARCHAR(MAX) NOT NULL,
      AppliedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantIndustryPack_AppliedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantIndustryPack_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantIndustryPack PRIMARY KEY (TenantId),
      CONSTRAINT FK_TenantIndustryPack_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)
    );
  END;

  IF COL_LENGTH(N'dbo.TenantAppEntitlement', N'Status') IS NULL
    ALTER TABLE dbo.TenantAppEntitlement
      ADD Status NVARCHAR(20) NOT NULL CONSTRAINT DF_TenantAppEntitlement_Status DEFAULT N'installed';
  IF COL_LENGTH(N'dbo.TenantAppEntitlement', N'Source') IS NULL
    ALTER TABLE dbo.TenantAppEntitlement
      ADD Source NVARCHAR(20) NOT NULL CONSTRAINT DF_TenantAppEntitlement_Source DEFAULT N'bootstrap';
  IF COL_LENGTH(N'dbo.TenantAppEntitlement', N'InstalledAt') IS NULL
    ALTER TABLE dbo.TenantAppEntitlement ADD InstalledAt DATETIME2 NULL;
  IF COL_LENGTH(N'dbo.TenantAppEntitlement', N'DisabledAt') IS NULL
    ALTER TABLE dbo.TenantAppEntitlement ADD DisabledAt DATETIME2 NULL;
  IF COL_LENGTH(N'dbo.TenantAppEntitlement', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.TenantAppEntitlement
      ADD UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantAppEntitlement_UpdatedAt DEFAULT SYSUTCDATETIME();

  /* Preserve effective state: Enabled = 0 rows become disabled; nothing else changes. */
  EXEC sp_executesql N'
    UPDATE dbo.TenantAppEntitlement
    SET Status = N''disabled''
    WHERE Enabled = 0 AND Status <> N''disabled'';
  ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TenantAppEntitlement_Status'
      AND parent_object_id = OBJECT_ID(N'dbo.TenantAppEntitlement')
  )
    EXEC sp_executesql N'
      ALTER TABLE dbo.TenantAppEntitlement WITH CHECK
        ADD CONSTRAINT CK_TenantAppEntitlement_Status CHECK (
          (Status = N''installed'' AND Enabled = 1) OR (Status = N''disabled'' AND Enabled = 0)
        );
    ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TenantAppEntitlement_Source'
      AND parent_object_id = OBJECT_ID(N'dbo.TenantAppEntitlement')
  )
    EXEC sp_executesql N'
      ALTER TABLE dbo.TenantAppEntitlement WITH CHECK
        ADD CONSTRAINT CK_TenantAppEntitlement_Source CHECK (
          Source IN (N''bootstrap'', N''pack'', N''customer'', N''platform_admin'')
        );
    ';

  /* Grandfather every pre-existing tenant. Never starts a trial or expiry clock. */
  INSERT INTO dbo.TenantSubscription (TenantId, PlanCode, Status, Origin)
  SELECT t.TenantId, N'internal', N'active', N'migration_grandfathered'
  FROM dbo.Tenant t
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.TenantSubscription s WHERE s.TenantId = t.TenantId
  );

  /* Canonical pack state from the SalonPackConfig compatibility seam. Insert-only. */
  INSERT INTO dbo.TenantIndustryPack (TenantId, PackCode, PackVersion, ConfigJson)
  SELECT
    c.TenantId,
    c.PackCode,
    1,
    N'{"source":"SalonPackConfig","legacyManifest":' + c.ManifestJson + N'}'
  FROM dbo.SalonPackConfig c
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.TenantIndustryPack p WHERE p.TenantId = c.TenantId
  );

  COMMIT TRAN;
  SELECT N'DRVO-012 commercial subscription and tenant apps schema ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
