/*
  DRVO-019: Internal tariff RESEARCH proposals, not approved customer price catalogs.
  Immutable snapshots + two-person research review; no billable state.
  Existing ModularPriceCatalog/Item, subscription, installed apps and invoice untouched.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.ModularTariffResearchProposal',N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ModularTariffResearchProposal (
      ProposalId UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_ModularTariffResearchProposal_Id DEFAULT NEWSEQUENTIALID(),
      IndustryCode NVARCHAR(32) NOT NULL,
      Version INT NOT NULL,
      PricingModel NVARCHAR(20) NOT NULL,
      CurrencyCode CHAR(3) NOT NULL CONSTRAINT DF_ModularTariffResearchProposal_Currency DEFAULT 'EGP',
      AppPricesJson NVARCHAR(MAX) NOT NULL,
      BaseMonthlyMinor BIGINT NOT NULL,
      ExtraBranchMonthlyMinor BIGINT NOT NULL,
      IncludedBranches INT NOT NULL,
      AnnualMonthsCharged INT NOT NULL,
      Status NVARCHAR(24) NOT NULL
        CONSTRAINT DF_ModularTariffResearchProposal_Status DEFAULT N'submitted',
      CreatedByUserId INT NOT NULL,
      CreatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_ModularTariffResearchProposal_Created DEFAULT SYSUTCDATETIME(),
      ReviewedByUserId INT NULL,
      ReviewedAt DATETIME2 NULL,
      ReviewNote NVARCHAR(500) NULL,
      CONSTRAINT PK_ModularTariffResearchProposal PRIMARY KEY (ProposalId),
      CONSTRAINT UX_ModularTariffResearchProposal_IndustryVersion UNIQUE (IndustryCode,Version),
      CONSTRAINT CK_ModularTariffResearchProposal_Version CHECK (Version >= 1),
      CONSTRAINT CK_ModularTariffResearchProposal_Model CHECK
        (PricingModel IN (N'per_app',N'base_plus_apps')),
      CONSTRAINT CK_ModularTariffResearchProposal_Currency CHECK (CurrencyCode='EGP'),
      CONSTRAINT CK_ModularTariffResearchProposal_Json CHECK (ISJSON(AppPricesJson)=1),
      CONSTRAINT CK_ModularTariffResearchProposal_Money CHECK
        (BaseMonthlyMinor>=0 AND ExtraBranchMonthlyMinor>=0),
      CONSTRAINT CK_ModularTariffResearchProposal_Branches CHECK
        (IncludedBranches>=1 AND IncludedBranches<=20),
      CONSTRAINT CK_ModularTariffResearchProposal_Annual CHECK
        (AnnualMonthsCharged>=1 AND AnnualMonthsCharged<=12),
      CONSTRAINT CK_ModularTariffResearchProposal_Status CHECK
        (Status IN (N'submitted',N'reviewed_research',N'changes_requested')),
      CONSTRAINT CK_ModularTariffResearchProposal_Review CHECK (
        (Status=N'submitted' AND ReviewedByUserId IS NULL AND ReviewedAt IS NULL AND ReviewNote IS NULL)
        OR
        (Status<>N'submitted' AND ReviewedByUserId IS NOT NULL AND ReviewedAt IS NOT NULL
         AND ReviewNote IS NOT NULL AND LEN(LTRIM(RTRIM(ReviewNote))) BETWEEN 1 AND 500
         AND ReviewedByUserId<>CreatedByUserId)
      )
    );
    CREATE INDEX IX_ModularTariffResearchProposal_Queue
      ON dbo.ModularTariffResearchProposal(Status,CreatedAt ASC);
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRAN;
  THROW;
END CATCH;
