/*
 * DRVO modular quote REQUEST intake (not a priced quote, purchase order or payment).
 * Snapshots a tenant's current app-selection draft for manual follow-up.
 * Additive only. Does not touch legacy subscriptions, installed apps or invoices.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.TenantModularQuoteRequest',N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantModularQuoteRequest (
      RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_TenantModularQuoteRequest_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      DraftId UNIQUEIDENTIFIER NOT NULL,
      DraftRevision INT NOT NULL,
      CatalogId UNIQUEIDENTIFIER NOT NULL,
      IndustryCode NVARCHAR(32) NOT NULL,
      AppsJson NVARCHAR(MAX) NOT NULL,
      BranchCount INT NOT NULL,
      BillingCycle NVARCHAR(10) NOT NULL,
      Status NVARCHAR(24) NOT NULL CONSTRAINT DF_TenantModularQuoteRequest_Status DEFAULT N'awaiting_pricing',
      RequestedByUserId INT NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantModularQuoteRequest_Created DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantModularQuoteRequest_Updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantModularQuoteRequest PRIMARY KEY (RequestId),
      CONSTRAINT FK_TenantModularQuoteRequest_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_TenantModularQuoteRequest_Draft FOREIGN KEY (DraftId) REFERENCES dbo.TenantModularDraft(DraftId),
      CONSTRAINT FK_TenantModularQuoteRequest_Catalog FOREIGN KEY (CatalogId) REFERENCES dbo.ModularPriceCatalog(CatalogId),
      CONSTRAINT CK_TenantModularQuoteRequest_Revision CHECK (DraftRevision>=1),
      CONSTRAINT CK_TenantModularQuoteRequest_Branches CHECK (BranchCount>=1 AND BranchCount<=20),
      CONSTRAINT CK_TenantModularQuoteRequest_Cycle CHECK (BillingCycle IN (N'monthly',N'annual')),
      CONSTRAINT CK_TenantModularQuoteRequest_Json CHECK (ISJSON(AppsJson)=1),
      CONSTRAINT CK_TenantModularQuoteRequest_Status CHECK
        (Status IN (N'awaiting_pricing', N'closed')),
      CONSTRAINT UX_TenantModularQuoteRequest_DraftRevision UNIQUE (TenantId,DraftId,DraftRevision)
    );
    CREATE INDEX IX_TenantModularQuoteRequest_TenantHistory
      ON dbo.TenantModularQuoteRequest(TenantId,CreatedAt DESC);
    CREATE INDEX IX_TenantModularQuoteRequest_OperatorQueue
      ON dbo.TenantModularQuoteRequest(Status,CreatedAt ASC);
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRAN;
  THROW;
END CATCH;
