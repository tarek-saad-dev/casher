-- ============================================================
-- Split Payment Reconciliation Queries
-- Run these to verify the mixed payment implementation is
-- producing correct treasury balances with no double-counting.
-- ============================================================

-- 1. Show all settings for split payment config
SELECT SettingKey, SettingValue, Notes
FROM [dbo].[TblSettingValues]
WHERE SettingKey IN (
    N'SplitPaymentClearingMethodID',
    N'SplitPaymentExpenseCatID',
    N'SplitPaymentIncomeCatID'
);

-- 2. Clearing account balance (should net to zero or near-zero)
--    Every 'in' from invoice triggers should be offset by 'out' redistribution.
DECLARE @clearingId INT = (
    SELECT CAST(SettingValue AS INT) FROM [dbo].[TblSettingValues]
    WHERE SettingKey = N'SplitPaymentClearingMethodID'
);
SELECT
    SUM(CASE WHEN inOut = N'in'  THEN GrandTolal ELSE 0 END) AS TotalIn,
    SUM(CASE WHEN inOut = N'out' THEN GrandTolal ELSE 0 END) AS TotalOut,
    SUM(CASE WHEN inOut = N'in'  THEN GrandTolal ELSE 0 END)
  - SUM(CASE WHEN inOut = N'out' THEN GrandTolal ELSE 0 END) AS NetBalance
FROM [dbo].[TblCashMove]
WHERE PaymentMethodID = @clearingId;

-- 3. Mixed-payment invoices: verify TblinvServPayment allocations sum == GrandTotal
SELECT
    h.invID,
    h.GrandTotal,
    SUM(ISNULL(p.PayValue, 0)) AS AllocatedTotal,
    h.GrandTotal - SUM(ISNULL(p.PayValue, 0)) AS Discrepancy
FROM [dbo].[TblinvServHead] h
INNER JOIN [dbo].[TblinvServPayment] p
    ON h.invID = p.invID AND h.invType = p.invType
WHERE h.invType = N'مبيعات'
  AND h.PaymentMethodID = @clearingId
GROUP BY h.invID, h.GrandTotal
HAVING ABS(h.GrandTotal - SUM(ISNULL(p.PayValue, 0))) > 0.01
ORDER BY h.invID DESC;

-- 4. Invoices with clearing header but no redistribution entries
--    (indicates failed redistribution — these need to be reprocessed)
DECLARE @expCatId INT = (
    SELECT CAST(SettingValue AS INT) FROM [dbo].[TblSettingValues]
    WHERE SettingKey = N'SplitPaymentExpenseCatID'
);
SELECT h.invID, h.GrandTotal, h.invDate
FROM [dbo].[TblinvServHead] h
WHERE h.invType = N'مبيعات'
  AND h.PaymentMethodID = @clearingId
  AND NOT EXISTS (
      SELECT 1 FROM [dbo].[TblCashMove] cm
      WHERE cm.ExpINID = @expCatId
        AND cm.Notes LIKE N'%فاتورة ' + CAST(h.invID AS NVARCHAR) + N'%'
  )
ORDER BY h.invID DESC;

-- 5. Treasury balance summary by real payment methods (excluding clearing)
SELECT
    pm.PaymentID,
    pm.PaymentMethod,
    SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) AS TotalIn,
    SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS TotalOut,
    SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END)
  - SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Balance
FROM [dbo].[TblCashMove] cm
INNER JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
WHERE cm.PaymentMethodID <> @clearingId
GROUP BY pm.PaymentID, pm.PaymentMethod
ORDER BY Balance DESC;
