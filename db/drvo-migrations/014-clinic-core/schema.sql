/*
  DRVO Clinics MVP core.

  Shared source of truth:
    TblClient = patient identity
    TblEmp = practitioner identity
    Booking app = appointments
    POS/Treasury = billing and payments
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF NOT EXISTS (SELECT 1 FROM dbo.AppRegistry WHERE AppCode = N'medical-records')
    INSERT INTO dbo.AppRegistry (AppCode, DisplayName, EntitledSeparately)
    VALUES (N'medical-records', N'Medical Records', 1);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.Location')
      AND name = N'UX_Location_Tenant_LocationId'
  )
    CREATE UNIQUE INDEX UX_Location_Tenant_LocationId
      ON dbo.Location (TenantId, LocationId);

  IF OBJECT_ID(N'dbo.ClinicPatientProfile', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicPatientProfile (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      ClientID INT NOT NULL,
      BloodType NVARCHAR(8) NULL,
      Allergies NVARCHAR(MAX) NULL,
      ChronicConditions NVARCHAR(MAX) NULL,
      CurrentMedications NVARCHAR(MAX) NULL,
      EmergencyContactName NVARCHAR(100) NULL,
      EmergencyContactPhone NVARCHAR(32) NULL,
      Notes NVARCHAR(MAX) NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicPatientProfile_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicPatientProfile_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicPatientProfile PRIMARY KEY (TenantId, ClientID),
      CONSTRAINT FK_ClinicPatientProfile_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT FK_ClinicPatientProfile_Client FOREIGN KEY (TenantId, ClientID)
        REFERENCES dbo.TblClient (TenantId, ClientID),
      CONSTRAINT CK_ClinicPatientProfile_BloodType CHECK (
        BloodType IS NULL OR BloodType IN
          (N'A+',N'A-',N'B+',N'B-',N'AB+',N'AB-',N'O+',N'O-',N'unknown')
      )
    );
  END;

  IF OBJECT_ID(N'dbo.ClinicEncounter', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicEncounter (
      EncounterId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ClinicEncounter_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      ClientID INT NOT NULL,
      PractitionerEmpID INT NOT NULL,
      LocationId UNIQUEIDENTIFIER NOT NULL,
      BookingRef NVARCHAR(128) NULL,
      VisitType NVARCHAR(20) NOT NULL CONSTRAINT DF_ClinicEncounter_VisitType DEFAULT N'new',
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ClinicEncounter_Status DEFAULT N'scheduled',
      ChiefComplaint NVARCHAR(1000) NULL,
      ClinicalNotes NVARCHAR(MAX) NULL,
      DiagnosisSummary NVARCHAR(MAX) NULL,
      VitalsJson NVARCHAR(MAX) NULL,
      FollowUpAt DATETIME2 NULL,
      StartedAt DATETIME2 NULL,
      CompletedAt DATETIME2 NULL,
      CreatedByUserID INT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicEncounter_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicEncounter_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicEncounter PRIMARY KEY (EncounterId),
      CONSTRAINT FK_ClinicEncounter_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT FK_ClinicEncounter_Client FOREIGN KEY (TenantId, ClientID)
        REFERENCES dbo.TblClient (TenantId, ClientID),
      CONSTRAINT FK_ClinicEncounter_Practitioner FOREIGN KEY (TenantId, PractitionerEmpID)
        REFERENCES dbo.TblEmp (TenantId, EmpID),
      CONSTRAINT FK_ClinicEncounter_Location FOREIGN KEY (TenantId, LocationId)
        REFERENCES dbo.Location (TenantId, LocationId),
      CONSTRAINT CK_ClinicEncounter_VisitType CHECK (VisitType IN (N'new', N'follow_up', N'procedure')),
      CONSTRAINT CK_ClinicEncounter_Status CHECK (Status IN (N'scheduled', N'in_progress', N'completed', N'cancelled')),
      CONSTRAINT CK_ClinicEncounter_VitalsJson CHECK (VitalsJson IS NULL OR ISJSON(VitalsJson) = 1)
    );

    CREATE UNIQUE INDEX UX_ClinicEncounter_Tenant_Id ON dbo.ClinicEncounter (TenantId, EncounterId);
    CREATE INDEX IX_ClinicEncounter_Tenant_Client_Created ON dbo.ClinicEncounter (TenantId, ClientID, CreatedAt DESC);
    CREATE INDEX IX_ClinicEncounter_Tenant_Practitioner_Status ON dbo.ClinicEncounter (TenantId, PractitionerEmpID, Status, CreatedAt DESC);
    CREATE INDEX IX_ClinicEncounter_Tenant_FollowUp ON dbo.ClinicEncounter (TenantId, FollowUpAt) WHERE FollowUpAt IS NOT NULL;
  END;

  IF OBJECT_ID(N'dbo.ClinicPrescription', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicPrescription (
      PrescriptionId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ClinicPrescription_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      EncounterId UNIQUEIDENTIFIER NOT NULL,
      PractitionerEmpID INT NOT NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ClinicPrescription_Status DEFAULT N'draft',
      Notes NVARCHAR(MAX) NULL,
      SignedAt DATETIME2 NULL,
      CreatedByUserID INT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicPrescription_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicPrescription_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicPrescription PRIMARY KEY (PrescriptionId),
      CONSTRAINT FK_ClinicPrescription_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT FK_ClinicPrescription_Encounter FOREIGN KEY (TenantId, EncounterId)
        REFERENCES dbo.ClinicEncounter (TenantId, EncounterId),
      CONSTRAINT FK_ClinicPrescription_Practitioner FOREIGN KEY (TenantId, PractitionerEmpID)
        REFERENCES dbo.TblEmp (TenantId, EmpID),
      CONSTRAINT CK_ClinicPrescription_Status CHECK (Status IN (N'draft', N'signed', N'void')),
      CONSTRAINT CK_ClinicPrescription_Signed CHECK (Status <> N'signed' OR SignedAt IS NOT NULL)
    );

    CREATE UNIQUE INDEX UX_ClinicPrescription_Tenant_Id ON dbo.ClinicPrescription (TenantId, PrescriptionId);
    CREATE INDEX IX_ClinicPrescription_Tenant_Encounter ON dbo.ClinicPrescription (TenantId, EncounterId, CreatedAt DESC);
  END;

  IF OBJECT_ID(N'dbo.ClinicPrescriptionItem', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicPrescriptionItem (
      PrescriptionItemId BIGINT IDENTITY(1,1) NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PrescriptionId UNIQUEIDENTIFIER NOT NULL,
      SortOrder INT NOT NULL,
      MedicationName NVARCHAR(200) NOT NULL,
      Strength NVARCHAR(100) NULL,
      Dosage NVARCHAR(100) NULL,
      Route NVARCHAR(100) NULL,
      Frequency NVARCHAR(100) NULL,
      Duration NVARCHAR(100) NULL,
      Instructions NVARCHAR(1000) NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicPrescriptionItem_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicPrescriptionItem PRIMARY KEY (PrescriptionItemId),
      CONSTRAINT FK_ClinicPrescriptionItem_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT FK_ClinicPrescriptionItem_Prescription FOREIGN KEY (TenantId, PrescriptionId)
        REFERENCES dbo.ClinicPrescription (TenantId, PrescriptionId),
      CONSTRAINT UQ_ClinicPrescriptionItem_Order UNIQUE (TenantId, PrescriptionId, SortOrder)
    );
  END;

  IF OBJECT_ID(N'dbo.ClinicClinicalAudit', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ClinicClinicalAudit (
      AuditId BIGINT IDENTITY(1,1) NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      EntityType NVARCHAR(64) NOT NULL,
      EntityId NVARCHAR(128) NOT NULL,
      Action NVARCHAR(64) NOT NULL,
      ActorUserID INT NULL,
      MetadataJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ClinicClinicalAudit_Metadata DEFAULT N'{}',
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ClinicClinicalAudit_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ClinicClinicalAudit PRIMARY KEY (AuditId),
      CONSTRAINT FK_ClinicClinicalAudit_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_ClinicClinicalAudit_MetadataJson CHECK (ISJSON(MetadataJson) = 1)
    );

    CREATE INDEX IX_ClinicClinicalAudit_Tenant_Entity
      ON dbo.ClinicClinicalAudit (TenantId, EntityType, EntityId, CreatedAt DESC);
  END;

  COMMIT TRAN;
  SELECT N'DRVO Clinics MVP medical records schema ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
