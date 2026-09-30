-- DRVO-009 Stage 1: InsCashMoveSales coexistence guard.
-- Behaviorally identical for legacy clients until Treasury pre-posts a sale CashMove.
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

  DECLARE @invid INT = (SELECT i.invID FROM inserted i);
  DECLARE @invType NVARCHAR(20) = (SELECT i.invType FROM inserted i);
  DECLARE @invDate DATE = (SELECT i.invDate FROM inserted i);
  DECLARE @invTime NVARCHAR(30) = (SELECT i.invTime FROM inserted i);
  DECLARE @clientID INT = (SELECT i.ClientID FROM inserted i);
  DECLARE @value DECIMAL(10, 2) = (SELECT i.GrandTotal FROM inserted i);
  DECLARE @note NVARCHAR(100) = (SELECT i.invNotes FROM inserted i);
  DECLARE @ReseervTime NVARCHAR(30) = (SELECT i.ReservTime FROM inserted i);
  DECLARE @shiftmoveID INT = (SELECT i.ShiftMoveID FROM inserted i);
  DECLARE @PaymentMethodID INT = (SELECT i.PaymentMethodID FROM inserted i);

  -- Treasury-owned sale rows are pre-posted before head insert when DRVO POS cutover is active.
  -- Skip trigger insert only when a registry sale row already exists for this invID + invType.
  DECLARE @treasurySaleExists BIT = CASE
    WHEN EXISTS (
      SELECT 1
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TreasuryMovementRegistry r
        ON r.CashMoveId = c.ID AND r.Kind = N'sale'
      WHERE c.invID = @invid AND c.invType = @invType
    ) THEN 1
    ELSE 0
  END;

  IF (@invType = N'مبيعات بالكارت' AND @ReseervTime IS NULL AND @treasurySaleExists = 0)
  BEGIN
    INSERT INTO TblCashMove (invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
    VALUES (@invid, @invType, @invDate, @invTime, @clientID, @value, 'out', @note, @shiftmoveID, @PaymentMethodID);
  END
  ELSE IF (@invType = N'م.مبيعات' AND @treasurySaleExists = 0)
  BEGIN
    INSERT INTO TblCashMove (invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
    VALUES (@invid, @invType, @invDate, @invTime, @clientID, @value, 'in', @note, @shiftmoveID, @PaymentMethodID);
  END
  ELSE IF (@invType = N'مبيعات' AND @ReseervTime IS NULL AND @treasurySaleExists = 0)
  BEGIN
    INSERT INTO TblCashMove (invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
    VALUES (@invid, @invType, @invDate, @invTime, @clientID, @value, 'in', @note, @shiftmoveID, @PaymentMethodID);
  END
  ELSE IF (@invType = N'م.مبيعات بالكارت' AND @treasurySaleExists = 0)
  BEGIN
    INSERT INTO TblCashMove (invID, invType, invDate, invTime, ClientID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID)
    VALUES (@invid, @invType, @invDate, @invTime, @clientID, @value, 'out', @note, @shiftmoveID, @PaymentMethodID);
  END
END
GO

PRINT 'DRVO-009: InsCashMoveSales coexistence guard applied';
GO
