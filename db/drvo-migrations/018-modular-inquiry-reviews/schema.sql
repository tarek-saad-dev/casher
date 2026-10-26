/*
 * DRVO-018 operator review for nonpayable modular quote inquiries.
 * Additive schema only: no existing request, subscription, invoice or app state updated.
 * A review outcome is NOT pricing approval, order acceptance or payment evidence.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID(N'dbo.TenantModularQuoteRequest')
      AND name=N'UX_TenantModularQuoteRequest_TenantRequest'
  )
    CREATE UNIQUE INDEX UX_TenantModularQuoteRequest_TenantRequest
      ON dbo.TenantModularQuoteRequest(TenantId,RequestId);

  IF OBJECT_ID(N'dbo.TenantModularInquiryReview',N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantModularInquiryReview (
      ReviewId UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_TenantModularInquiryReview_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      RequestId UNIQUEIDENTIFIER NOT NULL,
      Outcome NVARCHAR(32) NOT NULL,
      Note NVARCHAR(500) NOT NULL,
      ReviewedByUserId INT NOT NULL,
      ReviewedAt DATETIME2 NOT NULL
        CONSTRAINT DF_TenantModularInquiryReview_Reviewed DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantModularInquiryReview PRIMARY KEY (ReviewId),
      CONSTRAINT UX_TenantModularInquiryReview_Request UNIQUE (RequestId),
      CONSTRAINT FK_TenantModularInquiryReview_TenantRequest
        FOREIGN KEY (TenantId,RequestId)
        REFERENCES dbo.TenantModularQuoteRequest(TenantId,RequestId),
      CONSTRAINT CK_TenantModularInquiryReview_Outcome CHECK
        (Outcome IN (N'follow_up_recorded',N'not_applicable',N'duplicate')),
      CONSTRAINT CK_TenantModularInquiryReview_Note CHECK
        (LEN(LTRIM(RTRIM(Note))) BETWEEN 1 AND 500)
    );
    CREATE INDEX IX_TenantModularInquiryReview_TenantTime
      ON dbo.TenantModularInquiryReview(TenantId,ReviewedAt DESC);
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRAN;
  THROW;
END CATCH;
