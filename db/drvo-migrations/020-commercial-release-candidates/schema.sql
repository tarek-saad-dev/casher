/*
 DRVO 020 — Commercial release preparation, NOT an approved catalog.
 Immutable reviewed-research source digest. No customer quotes, prices, orders, invoices,
 payments, subscription updates, feature grants, or automatic sale approval.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRAN;
 IF OBJECT_ID(N'dbo.ModularCommercialReleaseCandidate',N'U') IS NULL
 BEGIN
   CREATE TABLE dbo.ModularCommercialReleaseCandidate (
     CandidateId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ModularCommercialReleaseCandidate_Id DEFAULT NEWSEQUENTIALID(),
     SourceProposalId UNIQUEIDENTIFIER NOT NULL,
     SourceVersion INT NOT NULL,
     IndustryCode NVARCHAR(32) NOT NULL,
     SourceDigest CHAR(64) NOT NULL,
     Status NVARCHAR(24) NOT NULL CONSTRAINT DF_ModularCommercialReleaseCandidate_Status DEFAULT N'pending_policy',
     RequestedByUserId INT NOT NULL,
     CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ModularCommercialReleaseCandidate_Created DEFAULT SYSUTCDATETIME(),
     CONSTRAINT PK_ModularCommercialReleaseCandidate PRIMARY KEY(CandidateId),
     CONSTRAINT FK_ModularCommercialReleaseCandidate_Source FOREIGN KEY(SourceProposalId)
       REFERENCES dbo.ModularTariffResearchProposal(ProposalId),
     CONSTRAINT UX_ModularCommercialReleaseCandidate_Source UNIQUE(SourceProposalId),
     CONSTRAINT CK_ModularCommercialReleaseCandidate_Version CHECK(SourceVersion>=1),
     CONSTRAINT CK_ModularCommercialReleaseCandidate_Status CHECK(Status=N'pending_policy'),
     CONSTRAINT CK_ModularCommercialReleaseCandidate_Digest CHECK
       (LEN(SourceDigest)=64 AND SourceDigest NOT LIKE '%[^a-f0-9]%' COLLATE Latin1_General_BIN2)
   );
   CREATE INDEX IX_ModularCommercialReleaseCandidate_Industry
     ON dbo.ModularCommercialReleaseCandidate(IndustryCode,CreatedAt DESC);
 END;
 COMMIT TRAN;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRAN;
 THROW;
END CATCH;
