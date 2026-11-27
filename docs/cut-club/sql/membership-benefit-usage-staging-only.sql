-- Nonfinancial staging ledger. SimulationReceiptID is NOT a real invoice ID.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent' THROW 52290,'BENEFIT_USAGE_STAGE_ONLY',1;
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitApproval',N'U') IS NULL OR OBJECT_ID(N'dbo.CutClubMembershipApplicationFulfillment',N'U') IS NULL THROW 52291,'BENEFIT_USAGE_PREREQUISITES',1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitUsage',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipBenefitUsage(
 TenantId UNIQUEIDENTIFIER NOT NULL,SimulationReceiptID UNIQUEIDENTIFIER NOT NULL,AccountID UNIQUEIDENTIFIER NOT NULL,
 ProgramCode VARCHAR(40) COLLATE Latin1_General_100_BIN2 NOT NULL,TrialRevision INT NOT NULL,ApprovalRevision INT NOT NULL,
 LegacyClientID INT NOT NULL,ServiceID INT NOT NULL,BranchID INT NOT NULL,Units INT NOT NULL,
 OriginalMinor BIGINT NOT NULL,DiscountMinor BIGINT NOT NULL,FinalMinor BIGINT NOT NULL,BonusCoins INT NOT NULL,
 StaffID INT NOT NULL,CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubBenefitUsage PRIMARY KEY(TenantId,SimulationReceiptID),
 CONSTRAINT FK_CutClubBenefitUsage_Trial FOREIGN KEY(TenantId,AccountID,ProgramCode,TrialRevision) REFERENCES dbo.CutClubMembershipTrial(TenantId,AccountID,ProgramCode,Revision),
 CONSTRAINT FK_CutClubBenefitUsage_Approval FOREIGN KEY(TenantId,ProgramCode,ApprovalRevision) REFERENCES dbo.CutClubMembershipBenefitApproval(TenantId,ProgramCode,Revision),
 CONSTRAINT CK_CutClubBenefitUsage CHECK(TrialRevision>0 AND ApprovalRevision>0 AND LegacyClientID>0 AND ServiceID>0 AND BranchID IN(1,3) AND Units BETWEEN 1 AND 100 AND OriginalMinor>0 AND DiscountMinor>=0 AND FinalMinor>=0 AND OriginalMinor=DiscountMinor+FinalMinor AND BonusCoins>=0 AND StaffID>0)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubMembershipBenefitUsage') AND name=N'IX_CutClubBenefitUsage_Membership')
 CREATE INDEX IX_CutClubBenefitUsage_Membership ON dbo.CutClubMembershipBenefitUsage(TenantId,AccountID,ProgramCode,TrialRevision,ServiceID) INCLUDE(Units,SimulationReceiptID);
IF OBJECT_ID(N'dbo.CutClubMembershipBenefitUsageReversal',N'U') IS NULL
CREATE TABLE dbo.CutClubMembershipBenefitUsageReversal(
 TenantId UNIQUEIDENTIFIER NOT NULL,SimulationReceiptID UNIQUEIDENTIFIER NOT NULL,StaffID INT NOT NULL,Reason NVARCHAR(300) NOT NULL,
 CreatedAtUtc DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CutClubBenefitUsageReversal PRIMARY KEY(TenantId,SimulationReceiptID),
 CONSTRAINT FK_CutClubBenefitUsageReversal_Usage FOREIGN KEY(TenantId,SimulationReceiptID) REFERENCES dbo.CutClubMembershipBenefitUsage(TenantId,SimulationReceiptID),
 CONSTRAINT CK_CutClubBenefitUsageReversal CHECK(StaffID>0 AND LEN(Reason) BETWEEN 5 AND 300)
);
COMMIT TRANSACTION;
