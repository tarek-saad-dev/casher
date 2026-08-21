-- Booking V2 B6 — Transactional Slot Claims (5-minute quantum).
-- Correctness authority for EmpID absolute slots (global across branches).
-- Deploy-time only. Do NOT CREATE from hot request paths.
--
-- UNIQUE (EmpID, AbsoluteSlotStartUtc) makes double-booking impossible
-- including cross-branch for the same employee.

IF OBJECT_ID(N'dbo.TblBookingSlotClaim', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBookingSlotClaim (
    ClaimID               BIGINT IDENTITY(1,1) NOT NULL,
    EmpID                 INT NOT NULL,
    BranchID              INT NOT NULL,
    AbsoluteSlotStartUtc  DATETIME2(0) NOT NULL,
    ClaimType             NVARCHAR(16) NOT NULL
      CONSTRAINT CK_SlotClaim_Type CHECK (ClaimType IN (N'HOLD', N'BOOKING')),
    HoldToken             NVARCHAR(80) NULL,
    BookingID             INT NULL,
    OwnerKey              NVARCHAR(120) NULL,
    ExpiresAtUtc          DATETIME2(3) NULL,
    CreatedAtUtc          DATETIME2(3) NOT NULL
      CONSTRAINT DF_SlotClaim_Created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_TblBookingSlotClaim PRIMARY KEY (ClaimID),
    CONSTRAINT UQ_TblBookingSlotClaim_Emp_Slot
      UNIQUE (EmpID, AbsoluteSlotStartUtc)
  );

  CREATE NONCLUSTERED INDEX IX_SlotClaim_HoldToken
    ON dbo.TblBookingSlotClaim (HoldToken)
    WHERE HoldToken IS NOT NULL;

  CREATE NONCLUSTERED INDEX IX_SlotClaim_BookingID
    ON dbo.TblBookingSlotClaim (BookingID)
    WHERE BookingID IS NOT NULL;

  CREATE NONCLUSTERED INDEX IX_SlotClaim_Emp_Type_Expires
    ON dbo.TblBookingSlotClaim (EmpID, ClaimType, ExpiresAtUtc)
    INCLUDE (AbsoluteSlotStartUtc, BranchID, HoldToken, BookingID);

  CREATE NONCLUSTERED INDEX IX_SlotClaim_Expires_Hold
    ON dbo.TblBookingSlotClaim (ExpiresAtUtc)
    WHERE ClaimType = N'HOLD' AND ExpiresAtUtc IS NOT NULL;
END
GO
