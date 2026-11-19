/*
CUT CLUB member pass+session tables — EXPLICIT STAGING APPLY ONLY.
No production execution. All writes from the app are independently
guarded by CUT_CLUB_MEMBER_WALLET_ENABLED=true, default OFF.
Release to last132 requires separately reviewed migration/change approval.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
    THROW 51030, 'CUT_CLUB_MEMBER_SCHEMA_STAGING_ONLY', 1;

IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL OR OBJECT_ID(N'dbo.TblClient', N'U') IS NULL
    THROW 51031, 'CUT_CLUB_MEMBER_SCHEMA_MISSING_TENANT_CLIENT', 1;
IF COL_LENGTH('dbo.TblClient', 'TenantId') IS NULL
    THROW 51032, 'CUT_CLUB_MEMBER_SCHEMA_UNPROVEN_CLIENT_TENANT_MAPPING', 1;
IF OBJECT_ID(N'dbo.CutClubMemberPass', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.CutClubMemberSession', N'U') IS NOT NULL
    THROW 51033, 'CUT_CLUB_MEMBER_SCHEMA_ALREADY_EXISTS_REVIEW_BEFORE_REAPPLY', 1;

BEGIN TRAN;
CREATE TABLE dbo.CutClubMemberPass (
    TokenDigest BINARY(32) NOT NULL CONSTRAINT PK_CutClubMemberPass PRIMARY KEY,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    ClientID INT NOT NULL,
    IssuedByStaffUserID INT NOT NULL,
    IssuedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CutClubMemberPass_IssuedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt DATETIME2(3) NOT NULL,
    ConsumedAt DATETIME2(3) NULL,
    CONSTRAINT FK_CutClubMemberPass_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId)
);
CREATE INDEX IX_CutClubMemberPass_TenantClient
ON dbo.CutClubMemberPass(TenantId, ClientID, ExpiresAt DESC);

CREATE TABLE dbo.CutClubMemberSession (
    TokenDigest BINARY(32) NOT NULL CONSTRAINT PK_CutClubMemberSession PRIMARY KEY,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    ClientID INT NOT NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CutClubMemberSession_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt DATETIME2(3) NOT NULL,
    RevokedAt DATETIME2(3) NULL,
    CONSTRAINT FK_CutClubMemberSession_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId)
);
CREATE INDEX IX_CutClubMemberSession_TenantClient
ON dbo.CutClubMemberSession(TenantId, ClientID, ExpiresAt DESC);
COMMIT TRAN;
SELECT N'CUT_CLUB_MEMBER_SCHEMA_STAGING_READY' AS Result;
