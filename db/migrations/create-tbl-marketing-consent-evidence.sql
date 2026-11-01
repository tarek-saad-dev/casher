-- Legacy entrypoint mirror.
-- Canonical source of truth: db/drvo-migrations/020-marketing-consent-evidence/schema.sql
-- Prefer: DRVO migration key `marketing-consent-evidence` via the migration control plane,
-- or: npx tsx scripts/run-marketing-consent-evidence-migration.ts
--
-- Kept identical to DRVO-020 for older docs/scripts that still reference this path.
/*
  DRVO-020: Marketing consent evidence + paused WhatsApp campaign status.
  Additive consent table only — does not invent/backfill customer consent rows.
  Idempotent. Safe to re-run.
*/
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMarketingConsentEvidence', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblMarketingConsentEvidence (
    ID                BIGINT         IDENTITY(1,1) NOT NULL,
    TenantId          UNIQUEIDENTIFIER NOT NULL,
    ClientID          INT            NULL,
    PhoneE164         NVARCHAR(20)   NOT NULL,
    Status            NVARCHAR(20)   NOT NULL
      CONSTRAINT DF_TblMarketingConsentEvidence_Status DEFAULT (N'granted'),
    EvidenceSource    NVARCHAR(80)   NOT NULL,
    EvidenceRef       NVARCHAR(200)  NULL,
    GrantedAt         DATETIME2(0)   NOT NULL
      CONSTRAINT DF_TblMarketingConsentEvidence_GrantedAt DEFAULT (SYSUTCDATETIME()),
    RevokedAt         DATETIME2(0)   NULL,
    Notes             NVARCHAR(500)  NULL,
    CreatedAt         DATETIME2(0)   NOT NULL
      CONSTRAINT DF_TblMarketingConsentEvidence_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CreatedByUserID   INT            NULL,
    CONSTRAINT PK_TblMarketingConsentEvidence PRIMARY KEY CLUSTERED (ID),
    CONSTRAINT CK_TblMarketingConsentEvidence_Status
      CHECK (Status IN (N'granted', N'revoked')),
    CONSTRAINT FK_TblMarketingConsentEvidence_Client
      FOREIGN KEY (ClientID) REFERENCES dbo.TblClient (ClientID),
    CONSTRAINT FK_TblMarketingConsentEvidence_Tenant
      FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)
  );
  PRINT N'Created TblMarketingConsentEvidence';
END
ELSE
  PRINT N'TblMarketingConsentEvidence already exists — skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_TblMarketingConsentEvidence_Tenant_Phone'
    AND object_id = OBJECT_ID(N'dbo.TblMarketingConsentEvidence')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_TblMarketingConsentEvidence_Tenant_Phone
    ON dbo.TblMarketingConsentEvidence (TenantId, PhoneE164, Status);
  PRINT N'Created IX_TblMarketingConsentEvidence_Tenant_Phone';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_TblMarketingConsentEvidence_Tenant_Client'
    AND object_id = OBJECT_ID(N'dbo.TblMarketingConsentEvidence')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_TblMarketingConsentEvidence_Tenant_Client
    ON dbo.TblMarketingConsentEvidence (TenantId, ClientID, Status)
    WHERE ClientID IS NOT NULL;
  PRINT N'Created IX_TblMarketingConsentEvidence_Tenant_Client';
END
GO

-- Allow paused campaign status (pause/cancel)
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_TblWhatsAppCampaign_Status'
    AND parent_object_id = OBJECT_ID(N'dbo.TblWhatsAppCampaign')
)
BEGIN
  ALTER TABLE dbo.TblWhatsAppCampaign DROP CONSTRAINT CK_TblWhatsAppCampaign_Status;
END
GO

IF OBJECT_ID(N'dbo.TblWhatsAppCampaign', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblWhatsAppCampaign_Status'
      AND parent_object_id = OBJECT_ID(N'dbo.TblWhatsAppCampaign')
  )
BEGIN
  ALTER TABLE dbo.TblWhatsAppCampaign WITH CHECK ADD CONSTRAINT CK_TblWhatsAppCampaign_Status
    CHECK ([Status] IN (N'draft', N'queued', N'running', N'completed', N'cancelled', N'failed', N'paused'));
  PRINT N'Updated CK_TblWhatsAppCampaign_Status to include paused';
END
GO
