-- Nonfinancial staging draft only. No discount, coin or voucher writes.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52270,'BENEFIT_DRAFT_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipProgramDraft',N'U') IS NULL THROW 52271,'PROGRAM_DRAFT_REQUIRED',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitDraft',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipBenefitDraft(
 TenantId UNIQUEIDENTIFIER NOT NULL,ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,ProgramRevision INT NOT NULL,Revision INT NOT NULL,
 RulesJson NVARCHAR(MAX) NOT NULL,StaffID INT NOT NULL,Reason NVARCHAR(300) NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipBenefitDraft PRIMARY KEY(TenantId,ProgramCode,ProgramRevision,Revision),
 CONSTRAINT FK_CutClubMembershipBenefitDraft_Program FOREIGN KEY(TenantId,ProgramCode,ProgramRevision) REFERENCES dbo.CutClubMembershipProgramDraft(TenantId,ProgramCode,Revision),
 CONSTRAINT CK_CutClubMembershipBenefitDraft_Values CHECK(Revision>0 AND StaffID>0 AND ISJSON(RulesJson)=1 AND DATALENGTH(RulesJson)<=32768 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
