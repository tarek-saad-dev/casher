-- Staging only. Applications are requests, never membership or financial grants.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52250,'APPLICATION_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipPublication',N'U') IS NULL OR COL_LENGTH(N'dbo.CutClubMemberAccount',N'AccessStatus') IS NULL THROW 52251,'APPLICATION_PREREQUISITES',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipApplication',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipApplication(
 TenantId UNIQUEIDENTIFIER NOT NULL,ApplicationID UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),AccountID UNIQUEIDENTIFIER NOT NULL,
 LegacyClientID INT NOT NULL,ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,PublicationRevision INT NOT NULL,BranchID INT NOT NULL,
 CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipApplication PRIMARY KEY(TenantId,ApplicationID),
 CONSTRAINT UX_CutClubMembershipApplication UNIQUE(TenantId,AccountID,ProgramCode,PublicationRevision),
 CONSTRAINT FK_CutClubMembershipApplication_Publication FOREIGN KEY(TenantId,ProgramCode,PublicationRevision) REFERENCES dbo.CutClubMembershipPublication(TenantId,ProgramCode,Revision),
 CONSTRAINT FK_CutClubMembershipApplication_Account FOREIGN KEY(AccountID) REFERENCES dbo.CutClubMemberAccount(AccountID),
 CONSTRAINT CK_CutClubMembershipApplication_Values CHECK(LegacyClientID>0 AND BranchID IN(1,3))
);
IF OBJECT_ID(N'dbo.CutClubMembershipApplicationDecision',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipApplicationDecision(
 TenantId UNIQUEIDENTIFIER NOT NULL,ApplicationID UNIQUEIDENTIFIER NOT NULL,Decision VARCHAR(24) NOT NULL,
 StaffID INT NOT NULL,Reason NVARCHAR(300) NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipApplicationDecision PRIMARY KEY(TenantId,ApplicationID),
 CONSTRAINT FK_CutClubMembershipApplicationDecision_Application FOREIGN KEY(TenantId,ApplicationID) REFERENCES dbo.CutClubMembershipApplication(TenantId,ApplicationID),
 CONSTRAINT CK_CutClubMembershipApplicationDecision CHECK(Decision IN('ACCEPTED_FOR_REVIEW','REJECTED') AND StaffID>0 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
