-- Staging-only invoice reconciliation evidence, NOT financial entitlement or usage.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52300,'INVOICE_EVIDENCE_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitApproval',N'U') IS NULL OR OBJECT_ID(N'dbo.CutClubMembershipTrial',N'U') IS NULL THROW 52301,'INVOICE_EVIDENCE_PREREQUISITES',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipInvoiceEvidence',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipInvoiceEvidence(
 TenantId UNIQUEIDENTIFIER NOT NULL,InvoiceID INT NOT NULL,AccountID UNIQUEIDENTIFIER NOT NULL,ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
 TrialRevision INT NOT NULL,ApprovalRevision INT NOT NULL,ClientID INT NOT NULL,BranchID INT NOT NULL,BusinessDayID INT NOT NULL,ShiftMoveID INT NOT NULL,
 ServiceID INT NOT NULL,Units INT NOT NULL,LineGrossMinor BIGINT NOT NULL,LineDiscountMinor BIGINT NOT NULL,LineNetMinor BIGINT NOT NULL,
 InvoiceGrossMinor BIGINT NOT NULL,InvoiceNetMinor BIGINT NOT NULL,StaffID INT NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipInvoiceEvidence PRIMARY KEY(TenantId,InvoiceID),
 CONSTRAINT FK_CutClubInvoiceEvidence_Trial FOREIGN KEY(TenantId,AccountID,ProgramCode,TrialRevision) REFERENCES dbo.CutClubMembershipTrial(TenantId,AccountID,ProgramCode,Revision),
 CONSTRAINT FK_CutClubInvoiceEvidence_Approval FOREIGN KEY(TenantId,ProgramCode,ApprovalRevision) REFERENCES dbo.CutClubMembershipBenefitApproval(TenantId,ProgramCode,Revision),
 CONSTRAINT CK_CutClubInvoiceEvidence CHECK(InvoiceID>0 AND ClientID>0 AND BranchID IN(1,3) AND BusinessDayID>0 AND ShiftMoveID>0 AND ServiceID>0 AND StaffID>0 AND Units BETWEEN 1 AND 100 AND LineGrossMinor>0 AND LineDiscountMinor>0 AND LineNetMinor>=0 AND LineGrossMinor=LineDiscountMinor+LineNetMinor AND InvoiceGrossMinor>=LineGrossMinor AND InvoiceNetMinor>0 AND InvoiceNetMinor=InvoiceGrossMinor-LineDiscountMinor)
);
IF OBJECT_ID(N'dbo.CutClubMembershipInvoiceEvidenceVoid',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipInvoiceEvidenceVoid(
 TenantId UNIQUEIDENTIFIER NOT NULL,InvoiceID INT NOT NULL,StaffID INT NOT NULL,Reason NVARCHAR(300) NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubMembershipInvoiceEvidenceVoid PRIMARY KEY(TenantId,InvoiceID),
 CONSTRAINT FK_CutClubInvoiceEvidenceVoid FOREIGN KEY(TenantId,InvoiceID) REFERENCES dbo.CutClubMembershipInvoiceEvidence(TenantId,InvoiceID),
 CONSTRAINT CK_CutClubInvoiceEvidenceVoid CHECK(StaffID>0 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
