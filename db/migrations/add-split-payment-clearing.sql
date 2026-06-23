-- ============================================================
-- Migration: Split Payment Clearing Account Setup
-- Idempotent — safe to run multiple times
-- TblSettingValues schema: ID (int PK), Name (nvarchar 50), Value (decimal 10,2)
-- Setting names used (all <= 50 chars):
--   'SplitClearingMethodID'  -> PaymentID of the clearing payment method
--   'SplitExpenseCatID'      -> ExpINID of the expense transfer category
--   'SplitIncomeCatID'       -> ExpINID of the income transfer category
-- ============================================================

-- 1a. Repair any previously-corrupted clearing method name (idempotent)
IF EXISTS (SELECT 1 FROM [dbo].[TblSettingValues] WHERE Name = N'SplitClearingMethodID')
BEGIN
    UPDATE [dbo].[TblPaymentMethods]
    SET PaymentMethod = N'دفع متعدد - حساب تسوية'
    WHERE PaymentID = (
        SELECT CAST(Value AS INT) FROM [dbo].[TblSettingValues]
        WHERE Name = N'SplitClearingMethodID'
    )
    AND PaymentMethod <> N'دفع متعدد - حساب تسوية';
END;

-- 1b. Insert internal clearing payment method if it does not exist
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblPaymentMethods]
    WHERE PaymentMethod = N'دفع متعدد - حساب تسوية'
)
BEGIN
    INSERT INTO [dbo].[TblPaymentMethods] (PaymentMethod)
    VALUES (N'دفع متعدد - حساب تسوية');
END;

-- 2. Store clearing method ID in TblSettingValues
DECLARE @clearingId INT;
SELECT @clearingId = PaymentID
FROM [dbo].[TblPaymentMethods]
WHERE PaymentMethod = N'دفع متعدد - حساب تسوية';

IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblSettingValues]
    WHERE Name = N'SplitClearingMethodID'
)
BEGIN
    INSERT INTO [dbo].[TblSettingValues] (Name, Value)
    VALUES (N'SplitClearingMethodID', @clearingId);
END
ELSE
BEGIN
    UPDATE [dbo].[TblSettingValues]
    SET Value = @clearingId
    WHERE Name = N'SplitClearingMethodID';
END;

-- 3. Insert transfer expense category if it does not exist
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpINCat]
    WHERE CatName = N'تحويل بين طرق الدفع - مصروف'
    AND ExpINType = N'مصروفات'
)
BEGIN
    INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
    VALUES (N'تحويل بين طرق الدفع - مصروف', N'مصروفات');
END;

-- 4. Store expense category ID
DECLARE @expCatId INT;
SELECT @expCatId = ExpINID
FROM [dbo].[TblExpINCat]
WHERE CatName = N'تحويل بين طرق الدفع - مصروف'
AND ExpINType = N'مصروفات';

IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblSettingValues]
    WHERE Name = N'SplitExpenseCatID'
)
BEGIN
    INSERT INTO [dbo].[TblSettingValues] (Name, Value)
    VALUES (N'SplitExpenseCatID', @expCatId);
END
ELSE
BEGIN
    UPDATE [dbo].[TblSettingValues]
    SET Value = @expCatId
    WHERE Name = N'SplitExpenseCatID';
END;

-- 5. Insert transfer income category if it does not exist
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblExpINCat]
    WHERE CatName = N'تحويل بين طرق الدفع - إيراد'
    AND ExpINType = N'ايرادات'
)
BEGIN
    INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
    VALUES (N'تحويل بين طرق الدفع - إيراد', N'ايرادات');
END;

-- 6. Store income category ID
DECLARE @incCatId INT;
SELECT @incCatId = ExpINID
FROM [dbo].[TblExpINCat]
WHERE CatName = N'تحويل بين طرق الدفع - إيراد'
AND ExpINType = N'ايرادات';

IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblSettingValues]
    WHERE Name = N'SplitIncomeCatID'
)
BEGIN
    INSERT INTO [dbo].[TblSettingValues] (Name, Value)
    VALUES (N'SplitIncomeCatID', @incCatId);
END
ELSE
BEGIN
    UPDATE [dbo].[TblSettingValues]
    SET Value = @incCatId
    WHERE Name = N'SplitIncomeCatID';
END;

-- 7. Verify results
SELECT Name, Value
FROM [dbo].[TblSettingValues]
WHERE Name IN (
    N'SplitClearingMethodID',
    N'SplitExpenseCatID',
    N'SplitIncomeCatID'
);
