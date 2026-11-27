-- Staging-only approval history. No invoice, point or voucher mutation.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52280,'BENEFIT_APPROVAL_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitDraft',N'U') IS NULL OR OBJECT_ID(N'dbo.CutClubMembershipPublication',N'U') IS NULL THROW 52281,'BENEFIT_APPROVAL_PREREQUISITES',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitApproval',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipBenefitApproval(
 TenantId UNIQUEIDENTIFIER NOT NULL,ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,Revision INT NOT NULL,
 ProgramRevision INT NOT NULL,PublicationRevision INT NOT NULL,BenefitRevision INT NOT NULL,Action VARCHAR(16) NOT NULL,
 CatalogJson NVARCHAR(MAX) NOT NULL,StaffID INT NOT NULL,Reason NVARCHAR(300) NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipBenefitApproval PRIMARY KEY(TenantId,ProgramCode,Revision),
 CONSTRAINT FK_CutClubBenefitApproval_Draft FOREIGN KEY(TenantId,ProgramCode,ProgramRevision,BenefitRevision) REFERENCES dbo.CutClubMembershipBenefitDraft(TenantId,ProgramCode,ProgramRevision,Revision),
 CONSTRAINT FK_CutClubBenefitApproval_Publication FOREIGN KEY(TenantId,ProgramCode,PublicationRevision) REFERENCES dbo.CutClubMembershipPublication(TenantId,ProgramCode,Revision),
 CONSTRAINT CK_CutClubBenefitApproval_Values CHECK(Action IN('APPROVE','REVOKE') AND Revision>0 AND StaffID>0 AND ISJSON(CatalogJson)=1 AND DATALENGTH(CatalogJson)<=32768 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
