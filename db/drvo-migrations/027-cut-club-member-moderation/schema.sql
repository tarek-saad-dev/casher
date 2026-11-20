/*
 * DRVO-027 CUT CLUB access moderation and safe auto-link approval metadata.
 * No customer balances, vouchers, invoices, or ledger entries are changed.
 * Production: immutable-migration control plane only, after an approved PLAN and backup.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'last132',N'last132_agent')
  THROW 51250, 'CUT_CLUB_MEMBER_MODERATION_UNEXPECTED_DATABASE', 1;
IF OBJECT_ID(N'dbo.CutClubMemberAccount',N'U') IS NULL
  THROW 51251, 'CUT_CLUB_MEMBER_MODERATION_REQUIRES_026', 1;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.CutClubMemberAccount','AccessStatus') IS NULL
BEGIN
  ALTER TABLE dbo.CutClubMemberAccount ADD
    AccessStatus VARCHAR(16) NOT NULL CONSTRAINT DF_CutClubMemberAccount_AccessStatus DEFAULT 'ENABLED';
END;
IF COL_LENGTH('dbo.CutClubMemberAccount','AccessUpdatedAtUtc') IS NULL
  ALTER TABLE dbo.CutClubMemberAccount ADD AccessUpdatedAtUtc DATETIME2(3) NULL;
IF COL_LENGTH('dbo.CutClubMemberAccount','AccessUpdatedBy') IS NULL
  ALTER TABLE dbo.CutClubMemberAccount ADD AccessUpdatedBy INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CK_CutClubMemberAccount_AccessStatus' AND parent_object_id=OBJECT_ID(N'dbo.CutClubMemberAccount'))
  ALTER TABLE dbo.CutClubMemberAccount WITH CHECK ADD CONSTRAINT CK_CutClubMemberAccount_AccessStatus
    CHECK (AccessStatus IN ('ENABLED','SUSPENDED'));
-- The prior approval rule permits only staff-linked balances. A uniquely matched
-- OTP can be linked by explicit operator policy without fabricating a staff ID.
-- Keep the proof tag so audit can distinguish manual from automated linking.
ALTER TABLE dbo.CutClubMemberAccount DROP CONSTRAINT CK_CutClubMemberAccount_Approved;
ALTER TABLE dbo.CutClubMemberAccount WITH CHECK ADD CONSTRAINT CK_CutClubMemberAccount_Approved CHECK
  (LinkStatus <> 'ACTIVE' OR
    (LegacyClientID IS NOT NULL AND LinkApprovedAtUtc IS NOT NULL AND
      ((LinkApprovedBy IS NOT NULL AND LinkProofType='IN_PERSON_ID') OR
       (LinkApprovedBy IS NULL AND LinkProofType='VERIFIED_PHONE_UNIQUE'))));
IF OBJECT_ID(N'dbo.CutClubMemberAccessAudit',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubMemberAccessAudit(
    AuditID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CutClubMemberAccessAudit PRIMARY KEY,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    AccountID UNIQUEIDENTIFIER NOT NULL,
    StaffUserID INT NOT NULL,
    Action VARCHAR(24) NOT NULL,
    Reason NVARCHAR(300) NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_CutClubMemberAccessAudit_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_CutClubMemberAccessAudit_Account FOREIGN KEY(AccountID) REFERENCES dbo.CutClubMemberAccount(AccountID),
    CONSTRAINT CK_CutClubMemberAccessAudit_Action CHECK(Action IN ('SUSPEND','RESUME'))
  );
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutClubMemberAccessAudit') AND name=N'IX_CutClubMemberAccessAudit_TenantAccount')
  CREATE INDEX IX_CutClubMemberAccessAudit_TenantAccount
    ON dbo.CutClubMemberAccessAudit(TenantId,AccountID,CreatedAtUtc DESC);
COMMIT TRANSACTION;
