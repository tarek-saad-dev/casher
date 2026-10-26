/* DRVO Clinics billing handoff: one immutable initial POS sale per completed encounter.
   Apply after migration 014. This migration intentionally does NOT alter POS tables. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.ClinicEncounterBillingLink', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicEncounterBillingLink (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      EncounterId UNIQUEIDENTIFIER NOT NULL,
      BranchID INT NOT NULL,
      InvID INT NOT NULL,
      InvType NVARCHAR(20) NOT NULL CONSTRAINT DF_ClinicBilling_InvType DEFAULT N'مبيعات',
      CreatedByUserID INT NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicBilling_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicEncounterBillingLink PRIMARY KEY (TenantId, EncounterId),
      CONSTRAINT FK_ClinicEncounterBillingLink_Encounter FOREIGN KEY (EncounterId)
        REFERENCES dbo.ClinicEncounter (EncounterId),
      CONSTRAINT CK_ClinicEncounterBillingLink_SaleType CHECK (InvType = N'مبيعات'),
      CONSTRAINT CK_ClinicEncounterBillingLink_Invoice CHECK (InvID > 0)
    );
    CREATE UNIQUE INDEX UX_ClinicEncounterBillingLink_Invoice
      ON dbo.ClinicEncounterBillingLink (TenantId, InvType, InvID);
  END;
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
