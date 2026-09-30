-- DRVO-009 Stage 1: InsCashMoveSales coexistence guard.
-- Keeps the branch-ownership trigger shape (set-based, BranchID required)
-- and the audited cash directions. Legacy clients stay trigger-only until
-- Treasury pre-posts a sale CashMove for the same invID + invType.
-- Safe to run on staging (last132_agent) and production via migration control plane.

IF OBJECT_ID(N'dbo.InsCashMoveSales', N'TR') IS NOT NULL
  DROP TRIGGER dbo.InsCashMoveSales;
GO

CREATE TRIGGER [dbo].[InsCashMoveSales]
   ON [dbo].[TblinvServHead]
   AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;

  -- Card sales (cash out) when ReservTime is null.
  INSERT INTO dbo.TblCashMove (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
    Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
  )
  SELECT
    i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'out',
    i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
  FROM inserted i
  WHERE i.invType = N'مبيعات بالكارت'
    AND i.ReservTime IS NULL
    AND i.BranchID IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TreasuryMovementRegistry r
        ON r.CashMoveId = c.ID AND r.Kind = N'sale'
      WHERE c.invID = i.invID AND c.invType = i.invType
    );

  -- Card sale returns (cash in).
  INSERT INTO dbo.TblCashMove (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
    Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
  )
  SELECT
    i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'in',
    i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
  FROM inserted i
  WHERE i.invType = N'م.مبيعات بالكارت'
    AND i.BranchID IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TreasuryMovementRegistry r
        ON r.CashMoveId = c.ID AND r.Kind = N'sale'
      WHERE c.invID = i.invID AND c.invType = i.invType
    );

  -- Standard sales (cash in) when ReservTime is null.
  INSERT INTO dbo.TblCashMove (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
    Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
  )
  SELECT
    i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'in',
    i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
  FROM inserted i
  WHERE i.invType = N'مبيعات'
    AND i.ReservTime IS NULL
    AND i.BranchID IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TreasuryMovementRegistry r
        ON r.CashMoveId = c.ID AND r.Kind = N'sale'
      WHERE c.invID = i.invID AND c.invType = i.invType
    );

  -- Standard sale returns (cash out).
  INSERT INTO dbo.TblCashMove (
    invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
    Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
  )
  SELECT
    i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'out',
    i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
  FROM inserted i
  WHERE i.invType = N'م.مبيعات'
    AND i.BranchID IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TreasuryMovementRegistry r
        ON r.CashMoveId = c.ID AND r.Kind = N'sale'
      WHERE c.invID = i.invID AND c.invType = i.invType
    );
END
GO

PRINT 'DRVO-009: InsCashMoveSales coexistence guard applied';
GO
