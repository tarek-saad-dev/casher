/*
 * DRVO-022: persisted, immutable INTERNAL research quote snapshots.
 * These are NOT customer quotes, orders, invoices, prices approved for sale or payments.
 * Snapshots expire for operator-use after 48h but remain immutable for audit.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.ModularInternalQuoteSnapshot',N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ModularInternalQuoteSnapshot (
      SnapshotId UNIQUEIDENTIFIER NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      RequestId UNIQUEIDENTIFIER NOT NULL,
      CandidateId UNIQUEIDENTIFIER NOT NULL,
      ResearchVersion INT NOT NULL,
      DraftRevision INT NOT NULL,
      SourceDigest CHAR(64) NOT NULL,
      QuoteDigest CHAR(64) NOT NULL,
      ResearchQuoteJson NVARCHAR(MAX) NOT NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ModularInternalQuoteSnapshot_Status DEFAULT N'internal_only',
      CreatedByUserId INT NOT NULL,
      CreatedAt DATETIME2(3) NOT NULL,
      ExpiresAt DATETIME2(3) NOT NULL,
      CONSTRAINT PK_ModularInternalQuoteSnapshot PRIMARY KEY (SnapshotId),
      CONSTRAINT UX_ModularInternalQuoteSnapshot_Source UNIQUE (TenantId,RequestId,CandidateId),
      CONSTRAINT FK_ModularInternalQuoteSnapshot_TenantRequest FOREIGN KEY (TenantId,RequestId)
        REFERENCES dbo.TenantModularQuoteRequest(TenantId,RequestId),
      CONSTRAINT FK_ModularInternalQuoteSnapshot_Candidate FOREIGN KEY (CandidateId)
        REFERENCES dbo.ModularCommercialReleaseCandidate(CandidateId),
      CONSTRAINT CK_ModularInternalQuoteSnapshot_Versions CHECK (ResearchVersion>=1 AND DraftRevision>=1),
      CONSTRAINT CK_ModularInternalQuoteSnapshot_Digests CHECK (
        LEN(SourceDigest)=64 AND SourceDigest COLLATE Latin1_General_BIN2 NOT LIKE '%[^a-f0-9]%'
        AND LEN(QuoteDigest)=64 AND QuoteDigest COLLATE Latin1_General_BIN2 NOT LIKE '%[^a-f0-9]%'
      ),
      CONSTRAINT CK_ModularInternalQuoteSnapshot_Json CHECK (ISJSON(ResearchQuoteJson)=1),
      CONSTRAINT CK_ModularInternalQuoteSnapshot_Status CHECK (Status=N'internal_only'),
      CONSTRAINT CK_ModularInternalQuoteSnapshot_Expiry CHECK (
        ExpiresAt>CreatedAt AND ExpiresAt<=DATEADD(HOUR,48,CreatedAt)
      )
    );
    CREATE INDEX IX_ModularInternalQuoteSnapshot_Operator
      ON dbo.ModularInternalQuoteSnapshot(CreatedAt DESC,SnapshotId DESC);
    CREATE INDEX IX_ModularInternalQuoteSnapshot_Tenant
      ON dbo.ModularInternalQuoteSnapshot(TenantId,CreatedAt DESC);
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRAN;
  THROW;
END CATCH;
