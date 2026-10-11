/*
  DRVO public self-service signup V1.

  Additive-only control-plane table. It stores signup intent and the authoritative link
  to the tenant created by self-service provisioning. No CUT data is copied or modified.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.PublicSignupRegistration', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PublicSignupRegistration (
      SignupId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_PublicSignupRegistration_Id DEFAULT NEWSEQUENTIALID(),
      PhoneNormalized NVARCHAR(32) NOT NULL,
      Email NVARCHAR(254) NULL,
      ContactName NVARCHAR(100) NOT NULL,
      BusinessName NVARCHAR(200) NOT NULL,
      IndustryCode NVARCHAR(64) NOT NULL,
      NeedsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_PublicSignupRegistration_Needs DEFAULT N'[]',
      StartMode NVARCHAR(20) NOT NULL,
      IpHash CHAR(64) NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_PublicSignupRegistration_Status DEFAULT N'provisioning',
      TenantId UNIQUEIDENTIFIER NULL,
      ErrorCode NVARCHAR(64) NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_PublicSignupRegistration_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_PublicSignupRegistration_UpdatedAt DEFAULT SYSUTCDATETIME(),
      ProvisionedAt DATETIME2 NULL,
      CONSTRAINT PK_PublicSignupRegistration PRIMARY KEY (SignupId),
      CONSTRAINT FK_PublicSignupRegistration_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_PublicSignupRegistration_Industry CHECK (IndustryCode IN (N'salon', N'supermarket')),
      CONSTRAINT CK_PublicSignupRegistration_StartMode CHECK (StartMode IN (N'real', N'demo')),
      CONSTRAINT CK_PublicSignupRegistration_Status CHECK (Status IN (N'provisioning', N'provisioned', N'failed')),
      CONSTRAINT CK_PublicSignupRegistration_NeedsJson CHECK (ISJSON(NeedsJson) = 1)
    );

    CREATE UNIQUE INDEX UX_PublicSignupRegistration_Phone
      ON dbo.PublicSignupRegistration (PhoneNormalized);

    CREATE INDEX IX_PublicSignupRegistration_IpCreated
      ON dbo.PublicSignupRegistration (IpHash, CreatedAt DESC)
      INCLUDE (Status);

    CREATE UNIQUE INDEX UX_PublicSignupRegistration_Tenant
      ON dbo.PublicSignupRegistration (TenantId)
      WHERE TenantId IS NOT NULL;
  END;

  COMMIT TRAN;
  SELECT N'DRVO public self-service signup schema ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
