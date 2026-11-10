-- CUT Receipt Studio v1 — ADDITIVE, idempotent, production DB schema.
-- SAFETY: run only after verified backup, using explicit operator approval.
-- No existing invoice or printer tables are modified.
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.ReceiptStudioTemplate', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ReceiptStudioTemplate (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      BranchScope INT NOT NULL, -- 0 = default tenant template; >0 = branch override
      ReceiptType VARCHAR(24) NOT NULL CONSTRAINT DF_RST_Type DEFAULT 'invoice',
      DraftJson NVARCHAR(MAX) NULL,
      DraftRevision INT NOT NULL CONSTRAINT DF_RST_DraftRevision DEFAULT 0,
      PublishedJson NVARCHAR(MAX) NULL,
      PublishedVersion INT NOT NULL CONSTRAINT DF_RST_PublishedVersion DEFAULT 0,
      UpdatedByUserId INT NULL,
      UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RST_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ReceiptStudioTemplate PRIMARY KEY (TenantId, BranchScope, ReceiptType),
      CONSTRAINT CK_RST_BranchScope CHECK (BranchScope >= 0),
      CONSTRAINT CK_RST_DraftRevision CHECK (DraftRevision >= 0),
      CONSTRAINT CK_RST_PublishedVersion CHECK (PublishedVersion >= 0),
      CONSTRAINT CK_RST_ReceiptType CHECK (ReceiptType = 'invoice'),
      CONSTRAINT CK_RST_DraftJson CHECK (DraftJson IS NULL OR ISJSON(DraftJson) = 1),
      CONSTRAINT CK_RST_PublishedJson CHECK (PublishedJson IS NULL OR ISJSON(PublishedJson) = 1),
      CONSTRAINT FK_RST_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId)
    );
  END;

  IF OBJECT_ID(N'dbo.ReceiptStudioVersion', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ReceiptStudioVersion (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      BranchScope INT NOT NULL,
      ReceiptType VARCHAR(24) NOT NULL,
      Version INT NOT NULL,
      SnapshotJson NVARCHAR(MAX) NOT NULL,
      Action VARCHAR(16) NOT NULL,
      ActorUserId INT NOT NULL,
      CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RSV_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ReceiptStudioVersion PRIMARY KEY (TenantId, BranchScope, ReceiptType, Version),
      CONSTRAINT CK_RSV_Action CHECK (Action IN ('publish','rollback')),
      CONSTRAINT CK_RSV_Json CHECK (ISJSON(SnapshotJson) = 1),
      CONSTRAINT FK_RSV_Template FOREIGN KEY (TenantId, BranchScope, ReceiptType)
        REFERENCES dbo.ReceiptStudioTemplate(TenantId, BranchScope, ReceiptType)
    );
  END;

  IF OBJECT_ID(N'dbo.ReceiptStudioAsset', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.ReceiptStudioAsset (
      AssetId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RSA_Id DEFAULT NEWID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      MimeType VARCHAR(20) NOT NULL CONSTRAINT DF_RSA_Mime DEFAULT 'image/png',
      Data VARBINARY(MAX) NOT NULL,
      WidthPx INT NOT NULL,
      HeightPx INT NOT NULL,
      CreatedByUserId INT NOT NULL,
      CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_RSA_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_ReceiptStudioAsset PRIMARY KEY (AssetId),
      CONSTRAINT FK_RSA_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT CK_RSA_Mime CHECK (MimeType='image/png'),
      CONSTRAINT CK_RSA_Width CHECK (WidthPx BETWEEN 1 AND 576),
      CONSTRAINT CK_RSA_Height CHECK (HeightPx BETWEEN 1 AND 1200),
      CONSTRAINT CK_RSA_DataSize CHECK (DATALENGTH(Data) BETWEEN 33 AND 153600)
    );
    CREATE INDEX IX_RSA_Tenant ON dbo.ReceiptStudioAsset(TenantId, AssetId);
  END;

  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
