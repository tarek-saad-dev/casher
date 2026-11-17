-- CUT CLUB 2.0 — staging-only voucher↔sale binding contract
-- NOT runnable against production. DO NOT EXECUTE against last132.
-- Actual creation of a claim MUST be inside the same POS invoice transaction.
-- Claims must be reversed when an invoice is cancelled/refunded; never
-- reconcile an existing historical voucher by creating a fake claim.
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'last132_agent'
  THROW 52111, 'CUT CLUB claim schema may be applied ONLY in last132_agent', 1;
IF SUSER_SNAME() <> N'drvo_agent'
  THROW 52112, 'CUT CLUB claim schema requires the reviewed staging operator', 1;
IF OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim', N'U') IS NOT NULL
  THROW 52113, 'CUT CLUB claim table already exists; manual review required', 1;

BEGIN TRANSACTION;
  CREATE TABLE dbo.CutClubVoucherInvoiceClaim (
    ClaimID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    InventoryID INT NOT NULL,
    ClientID INT NOT NULL,
    BranchID INT NOT NULL,
    InvID INT NOT NULL,
    ServiceID INT NOT NULL,
    Status NVARCHAR(24) NOT NULL,
    CreatedAt DATETIME2(3) NOT NULL
      CONSTRAINT DF_CutClubVoucherInvoiceClaim_CreatedAt DEFAULT SYSUTCDATETIME(),
    ReversedAt DATETIME2(3) NULL,
    CONSTRAINT CK_CutClubVoucherInvoiceClaim_Status
      CHECK (Status IN (N'APPLIED', N'REVERSED')),
    CONSTRAINT CK_CutClubVoucherInvoiceClaim_Identifiers
      CHECK (InventoryID > 0 AND ClientID > 0 AND BranchID > 0 AND
             InvID > 0 AND ServiceID > 0)
  );
  -- One voucher can claim at most one invoice, including after a refund.
  CREATE UNIQUE INDEX UX_CutClubVoucherInvoiceClaim_Inventory
    ON dbo.CutClubVoucherInvoiceClaim(TenantId, InventoryID);
  -- A single saved invoice service line cannot silently settle two vouchers.
  -- Multiple identical service-line cases need a reviewed line-level key.
  CREATE UNIQUE INDEX UX_CutClubVoucherInvoiceClaim_SaleBenefit
    ON dbo.CutClubVoucherInvoiceClaim(
      TenantId, BranchID, InvID, ServiceID
    );
COMMIT TRANSACTION;

-- No seed, no historical voucher updates, no balance/stock changes here.
