/*
 CUT CLUB 2.0 growth-platform persistence foundation — REVIEW-ONLY.
 Unapplied staging DDL; NO automatic migration, no production schema change.
 Tenant, branch and customer source-of-truth must be verified by an operator.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 51970, 'CUT CLUB growth schema is staging-only', 1;

IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
  THROW 51971, 'Tenant UUID foundation is required', 1;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.ClubOrganization', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClubOrganization (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      OrganizationId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
      OrganizationCode VARCHAR(64) NOT NULL,
      OrganizationType VARCHAR(20) NOT NULL,
      NameAr NVARCHAR(180) NOT NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'draft',
      CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClubOrganization PRIMARY KEY (TenantId, OrganizationId),
      CONSTRAINT UQ_ClubOrganization_Tenant_Code UNIQUE (TenantId, OrganizationCode),
      CONSTRAINT FK_ClubOrganization_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_ClubOrganization_Type CHECK (OrganizationType IN ('school','university','medical','company')),
      CONSTRAINT CK_ClubOrganization_Status CHECK (Status IN ('draft','verified','suspended','closed'))
    );
  END;

  IF OBJECT_ID(N'dbo.ClubMemberAffiliation', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClubMemberAffiliation (
      AffiliationId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      CustomerId INT NOT NULL,
      OrganizationId UNIQUEIDENTIFIER NOT NULL,
      VerificationStatus VARCHAR(20) NOT NULL DEFAULT 'pending',
      ProofDigest VARBINARY(32) NULL,
      VerifiedAtUtc DATETIME2 NULL,
      ExpiresAtUtc DATETIME2 NULL,
      CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClubMemberAffiliation PRIMARY KEY (AffiliationId),
      CONSTRAINT UQ_ClubMemberAffiliation_Tenant_Customer_Org UNIQUE (TenantId, CustomerId, OrganizationId),
      CONSTRAINT FK_ClubMemberAffiliation_Organization FOREIGN KEY (TenantId, OrganizationId)
        REFERENCES dbo.ClubOrganization(TenantId, OrganizationId),
      CONSTRAINT FK_ClubMemberAffiliation_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.TblClient(ClientID),
      CONSTRAINT CK_ClubMemberAffiliation_Status CHECK (VerificationStatus IN ('pending','verified','rejected','revoked')),
      CONSTRAINT CK_ClubMemberAffiliation_Expiry CHECK (ExpiresAtUtc IS NULL OR VerifiedAtUtc IS NULL OR ExpiresAtUtc > VerifiedAtUtc)
    );
  END;

  IF OBJECT_ID(N'dbo.ClubPolicyVersion', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClubPolicyVersion (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PolicyCode VARCHAR(64) NOT NULL,
      Version INT NOT NULL,
      OrganizationId UNIQUEIDENTIFIER NULL,
      BranchLegacyId INT NULL,
      PolicyKind VARCHAR(24) NOT NULL,
      StartsAtUtc DATETIME2 NOT NULL,
      EndsAtUtc DATETIME2 NULL,
      PolicyJson NVARCHAR(MAX) NOT NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'draft',
      CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClubPolicyVersion PRIMARY KEY (TenantId, PolicyCode, Version),
      CONSTRAINT FK_ClubPolicyVersion_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_ClubPolicyVersion_Organization FOREIGN KEY (TenantId, OrganizationId)
        REFERENCES dbo.ClubOrganization(TenantId, OrganizationId),
      CONSTRAINT CK_ClubPolicyVersion_Version CHECK (Version > 0),
      CONSTRAINT CK_ClubPolicyVersion_Kind CHECK (PolicyKind IN ('membership','challenge','referral','in_salon_gift')),
      CONSTRAINT CK_ClubPolicyVersion_Status CHECK (Status IN ('draft','approved','active','retired')),
      CONSTRAINT CK_ClubPolicyVersion_Time CHECK (EndsAtUtc IS NULL OR EndsAtUtc > StartsAtUtc),
      CONSTRAINT CK_ClubPolicyVersion_Json CHECK (ISJSON(PolicyJson) = 1)
    );
  END;

  IF OBJECT_ID(N'dbo.ClubEventInbox', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClubEventInbox (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      EventKey VARCHAR(128) NOT NULL,
      CustomerId INT NOT NULL,
      BranchLegacyId INT NOT NULL,
      EventType VARCHAR(40) NOT NULL,
      SourceReference VARCHAR(128) NOT NULL,
      OccurredAtUtc DATETIME2 NOT NULL,
      ReversedByEventKey VARCHAR(128) NULL,
      ProcessedAtUtc DATETIME2 NULL,
      CONSTRAINT PK_ClubEventInbox PRIMARY KEY (TenantId, EventKey),
      CONSTRAINT FK_ClubEventInbox_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_ClubEventInbox_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.TblClient(ClientID),
      CONSTRAINT CK_ClubEventInbox_Ids CHECK (CustomerId > 0 AND BranchLegacyId > 0),
      CONSTRAINT CK_ClubEventInbox_Type CHECK (EventType IN ('visit_completed','visit_reversed','referral_qualifying','gift_fulfilled'))
    );
    CREATE INDEX IX_ClubEventInbox_Tenant_Customer_Time
      ON dbo.ClubEventInbox(TenantId, CustomerId, OccurredAtUtc DESC);
  END;

  IF OBJECT_ID(N'dbo.ClubGrowthSettlement', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClubGrowthSettlement (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      CustomerId INT NOT NULL,
      IdempotencyKey VARCHAR(128) NOT NULL,
      PolicyCode VARCHAR(64) NOT NULL,
      PolicyVersion INT NOT NULL,
      SourceEventKey VARCHAR(128) NOT NULL,
      SettlementStatus VARCHAR(20) NOT NULL DEFAULT 'pending',
      LedgerId INT NULL,
      CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClubGrowthSettlement PRIMARY KEY (TenantId, CustomerId, IdempotencyKey),
      CONSTRAINT FK_ClubGrowthSettlement_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_ClubGrowthSettlement_Policy FOREIGN KEY (TenantId, PolicyCode, PolicyVersion)
        REFERENCES dbo.ClubPolicyVersion(TenantId, PolicyCode, Version),
      CONSTRAINT FK_ClubGrowthSettlement_Event FOREIGN KEY (TenantId, SourceEventKey)
        REFERENCES dbo.ClubEventInbox(TenantId, EventKey),
      CONSTRAINT CK_ClubGrowthSettlement_Status CHECK (SettlementStatus IN ('pending','committed','cancelled','reversed'))
    );
  END;

  IF OBJECT_ID(N'dbo.ClubOutbox', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClubOutbox (
      Id BIGINT IDENTITY(1,1) NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      IdempotencyKey VARCHAR(128) NOT NULL,
      EventType VARCHAR(80) NOT NULL,
      SafePayloadJson NVARCHAR(MAX) NOT NULL,
      Status VARCHAR(16) NOT NULL DEFAULT 'pending',
      AttemptCount INT NOT NULL DEFAULT 0,
      CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClubOutbox PRIMARY KEY (Id),
      CONSTRAINT UQ_ClubOutbox_Tenant_Idem UNIQUE (TenantId, IdempotencyKey),
      CONSTRAINT FK_ClubOutbox_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_ClubOutbox_Json CHECK (ISJSON(SafePayloadJson) = 1),
      CONSTRAINT CK_ClubOutbox_Status CHECK (Status IN ('pending','delivering','delivered','dead')),
      CONSTRAINT CK_ClubOutbox_Attempts CHECK (AttemptCount >= 0)
    );
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
