/*
 * DRVO-026 CUT CLUB customer authentication foundation.
 * Additive schema only. No edits to historic customer balances, vouchers,
 * purchase records or financial ledgers. No new customer is auto-linked.
 *
 * Production execution MUST use the DRVO immutable migration manifest,
 * exact SHA PLAN/APPLY approvals and a verified production backup reference.
 * NEVER execute this file manually on production.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'last132_agent', N'last132')
  THROW 51230, 'CUT_CLUB_MIGRATION_UNEXPECTED_DATABASE', 1;

IF OBJECT_ID(N'dbo.Tenant',N'U') IS NULL
    OR OBJECT_ID(N'dbo.TblClient',N'U') IS NULL
    OR COL_LENGTH(N'dbo.Tenant',N'TenantId') IS NULL
    OR COL_LENGTH(N'dbo.TblClient',N'TenantId') IS NULL
    OR COL_LENGTH(N'dbo.TblClient',N'ClientID') IS NULL
    OR COL_LENGTH(N'dbo.Tenant',N'Code') IS NULL
    OR COL_LENGTH(N'dbo.Tenant',N'Status') IS NULL
  THROW 51231, 'CUT_CLUB_MIGRATION_TENANT_PREREQUISITES_MISSING', 1;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.CutClubMemberAccount',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubMemberAccount(
    AccountID UNIQUEIDENTIFIER NOT NULL
      CONSTRAINT DF_CutClubMemberAccount_AccountID DEFAULT NEWID(),
    TenantId UNIQUEIDENTIFIER NOT NULL,
    PhoneNormalized NVARCHAR(20) NOT NULL,
    LegacyClientID INT NULL,
    LinkStatus VARCHAR(24) NOT NULL
      CONSTRAINT DF_CutClubMemberAccount_LinkStatus DEFAULT 'UNLINKED',
    LinkApprovedBy INT NULL,
    LinkApprovedAtUtc DATETIME2(3) NULL,
    LinkProofType VARCHAR(40) NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_CutClubMemberAccount_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_CutClubMemberAccount_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_CutClubMemberAccount PRIMARY KEY (AccountID),
    CONSTRAINT FK_CutClubMemberAccount_Tenant FOREIGN KEY(TenantId)
      REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT CK_CutClubMemberAccount_Status CHECK
      (LinkStatus IN ('UNLINKED','REVIEW_REQUIRED','ACTIVE')),
    CONSTRAINT CK_CutClubMemberAccount_Approved CHECK
      (LinkStatus <> 'ACTIVE' OR
        (LegacyClientID IS NOT NULL AND LinkApprovedBy IS NOT NULL
         AND LinkApprovedAtUtc IS NOT NULL AND LinkProofType IS NOT NULL)),
    CONSTRAINT CK_CutClubMemberAccount_Phone CHECK
      (PhoneNormalized LIKE N'201[0125]%' AND LEN(PhoneNormalized)=12)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubMemberAccount')
    AND name=N'UX_CutClubMemberAccount_TenantPhone'
)
  CREATE UNIQUE INDEX UX_CutClubMemberAccount_TenantPhone
    ON dbo.CutClubMemberAccount(TenantId,PhoneNormalized);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubMemberAccount')
    AND name=N'UX_CutClubMemberAccount_TenantClient'
)
  CREATE UNIQUE INDEX UX_CutClubMemberAccount_TenantClient
    ON dbo.CutClubMemberAccount(TenantId,LegacyClientID)
    WHERE LegacyClientID IS NOT NULL;

IF OBJECT_ID(N'dbo.CutClubOtpPending',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubOtpPending(
    TokenDigest CHAR(64) NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    PhoneNormalized NVARCHAR(20) NOT NULL,
    Purpose VARCHAR(24) NOT NULL,
    RequestID UNIQUEIDENTIFIER NOT NULL,
    ChallengeID UNIQUEIDENTIFIER NULL,
    Status VARCHAR(16) NOT NULL
      CONSTRAINT DF_CutClubOtpPending_Status DEFAULT 'SENDING',
    VerifyLease UNIQUEIDENTIFIER NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_CutClubOtpPending_Created DEFAULT SYSUTCDATETIME(),
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    ConsumedAtUtc DATETIME2(3) NULL,
    CONSTRAINT PK_CutClubOtpPending PRIMARY KEY(TokenDigest),
    CONSTRAINT FK_CutClubOtpPending_Tenant FOREIGN KEY(TenantId)
      REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT CK_CutClubOtpPending_Purpose CHECK
      (Purpose IN ('CUT_CLUB_SIGNUP','LOGIN')),
    CONSTRAINT CK_CutClubOtpPending_Status CHECK
      (Status IN ('SENDING','READY','VERIFYING','CONSUMED','FAILED'))
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubOtpPending')
    AND name=N'UX_CutClubOtpPending_Request'
)
  CREATE UNIQUE INDEX UX_CutClubOtpPending_Request
    ON dbo.CutClubOtpPending(TenantId,RequestID);

IF OBJECT_ID(N'dbo.CutClubCustomerSession',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubCustomerSession(
    TokenDigest CHAR(64) NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    AccountID UNIQUEIDENTIFIER NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_CutClubCustomerSession_Created DEFAULT SYSUTCDATETIME(),
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    RevokedAtUtc DATETIME2(3) NULL,
    CONSTRAINT PK_CutClubCustomerSession PRIMARY KEY(TokenDigest),
    CONSTRAINT FK_CutClubCustomerSession_Account FOREIGN KEY(AccountID)
      REFERENCES dbo.CutClubMemberAccount(AccountID),
    CONSTRAINT FK_CutClubCustomerSession_Tenant FOREIGN KEY(TenantId)
      REFERENCES dbo.Tenant(TenantId)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubCustomerSession')
    AND name=N'IX_CutClubCustomerSession_Account'
)
  CREATE INDEX IX_CutClubCustomerSession_Account
    ON dbo.CutClubCustomerSession(TenantId,AccountID,ExpiresAtUtc);

COMMIT TRANSACTION;
