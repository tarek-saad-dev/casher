/*
  DRVO-020: Optional barber → cashier handoff for POS settlement.
  Additive table only. Manual POS sales remain fully independent.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.TblBookingCashierHandoff', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TblBookingCashierHandoff (
      HandoffID INT IDENTITY(1, 1) NOT NULL,
      BookingID INT NOT NULL,
      BranchID INT NOT NULL,
      EmpID INT NOT NULL,
      TenantId NVARCHAR(100) NOT NULL,
      Status NVARCHAR(20) NOT NULL
        CONSTRAINT DF_TblBookingCashierHandoff_Status DEFAULT N'pending',
      PayloadJson NVARCHAR(MAX) NOT NULL,
      LockedByUserID INT NULL,
      LockedAt DATETIME2 NULL,
      ChargedInvID INT NULL,
      ChargedAt DATETIME2 NULL,
      CreatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_TblBookingCashierHandoff_Created DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_TblBookingCashierHandoff_Updated DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TblBookingCashierHandoff PRIMARY KEY (HandoffID),
      CONSTRAINT CK_TblBookingCashierHandoff_Status CHECK (
        Status IN (N'pending', N'loaded', N'charged', N'cancelled', N'superseded')
      ),
      CONSTRAINT CK_TblBookingCashierHandoff_PayloadJson CHECK (ISJSON(PayloadJson) = 1),
      CONSTRAINT CK_TblBookingCashierHandoff_Charged CHECK (
        (Status = N'charged' AND ChargedInvID IS NOT NULL AND ChargedAt IS NOT NULL)
        OR (Status <> N'charged' AND ChargedInvID IS NULL AND ChargedAt IS NULL)
      )
    );
    CREATE UNIQUE INDEX UX_TblBookingCashierHandoff_ActiveBooking
      ON dbo.TblBookingCashierHandoff (BookingID)
      WHERE Status IN (N'pending', N'loaded');
    CREATE INDEX IX_TblBookingCashierHandoff_BranchInbox
      ON dbo.TblBookingCashierHandoff (BranchID, Status, UpdatedAt DESC);
    CREATE INDEX IX_TblBookingCashierHandoff_TenantEmp
      ON dbo.TblBookingCashierHandoff (TenantId, EmpID, Status);
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
