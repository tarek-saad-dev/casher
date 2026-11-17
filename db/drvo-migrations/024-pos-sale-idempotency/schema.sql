-- DRVO-024 / Issue #246: resilient POS invoice POST request idempotency.
-- Additive schema only; controlled migration PLAN/APPLY required in production.
-- Designed for tenant-scoped SERIALIZABLE row reservation in SAME sale transaction.
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.TblPosSaleRequest', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblPosSaleRequest (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        RequestID UNIQUEIDENTIFIER NOT NULL,
        UserID INT NOT NULL,
        BranchID INT NOT NULL,
        PayloadHash CHAR(64) NOT NULL,
        Status NVARCHAR(15) NOT NULL
            CONSTRAINT DF_TblPosSaleRequest_Status DEFAULT N'PENDING',
        InvID INT NULL,
        InvType NVARCHAR(20) NULL,
        CreatedAtUtc DATETIME2(0) NOT NULL
            CONSTRAINT DF_TblPosSaleRequest_Created DEFAULT SYSUTCDATETIME(),
        CompletedAtUtc DATETIME2(0) NULL,
        CONSTRAINT PK_TblPosSaleRequest PRIMARY KEY CLUSTERED (TenantId, RequestID),
        CONSTRAINT FK_TblPosSaleRequest_Tenant FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenant (TenantId),
        CONSTRAINT CK_TblPosSaleRequest_Status CHECK (Status IN (N'PENDING', N'COMMITTED')),
        CONSTRAINT CK_TblPosSaleRequest_Hash CHECK (
            LEN(PayloadHash) = 64
            AND PayloadHash NOT LIKE '%[^0-9a-f]%' COLLATE Latin1_General_BIN2
        ),
        CONSTRAINT CK_TblPosSaleRequest_Invoice CHECK (
            (Status = N'PENDING'
                AND InvID IS NULL AND InvType IS NULL AND CompletedAtUtc IS NULL)
            OR (Status = N'COMMITTED'
                AND InvID > 0 AND InvType = N'مبيعات' AND CompletedAtUtc IS NOT NULL)
        )
    );
END;
GO

-- This PK guarantees one request reservation per tenant. Writers lock the
-- row/key-range with UPDLOCK,HOLDLOCK before invoice creation, then complete
-- Status+InvID inside the *same* transaction as invoice and payment.
-- No backfill: historical POS invoices have no request IDs.
