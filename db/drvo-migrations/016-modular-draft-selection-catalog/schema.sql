/*
  DRVO Modular Draft Selection Catalog V1.
  Insert-only EMPTY, non-payable DRAFT catalog pointers, no prices and no entitlements.
  These are internal references required by TenantModularDraft.CatalogId FK.
  Does NOT edit any existing tenant, subscription, installed app, or offer.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF NOT EXISTS (
    SELECT 1 FROM dbo.ModularPriceCatalog WITH (UPDLOCK, HOLDLOCK)
    WHERE CatalogCode=N'salon-selection-draft' AND Version=1
  )
    INSERT INTO dbo.ModularPriceCatalog (CatalogCode, Version, IndustryCode, CurrencyCode, Status)
    VALUES (N'salon-selection-draft', 1, N'salon', 'EGP', N'draft');

  IF NOT EXISTS (
    SELECT 1 FROM dbo.ModularPriceCatalog WITH (UPDLOCK, HOLDLOCK)
    WHERE CatalogCode=N'supermarket-selection-draft' AND Version=1
  )
    INSERT INTO dbo.ModularPriceCatalog (CatalogCode, Version, IndustryCode, CurrencyCode, Status)
    VALUES (N'supermarket-selection-draft', 1, N'supermarket', 'EGP', N'draft');
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRAN;
  THROW;
END CATCH;
