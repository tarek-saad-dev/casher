-- Staging only. Requires 026/027 member account schema. No membership or financial grants.
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent'
 THROW 52220,'MEMBERSHIP_PROOF_STAGE_ONLY',1;
IF COL_LENGTH(N'dbo.CutClubMemberAccount',N'AccessStatus') IS NULL
 OR COL_LENGTH(N'dbo.TblClient',N'TenantId') IS NULL
 THROW 52221,'MEMBER_MODERATION_REQUIRED',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipProofEvent',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.CutClubMembershipProofEvent(
  TenantId UNIQUEIDENTIFIER NOT NULL,
  AccountID UNIQUEIDENTIFIER NOT NULL,
  Kind VARCHAR(16) NOT NULL,
  Revision INT NOT NULL,
  Action VARCHAR(16) NOT NULL,
  LegacyClientID INT NOT NULL,
  PartnerCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NULL,
  ExpiresAtUtc DATETIME2(3) NULL,
  StaffID INT NOT NULL,
  Reason NVARCHAR(300) NOT NULL,
  CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_CutClubProof_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CutClubMembershipProofEvent PRIMARY KEY(TenantId,AccountID,Kind,Revision),
  CONSTRAINT FK_CutClubProof_Tenant FOREIGN KEY(TenantId) REFERENCES dbo.Tenant(TenantId),
  CONSTRAINT FK_CutClubProof_Account FOREIGN KEY(AccountID) REFERENCES dbo.CutClubMemberAccount(AccountID),
  CONSTRAINT CK_CutClubProof_Kind CHECK(Kind IN ('STUDENT','DOCTOR','COMPANY')),
  CONSTRAINT CK_CutClubProof_Action CHECK((Action='APPROVE' AND ExpiresAtUtc IS NOT NULL) OR (Action='REVOKE' AND ExpiresAtUtc IS NULL AND PartnerCode IS NULL)),
  CONSTRAINT CK_CutClubProof_Values CHECK(Revision>0 AND LegacyClientID>0 AND StaffID>0 AND LEN(Reason) BETWEEN 5 AND 300)
 );
END;
COMMIT TRANSACTION;
