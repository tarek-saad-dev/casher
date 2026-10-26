/*
 * DRVO ERP modular commercial foundation V1.
 * SHADOW/DRAFT ONLY. There is no payment, paid activation, or access gate here.
 * No prices, catalog approvals, paid subscriptions or entitlements are seeded.
 * Existing SaaSPlan, TenantSubscription, TenantAppEntitlement and CASHER_BOOT untouched.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.ModularPriceCatalog', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ModularPriceCatalog (
      CatalogId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ModularPriceCatalog_Id DEFAULT NEWSEQUENTIALID(),
      CatalogCode NVARCHAR(64) NOT NULL,
      Version INT NOT NULL,
      IndustryCode NVARCHAR(32) NOT NULL,
      CurrencyCode CHAR(3) NOT NULL,
      Status NVARCHAR(16) NOT NULL CONSTRAINT DF_ModularPriceCatalog_Status DEFAULT N'draft',
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ModularPriceCatalog_Created DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ModularPriceCatalog_Updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ModularPriceCatalog PRIMARY KEY (CatalogId),
      CONSTRAINT UX_ModularPriceCatalog_CodeVersion UNIQUE (CatalogCode, Version),
      CONSTRAINT CK_ModularPriceCatalog_Version CHECK (Version >= 1),
      CONSTRAINT CK_ModularPriceCatalog_Status CHECK (Status IN (N'draft', N'approved', N'retired')),
      CONSTRAINT CK_ModularPriceCatalog_Currency CHECK (CurrencyCode = 'EGP')
    );
    CREATE INDEX IX_ModularPriceCatalog_IndustryStatus
      ON dbo.ModularPriceCatalog (IndustryCode, Status, Version DESC);
  END;

  IF OBJECT_ID(N'dbo.ModularPriceCatalogItem', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ModularPriceCatalogItem (
      CatalogId UNIQUEIDENTIFIER NOT NULL,
      ItemKind NVARCHAR(24) NOT NULL,
      ItemCode NVARCHAR(64) NOT NULL,
      MonthlyMinor BIGINT NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ModularPriceCatalogItem_Created DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ModularPriceCatalogItem PRIMARY KEY (CatalogId, ItemKind, ItemCode),
      CONSTRAINT FK_ModularPriceCatalogItem_Catalog FOREIGN KEY (CatalogId)
        REFERENCES dbo.ModularPriceCatalog(CatalogId),
      CONSTRAINT CK_ModularPriceCatalogItem_Kind CHECK
        (ItemKind IN (N'app', N'base', N'extra_branch')),
      CONSTRAINT CK_ModularPriceCatalogItem_Amount CHECK (MonthlyMinor >= 0),
      CONSTRAINT CK_ModularPriceCatalogItem_Codes CHECK
        ((ItemKind = N'app' AND ItemCode NOT IN (N'base', N'extra_branch'))
         OR (ItemKind = N'base' AND ItemCode = N'base')
         OR (ItemKind = N'extra_branch' AND ItemCode = N'extra_branch'))
    );
  END;

  /*
   * A DRAFT selection does NOT represent a paid subscription or a grant.
   * Retain data as an explicit planning snapshot only. No implicit activation.
   */
  IF OBJECT_ID(N'dbo.TenantModularDraft', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantModularDraft (
      DraftId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_TenantModularDraft_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      CatalogId UNIQUEIDENTIFIER NOT NULL,
      BillingCycle NVARCHAR(10) NOT NULL,
      BranchCount INT NOT NULL,
      Revision INT NOT NULL CONSTRAINT DF_TenantModularDraft_Revision DEFAULT 1,
      Status NVARCHAR(16) NOT NULL CONSTRAINT DF_TenantModularDraft_Status DEFAULT N'draft',
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantModularDraft_Created DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantModularDraft_Updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantModularDraft PRIMARY KEY (DraftId),
      CONSTRAINT FK_TenantModularDraft_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_TenantModularDraft_Catalog FOREIGN KEY (CatalogId) REFERENCES dbo.ModularPriceCatalog(CatalogId),
      CONSTRAINT CK_TenantModularDraft_Cycle CHECK (BillingCycle IN (N'monthly', N'annual')),
      CONSTRAINT CK_TenantModularDraft_Branches CHECK (BranchCount >= 1),
      CONSTRAINT CK_TenantModularDraft_Revision CHECK (Revision >= 1),
      CONSTRAINT CK_TenantModularDraft_Status CHECK (Status IN (N'draft', N'void'))
    );
    CREATE UNIQUE INDEX UX_TenantModularDraft_CurrentTenant
      ON dbo.TenantModularDraft(TenantId) WHERE Status = N'draft';
    CREATE INDEX IX_TenantModularDraft_TenantHistory
      ON dbo.TenantModularDraft(TenantId, CreatedAt DESC);
  END;

  IF OBJECT_ID(N'dbo.TenantModularDraftApp', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantModularDraftApp (
      DraftId UNIQUEIDENTIFIER NOT NULL,
      AppCode NVARCHAR(64) NOT NULL,
      CONSTRAINT PK_TenantModularDraftApp PRIMARY KEY (DraftId, AppCode),
      CONSTRAINT FK_TenantModularDraftApp_Draft FOREIGN KEY (DraftId)
        REFERENCES dbo.TenantModularDraft(DraftId)
    );
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
