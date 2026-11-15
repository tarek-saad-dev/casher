-- Record explicit staff-confirmed customer permission for WhatsApp offers,
-- tied to the exact phone supplied. Does not opt in historical clients.
IF COL_LENGTH(N'dbo.TblClient', N'OffersConsentPhone') IS NULL
BEGIN
  ALTER TABLE dbo.TblClient ADD OffersConsentPhone NVARCHAR(30) NULL;
END;
GO
IF COL_LENGTH(N'dbo.TblClient', N'OffersConsentedAtUtc') IS NULL
BEGIN
  ALTER TABLE dbo.TblClient ADD OffersConsentedAtUtc DATETIME2(3) NULL;
END;
GO
IF COL_LENGTH(N'dbo.TblClient', N'OffersConsentEvidence') IS NULL
BEGIN
  ALTER TABLE dbo.TblClient ADD OffersConsentEvidence NVARCHAR(120) NULL;
END;
GO
-- Intentional: NO existing rows updated, and an existing mobile number
-- does not provide a marketing opt-in. Customer can opt out at any time.
