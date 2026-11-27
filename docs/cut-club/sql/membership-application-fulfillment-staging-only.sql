-- Staging only: immutable link from accepted request to exactly one non-financial trial.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52260,'APPLICATION_FULFILLMENT_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipApplication',N'U') IS NULL OR OBJECT_ID(N'dbo.CutClubMembershipTrial',N'U') IS NULL THROW 52261,'APPLICATION_FULFILLMENT_PREREQUISITES',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipApplicationFulfillment',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipApplicationFulfillment(
 TenantId UNIQUEIDENTIFIER NOT NULL,ApplicationID UNIQUEIDENTIFIER NOT NULL,AccountID UNIQUEIDENTIFIER NOT NULL,
 ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,TrialRevision INT NOT NULL,
 CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipApplicationFulfillment PRIMARY KEY(TenantId,ApplicationID),
 CONSTRAINT UX_CutClubMembershipApplicationFulfillment_Trial UNIQUE(TenantId,AccountID,ProgramCode,TrialRevision),
 CONSTRAINT FK_CutClubMembershipApplicationFulfillment_App FOREIGN KEY(TenantId,ApplicationID) REFERENCES dbo.CutClubMembershipApplication(TenantId,ApplicationID),
 CONSTRAINT FK_CutClubMembershipApplicationFulfillment_Trial FOREIGN KEY(TenantId,AccountID,ProgramCode,TrialRevision) REFERENCES dbo.CutClubMembershipTrial(TenantId,AccountID,ProgramCode,Revision)
);
COMMIT TRANSACTION;
