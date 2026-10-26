/* DRVO Clinics treatment-plan orchestration.
   Requires 014-clinic-core. Booking owns appointments; encounter owns clinical completion.
   No competing appointment / invoice / treatment-payment tables. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.ClinicTreatmentPlan', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicTreatmentPlan (
      PlanId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ClinicTreatmentPlan_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      ClientID INT NOT NULL,
      PractitionerEmpID INT NOT NULL,
      LocationId UNIQUEIDENTIFIER NOT NULL,
      SourceEncounterId UNIQUEIDENTIFIER NOT NULL,
      Title NVARCHAR(180) NOT NULL,
      TotalSessions INT NOT NULL,
      CreatedByUserID INT NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicTreatmentPlan_Created DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicTreatmentPlan PRIMARY KEY (PlanId),
      CONSTRAINT UX_ClinicTreatmentPlan_Tenant_Id UNIQUE (TenantId, PlanId),
      CONSTRAINT FK_ClinicTreatmentPlan_Client FOREIGN KEY (TenantId, ClientID) REFERENCES dbo.TblClient(TenantId, ClientID),
      CONSTRAINT FK_ClinicTreatmentPlan_Doctor FOREIGN KEY (TenantId, PractitionerEmpID) REFERENCES dbo.TblEmp(TenantId, EmpID),
      CONSTRAINT FK_ClinicTreatmentPlan_Location FOREIGN KEY (TenantId, LocationId) REFERENCES dbo.Location(TenantId, LocationId),
      CONSTRAINT FK_ClinicTreatmentPlan_Encounter FOREIGN KEY (TenantId, SourceEncounterId) REFERENCES dbo.ClinicEncounter(TenantId, EncounterId),
      CONSTRAINT CK_ClinicTreatmentPlan_Total CHECK (TotalSessions BETWEEN 1 AND 50),
      CONSTRAINT CK_ClinicTreatmentPlan_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0)
    );
    CREATE UNIQUE INDEX UX_ClinicTreatmentPlan_Source_Title
      ON dbo.ClinicTreatmentPlan (TenantId, SourceEncounterId, Title);
    CREATE INDEX IX_ClinicTreatmentPlan_PatientDoctor
      ON dbo.ClinicTreatmentPlan (TenantId, ClientID, PractitionerEmpID, LocationId, CreatedAt DESC);
  END;
  IF OBJECT_ID(N'dbo.ClinicTreatmentSession', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicTreatmentSession (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PlanId UNIQUEIDENTIFIER NOT NULL,
      SessionNumber INT NOT NULL,
      BookingID INT NULL,
      LinkedByUserID INT NULL,
      LinkedAt DATETIME2 NULL,
      CONSTRAINT PK_ClinicTreatmentSession PRIMARY KEY (TenantId, PlanId, SessionNumber),
      CONSTRAINT FK_ClinicTreatmentSession_Plan FOREIGN KEY (TenantId, PlanId)
        REFERENCES dbo.ClinicTreatmentPlan(TenantId, PlanId),
      CONSTRAINT CK_ClinicTreatmentSession_Number CHECK (SessionNumber BETWEEN 1 AND 50),
      CONSTRAINT CK_ClinicTreatmentSession_Booking CHECK (BookingID IS NULL OR BookingID > 0)
    );
    -- Canonical Booking service owns the Booking row. This link must be single-use per tenant.
    CREATE UNIQUE INDEX UX_ClinicTreatmentSession_Tenant_Booking
      ON dbo.ClinicTreatmentSession (TenantId, BookingID) WHERE BookingID IS NOT NULL;
  END;
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
