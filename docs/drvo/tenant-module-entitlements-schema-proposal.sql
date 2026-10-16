/*
 DRVO ERP tenant module entitlements — REVIEW ONLY / NOT APPLIED.

 Preconditions:
 - Verified backup of isolated staging database last132_agent
 - DBA confirms Tenant(TenantId) key, data types, existing billing schema
 - Separate approved migration with rollback plan
 - Never run against production last132
 - No default grants, seeds, or automatic POS access

 The entitlement table is a technical activation record, not a payment ledger.
 Subscription/payment source of truth stays in the owning product.
 A later audited billing integration may set entitlements only after
 verifying the product subscription; it must not duplicate finance records.
*/
CREATE TABLE dbo.DrvoTenantModuleEntitlement (
  TenantId UNIQUEIDENTIFIER NOT NULL,
  ModuleKey NVARCHAR(64) NOT NULL,
  Status NVARCHAR(16) NOT NULL,
  ValidUntilUtc DATETIME2(3) NULL,
  UpdatedAtUtc DATETIME2(3) NOT NULL
    CONSTRAINT DF_DrvoTenantModuleEntitlement_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_DrvoTenantModuleEntitlement PRIMARY KEY (TenantId, ModuleKey),
  CONSTRAINT FK_DrvoTenantModuleEntitlement_Tenant FOREIGN KEY (TenantId)
    REFERENCES dbo.Tenant(TenantId),
  CONSTRAINT CK_DrvoTenantModuleEntitlement_Status
    CHECK (Status IN (N'enabled', N'disabled', N'suspended')),
  CONSTRAINT CK_DrvoTenantModuleEntitlement_ModuleKey
    CHECK (ModuleKey IN (
      N'pos', N'booking', N'hr', N'inventory', N'treasury',
      N'reports', N'online_booking'
    ))
);
GO

-- No INSERT, UPDATE, DELETE or automatic role/module assignment.
-- Audit history, effective billing state, and authorization of write paths
-- must be reviewed before introducing mutation APIs.
