-- Staging-only membership trial issuance. No financial rights.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52230,'MEMBERSHIP_TRIAL_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipProgramDraft',N'U') IS NULL OR OBJECT_ID(N'dbo.CutClubMembershipProofEvent',N'U') IS NULL THROW 52231,'MEMBERSHIP_PREREQUISITES',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipTrial',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipTrial(
 TenantId UNIQUEIDENTIFIER NOT NULL,AccountID UNIQUEIDENTIFIER NOT NULL,ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
 Revision INT NOT NULL,ProgramRevision INT NOT NULL,LegacyClientID INT NOT NULL,BranchID INT NOT NULL,
 ProofRevision INT NULL,ExpiresAtUtc DATETIME2(3) NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 StaffID INT NOT NULL,Reason NVARCHAR(300) NOT NULL,
 CONSTRAINT PK_CutClubMembershipTrial PRIMARY KEY(TenantId,AccountID,ProgramCode,Revision),
 CONSTRAINT FK_CutClubMembershipTrial_Program FOREIGN KEY(TenantId,ProgramCode,ProgramRevision) REFERENCES dbo.CutClubMembershipProgramDraft(TenantId,ProgramCode,Revision),
 CONSTRAINT FK_CutClubMembershipTrial_Account FOREIGN KEY(AccountID) REFERENCES dbo.CutClubMemberAccount(AccountID),
 CONSTRAINT CK_CutClubMembershipTrial_Values CHECK(Revision>0 AND LegacyClientID>0 AND BranchID IN(1,3) AND StaffID>0 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
