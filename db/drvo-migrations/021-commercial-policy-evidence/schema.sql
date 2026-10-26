/*
 DRVO 021 — Auditable operator commercial policy evidence.
 Internal review is not a commercial approval or an authorization to publish.
 Additive isolated evidence table. No prices, catalog, tenants or payments mutated.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRAN;
 IF OBJECT_ID(N'dbo.ModularCommercialPolicyEvidence',N'U') IS NULL
 BEGIN
   CREATE TABLE dbo.ModularCommercialPolicyEvidence (
     EvidenceId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ModularCommercialPolicyEvidence_Id DEFAULT NEWSEQUENTIALID(),
     CandidateId UNIQUEIDENTIFIER NOT NULL,
     BlockerCode NVARCHAR(64) NOT NULL,
     Revision INT NOT NULL,
     EvidenceText NVARCHAR(1000) NOT NULL,
     Status NVARCHAR(24) NOT NULL CONSTRAINT DF_ModularCommercialPolicyEvidence_Status DEFAULT N'submitted',
     SubmittedByUserId INT NOT NULL,
     SubmittedAt DATETIME2 NOT NULL CONSTRAINT DF_ModularCommercialPolicyEvidence_Submitted DEFAULT SYSUTCDATETIME(),
     ReviewedByUserId INT NULL,
     ReviewedAt DATETIME2 NULL,
     ReviewNote NVARCHAR(500) NULL,
     CONSTRAINT PK_ModularCommercialPolicyEvidence PRIMARY KEY(EvidenceId),
     CONSTRAINT FK_ModularCommercialPolicyEvidence_Candidate FOREIGN KEY(CandidateId)
       REFERENCES dbo.ModularCommercialReleaseCandidate(CandidateId),
     CONSTRAINT UX_ModularCommercialPolicyEvidence_Revision UNIQUE(CandidateId,BlockerCode,Revision),
     CONSTRAINT CK_ModularCommercialPolicyEvidence_Revision CHECK(Revision>=1),
     CONSTRAINT CK_ModularCommercialPolicyEvidence_Status CHECK
       (Status IN (N'submitted',N'reviewed_internal',N'changes_requested')),
     CONSTRAINT CK_ModularCommercialPolicyEvidence_Code CHECK
       (BlockerCode IN (
         N'COMMERCIAL_PRICING_NOT_APPROVED',
         N'BILLING_UNIT_NOT_APPROVED',
         N'BRANCH_QUOTAS_NOT_APPROVED',
         N'ANNUAL_TERMS_NOT_APPROVED',
         N'TAXES_AND_INVOICE_RULES_NOT_APPROVED',
         N'REFUND_PRORATION_NOT_APPROVED',
         N'TRIAL_FREE_AND_USAGE_LIMITS_NOT_APPROVED',
         N'LEGAL_CONTRACT_NOT_APPROVED',
         N'GATEWAY_SETTLEMENT_NOT_VERIFIED',
         N'STAGING_END_TO_END_NOT_VERIFIED'
       )),
     CONSTRAINT CK_ModularCommercialPolicyEvidence_EvidenceText CHECK
       (LEN(LTRIM(RTRIM(EvidenceText))) BETWEEN 1 AND 1000),
     CONSTRAINT CK_ModularCommercialPolicyEvidence_Review CHECK (
       (Status=N'submitted' AND ReviewedByUserId IS NULL AND ReviewedAt IS NULL AND ReviewNote IS NULL)
       OR (Status<>N'submitted' AND ReviewedByUserId IS NOT NULL AND ReviewedAt IS NOT NULL
         AND ReviewNote IS NOT NULL AND LEN(LTRIM(RTRIM(ReviewNote))) BETWEEN 1 AND 500
         AND SubmittedByUserId<>ReviewedByUserId)
     )
   );
   CREATE INDEX IX_ModularCommercialPolicyEvidence_CandidateTime
     ON dbo.ModularCommercialPolicyEvidence(CandidateId,SubmittedAt DESC);
 END;
 COMMIT TRAN;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRAN;
 THROW;
END CATCH;
