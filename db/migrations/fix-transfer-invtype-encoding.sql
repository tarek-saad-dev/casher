-- Fix corrupted InvType values for payment-method transfers.
--
-- Root cause: the approval-workflow executor inserted the Arabic word 'تحويل'
-- as a raw SQL string literal without the N prefix, causing it to be stored as
-- '?????' inside the NVARCHAR(20) InvType column.
--
-- This migration derives the correct type from the canonical inOut direction:
--   - out -> N'مصروفات'
--   - in  -> N'ايرادات'
--
-- Only rows whose Notes contain the word 'تحويل' (transfer) are touched.

BEGIN TRANSACTION;

UPDATE dbo.TblCashMove
SET InvType = N'مصروفات'
WHERE inOut = 'out'
  AND (Notes LIKE N'%تحويل%')
  AND InvType <> N'مصروفات';

UPDATE dbo.TblCashMove
SET InvType = N'ايرادات'
WHERE inOut = 'in'
  AND (Notes LIKE N'%تحويل%')
  AND InvType <> N'ايرادات';

COMMIT;

-- Verification
SELECT 
  ID,
  invID,
  InvType,
  inOut,
  Notes,
  InvDate
FROM dbo.TblCashMove
WHERE Notes LIKE N'%تحويل%'
ORDER BY ID DESC;
