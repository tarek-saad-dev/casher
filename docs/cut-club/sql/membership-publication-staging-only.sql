-- Staging-only publication of nonfinancial membership program information.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52240,'MEMBERSHIP_PUBLICATION_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipProgramDraft',N'U') IS NULL THROW 52241,'MEMBERSHIP_DRAFT_REQUIRED',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipPublication',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipPublication(
 TenantId UNIQUEIDENTIFIER NOT NULL,ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
 Revision INT NOT NULL,ProgramRevision INT NOT NULL,Action VARCHAR(16) NOT NULL,StaffID INT NOT NULL,
 Reason NVARCHAR(300) NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipPublication PRIMARY KEY(TenantId,ProgramCode,Revision),
 CONSTRAINT FK_CutClubMembershipPublication_Draft FOREIGN KEY(TenantId,ProgramCode,ProgramRevision) REFERENCES dbo.CutClubMembershipProgramDraft(TenantId,ProgramCode,Revision),
 CONSTRAINT CK_CutClubMembershipPublication_Action CHECK(Action IN('PUBLISH','WITHDRAW') AND Revision>0 AND StaffID>0 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
