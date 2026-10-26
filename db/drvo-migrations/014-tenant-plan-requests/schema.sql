/*
  DRVO V1 tenant billing requests. Payment is NOT collected here.
  Additive ledger of quoted plan requests, never a subscription entitlement.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.TenantPlanChangeRequest', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantPlanChangeRequest (
      RequestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_TenantPlanChangeRequest_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      FromPlanCode NVARCHAR(32) NOT NULL,
      RequestedPlanCode NVARCHAR(32) NOT NULL,
      BillingCycle NVARCHAR(10) NOT NULL,
      QuotedAmountEgp DECIMAL(12,2) NOT NULL,
      SubscriptionRevision INT NOT NULL,
      Status NVARCHAR(16) NOT NULL CONSTRAINT DF_TenantPlanChangeRequest_Status DEFAULT N'pending',
      RequestedByUserId INT NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantPlanChangeRequest_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantPlanChangeRequest_UpdatedAt DEFAULT SYSUTCDATETIME(),
      ReviewedAt DATETIME2 NULL,
      ReviewedByUserId INT NULL,
      ReviewNote NVARCHAR(500) NULL,
      CONSTRAINT PK_TenantPlanChangeRequest PRIMARY KEY (RequestId),
      CONSTRAINT FK_TenantPlanChangeRequest_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_TenantPlanChangeRequest_Plan FOREIGN KEY (RequestedPlanCode) REFERENCES dbo.SaaSPlan(PlanCode),
      CONSTRAINT CK_TenantPlanChangeRequest_Cycle CHECK (BillingCycle IN (N'monthly',N'annual')),
      CONSTRAINT CK_TenantPlanChangeRequest_Status CHECK (Status IN (N'pending',N'contacted',N'rejected',N'cancelled')),
      CONSTRAINT CK_TenantPlanChangeRequest_Amount CHECK (QuotedAmountEgp >= 0),
      CONSTRAINT CK_TenantPlanChangeRequest_Revision CHECK (SubscriptionRevision >= 1)
    );
    CREATE UNIQUE INDEX UX_TenantPlanChangeRequest_PendingTenant
      ON dbo.TenantPlanChangeRequest (TenantId) WHERE Status = N'pending';
    CREATE INDEX IX_TenantPlanChangeRequest_Queue ON dbo.TenantPlanChangeRequest
      (Status,CreatedAt DESC) INCLUDE (TenantId,RequestedPlanCode,BillingCycle,QuotedAmountEgp);
    CREATE INDEX IX_TenantPlanChangeRequest_TenantHistory ON dbo.TenantPlanChangeRequest
      (TenantId,CreatedAt DESC);
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
