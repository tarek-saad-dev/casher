-- DRVO-023 / Issue #223
-- CUT referral ledger foundation (schema only, no customer/financial mutation).
-- Never import legacy coin-based TblClientReferral/TblReferralReward rows.
-- Requires DRVO-010 tenant-owned TblClient + UX_TblClient_Tenant_ClientID.
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblReferralCustomerCode (
        ReferralCodeID BIGINT IDENTITY(1,1) NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ReferrerClientID INT NOT NULL,
        Code NVARCHAR(32) NOT NULL,
        ActivatedAtUtc DATETIME2(0) NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL
            CONSTRAINT DF_ReferralCustomerCode_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ReferralCustomerCode PRIMARY KEY CLUSTERED (ReferralCodeID),
        CONSTRAINT UQ_ReferralCustomerCode_Owner UNIQUE (TenantId, ReferrerClientID),
        CONSTRAINT UQ_ReferralCustomerCode_Code UNIQUE (TenantId, Code),
        CONSTRAINT UQ_ReferralCustomerCode_TenantIdOwner UNIQUE (TenantId, ReferralCodeID, ReferrerClientID),
        CONSTRAINT FK_ReferralCustomerCode_Tenant FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenant (TenantId),
        CONSTRAINT FK_ReferralCustomerCode_Client FOREIGN KEY (TenantId, ReferrerClientID)
            REFERENCES dbo.TblClient (TenantId, ClientID),
        CONSTRAINT CK_ReferralCustomerCode_Code CHECK (Code LIKE N'CUT-%' AND LEN(Code) BETWEEN 12 AND 32)
    );
END;
GO

IF OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblReferralVisitClaim (
        ClaimID BIGINT IDENTITY(1,1) NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ReferralCodeID BIGINT NOT NULL,
        ReferrerClientID INT NOT NULL,
        ReferredClientID INT NOT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ReferralVisitClaim_Status DEFAULT N'PENDING',
        FirstPaidInvID INT NULL,
        FirstPaidInvType NVARCHAR(20) NULL,
        ClaimedAtUtc DATETIME2(0) NOT NULL
            CONSTRAINT DF_ReferralVisitClaim_Claimed DEFAULT SYSUTCDATETIME(),
        AppliedAtUtc DATETIME2(0) NULL,
        ReversedAtUtc DATETIME2(0) NULL,
        CONSTRAINT PK_ReferralVisitClaim PRIMARY KEY CLUSTERED (ClaimID),
        -- One referred client can claim once, even after cancellation or reversal.
        CONSTRAINT UQ_ReferralVisitClaim_Referred UNIQUE (TenantId, ReferredClientID),
        CONSTRAINT UQ_ReferralVisitClaim_Owner UNIQUE (TenantId, ClaimID, ReferrerClientID),
        CONSTRAINT FK_ReferralVisitClaim_Code FOREIGN KEY (TenantId, ReferralCodeID, ReferrerClientID)
            REFERENCES dbo.TblReferralCustomerCode (TenantId, ReferralCodeID, ReferrerClientID),
        CONSTRAINT FK_ReferralVisitClaim_Referred FOREIGN KEY (TenantId, ReferredClientID)
            REFERENCES dbo.TblClient (TenantId, ClientID),
        CONSTRAINT CK_ReferralVisitClaim_NoSelf CHECK (ReferrerClientID <> ReferredClientID),
        CONSTRAINT CK_ReferralVisitClaim_Status CHECK (Status IN (N'PENDING', N'APPLIED', N'REVERSED', N'CANCELLED')),
        CONSTRAINT CK_ReferralVisitClaim_InvoicePair CHECK (
            (FirstPaidInvID IS NULL AND FirstPaidInvType IS NULL) OR
            (FirstPaidInvID > 0 AND FirstPaidInvType IS NOT NULL)
        ),
        CONSTRAINT CK_ReferralVisitClaim_AppliedInvoice CHECK (
            Status NOT IN (N'APPLIED', N'REVERSED') OR FirstPaidInvID IS NOT NULL
        )
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblReferralVisitClaim')
      AND name = N'IX_ReferralVisitClaim_Referrer'
)
BEGIN
    CREATE INDEX IX_ReferralVisitClaim_Referrer
    ON dbo.TblReferralVisitClaim (TenantId, ReferrerClientID, Status, ClaimedAtUtc DESC);
END;
GO

IF OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblReferralDiscountVoucher (
        VoucherID BIGINT IDENTITY(1,1) NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ClaimID BIGINT NOT NULL,
        ReferrerClientID INT NOT NULL,
        DiscountPercent DECIMAL(5,2) NOT NULL
            CONSTRAINT DF_ReferralDiscountVoucher_Percent DEFAULT (20),
        Status NVARCHAR(20) NOT NULL
            CONSTRAINT DF_ReferralDiscountVoucher_Status DEFAULT N'ACTIVE',
        IssuedAtUtc DATETIME2(0) NOT NULL
            CONSTRAINT DF_ReferralDiscountVoucher_Issued DEFAULT SYSUTCDATETIME(),
        ExpiresAtUtc DATETIME2(0) NULL,
        UsedAtUtc DATETIME2(0) NULL,
        UsedInvID INT NULL,
        UsedInvType NVARCHAR(20) NULL,
        RevokedAtUtc DATETIME2(0) NULL,
        CONSTRAINT PK_ReferralDiscountVoucher PRIMARY KEY CLUSTERED (VoucherID),
        -- Exactly one reward per successful referred invoice / claim.
        CONSTRAINT UQ_ReferralDiscountVoucher_Claim UNIQUE (TenantId, ClaimID),
        CONSTRAINT FK_ReferralDiscountVoucher_Claim FOREIGN KEY (TenantId, ClaimID, ReferrerClientID)
            REFERENCES dbo.TblReferralVisitClaim (TenantId, ClaimID, ReferrerClientID),
        CONSTRAINT CK_ReferralDiscountVoucher_Percent CHECK (DiscountPercent = 20),
        CONSTRAINT CK_ReferralDiscountVoucher_Status CHECK
            (Status IN (N'ACTIVE', N'USED', N'EXPIRED', N'REVOKED')),
        CONSTRAINT CK_ReferralDiscountVoucher_UsagePair CHECK (
            (UsedInvID IS NULL AND UsedInvType IS NULL) OR
            (UsedInvID > 0 AND UsedInvType IS NOT NULL)
        ),
        CONSTRAINT CK_ReferralDiscountVoucher_UsedInvoice CHECK (
            Status <> N'USED' OR (UsedInvID IS NOT NULL AND UsedAtUtc IS NOT NULL)
        )
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblReferralDiscountVoucher')
      AND name = N'IX_ReferralDiscountVoucher_OwnerStatus'
)
BEGIN
    CREATE INDEX IX_ReferralDiscountVoucher_OwnerStatus
    ON dbo.TblReferralDiscountVoucher (TenantId, ReferrerClientID, Status, ExpiresAtUtc);
END;
GO

-- Only a subsequent transactionally integrated sale workflow may:
-- (1) activate a code after the referrer's paid invoice;
-- (2) mark a claim APPLIED on the referred customer's completed paid invoice;
-- (3) issue a 20% voucher once; (4) consume/revoke that voucher once.
-- This migration deliberately backfills NO codes, claims or vouchers.
