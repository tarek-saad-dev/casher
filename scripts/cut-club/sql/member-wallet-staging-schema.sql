/*
 * CUT CLUB real member OTP + wallet — STAGING-ONLY MIGRATION.
 * Schema is deliberately independent from staff pos_session.
 *
 * Operator: apply through controlled migration procedure ONLY against
 * last132_agent as drvo_agent, then review structure and permissions.
 * Do not run on last132 production without a separately authorized migration.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 51100, 'CUT_CLUB_OTP_SCHEMA_STAGING_ONLY', 1;
IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
  OR OBJECT_ID(N'dbo.TblClient', N'U') IS NULL
  OR COL_LENGTH(N'dbo.TblClient', N'TenantId') IS NULL
  THROW 51101, 'CUT_CLUB_LEGACY_TENANT_MAPPING_NOT_PROVEN', 1;

BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMemberAccount', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubMemberAccount (
    AccountID UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
    TenantId UNIQUEIDENTIFIER NOT NULL,
    PhoneNormalized NVARCHAR(20) NOT NULL,
    LegacyClientID INT NULL,
    LinkStatus VARCHAR(24) NOT NULL DEFAULT 'UNLINKED',
    LinkApprovedBy INT NULL,
    LinkApprovedAtUtc DATETIME2(3) NULL,
    LinkProofType VARCHAR(40) NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_CutClubMemberAccount PRIMARY KEY (AccountID),
    CONSTRAINT FK_CutClubMemberAccount_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT CK_CutClubMemberAccount_Status CHECK (LinkStatus IN ('UNLINKED','REVIEW_REQUIRED','ACTIVE')),
    CONSTRAINT CK_CutClubMemberAccount_Approved CHECK (
      (LinkStatus='ACTIVE' AND LegacyClientID IS NOT NULL AND LinkApprovedAtUtc IS NOT NULL AND LinkApprovedBy IS NOT NULL AND LinkProofType IS NOT NULL)
      OR LinkStatus <> 'ACTIVE'),
    CONSTRAINT CK_CutClubMemberAccount_Phone CHECK (
      PhoneNormalized LIKE '201[0125]%' AND LEN(PhoneNormalized)=12)
  );
  CREATE UNIQUE INDEX UX_CutClubMemberAccount_TenantPhone ON dbo.CutClubMemberAccount(TenantId,PhoneNormalized);
  CREATE UNIQUE INDEX UX_CutClubMemberAccount_TenantClient ON dbo.CutClubMemberAccount(TenantId,LegacyClientID)
    WHERE LegacyClientID IS NOT NULL;
END;

IF OBJECT_ID(N'dbo.CutClubOtpPending', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubOtpPending (
    TokenDigest CHAR(64) NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    PhoneNormalized NVARCHAR(20) NOT NULL,
    Purpose VARCHAR(24) NOT NULL,
    RequestID UNIQUEIDENTIFIER NOT NULL,
    ChallengeID UNIQUEIDENTIFIER NULL,
    Status VARCHAR(16) NOT NULL DEFAULT 'SENDING',
    VerifyLease UNIQUEIDENTIFIER NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    ConsumedAtUtc DATETIME2(3) NULL,
    CONSTRAINT PK_CutClubOtpPending PRIMARY KEY (TokenDigest),
    CONSTRAINT FK_CutClubOtpPending_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT CK_CutClubOtpPending_Purpose CHECK (Purpose IN ('CUT_CLUB_SIGNUP','LOGIN')),
    CONSTRAINT CK_CutClubOtpPending_Status CHECK (Status IN ('SENDING','READY','VERIFYING','CONSUMED','FAILED'))
  );
  CREATE UNIQUE INDEX UX_CutClubOtpPending_Request ON dbo.CutClubOtpPending(TenantId,RequestID);
END;

IF OBJECT_ID(N'dbo.CutClubCustomerSession', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubCustomerSession (
    TokenDigest CHAR(64) NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    AccountID UNIQUEIDENTIFIER NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    RevokedAtUtc DATETIME2(3) NULL,
    CONSTRAINT PK_CutClubCustomerSession PRIMARY KEY (TokenDigest),
    CONSTRAINT FK_CutClubCustomerSession_Account FOREIGN KEY (AccountID) REFERENCES dbo.CutClubMemberAccount(AccountID),
    CONSTRAINT FK_CutClubCustomerSession_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId)
  );
  CREATE INDEX IX_CutClubCustomerSession_Account ON dbo.CutClubCustomerSession(TenantId, AccountID, ExpiresAtUtc);
END;
COMMIT TRANSACTION;
SELECT N'CUT_CLUB_OTP_STAGING_SCHEMA_READY' AS Result;
