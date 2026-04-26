-- ============================================================
-- SQL Cleanup for Mohamed Advance Mappings
-- Safe, idempotent cleanup that preserves financial data
-- ============================================================

PRINT N'=== Mohamed Advance Mappings Cleanup ===';

-- 1) Disable any old mappings for the old Mohamed advance categories
PRINT N'-- 1) Disabling old Mohamed advance category mappings --';
UPDATE dbo.TblExpCatEmpMap
SET IsActive = 0,
    ModifiedDate = GETDATE(),
    Notes = CONCAT(ISNULL(Notes, N''), N' | Disabled old Mohamed advance category')
WHERE TxnKind = N'advance'
  AND ExpINID IN (12, 39);

DECLARE @OldMappingsDisabled INT = @@ROWCOUNT;
PRINT N'  [-] Disabled ' + CAST(@OldMappingsDisabled AS NVARCHAR) + N' old Mohamed advance mappings';

-- 2) Ensure correct active mapping for Mohamed (EmpID = 7)
PRINT N'-- 2) Ensuring correct active mapping for Mohamed --';
DECLARE @MohamedExists INT;
DECLARE @CorrectCategoryExists INT;

SELECT @MohamedExists = COUNT(*) 
FROM dbo.TblEmp 
WHERE EmpID = 7 AND EmpName = N'محمد';

SELECT @CorrectCategoryExists = COUNT(*) 
FROM dbo.TblExpINCat 
WHERE ExpINID = 34 AND CatName = N'سلفه ( محمد )';

IF @MohamedExists > 0 AND @CorrectCategoryExists > 0
BEGIN
    -- Check if correct mapping already exists and is active
    DECLARE @CorrectMappingActive INT;
    SELECT @CorrectMappingActive = COUNT(*)
    FROM dbo.TblExpCatEmpMap
    WHERE EmpID = 7
      AND ExpINID = 34
      AND TxnKind = N'advance'
      AND IsActive = 1;
    
    IF @CorrectMappingActive = 0
    BEGIN
        -- Insert correct mapping if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM dbo.TblExpCatEmpMap
            WHERE EmpID = 7 AND ExpINID = 34 AND TxnKind = N'advance'
        )
        BEGIN
            INSERT INTO dbo.TblExpCatEmpMap
                (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
            VALUES
                (7, 34, N'advance', 1, N'Correct active advance mapping for Mohamed', GETDATE(), GETDATE());
            PRINT N'  [+] Created correct active mapping for Mohamed (EmpID=7, ExpINID=34)';
        END
        ELSE
        BEGIN
            -- Reactivate correct mapping if it exists but is inactive
            UPDATE dbo.TblExpCatEmpMap
            SET IsActive = 1,
                ModifiedDate = GETDATE(),
                Notes = CONCAT(ISNULL(Notes, N''), N' | Reactivated correct Mohamed advance mapping')
            WHERE EmpID = 7
              AND ExpINID = 34
              AND TxnKind = N'advance';
            PRINT N'  [+] Reactivated correct mapping for Mohamed (EmpID=7, ExpINID=34)';
        END
    END
    ELSE
    BEGIN
        PRINT N'  [=] Correct active mapping for Mohamed already exists';
    END
    
    -- Disable any other advance mappings for Mohamed that are not the canonical one
    UPDATE dbo.TblExpCatEmpMap
    SET IsActive = 0,
        ModifiedDate = GETDATE(),
        Notes = CONCAT(ISNULL(Notes, N''), N' | Disabled non-canonical Mohamed advance mapping')
    WHERE EmpID = 7
      AND TxnKind = N'advance'
      AND ExpINID <> 34;
    
    DECLARE @OtherMappingsDisabled INT = @@ROWCOUNT;
    IF @OtherMappingsDisabled > 0
        PRINT N'  [-] Disabled ' + CAST(@OtherMappingsDisabled AS NVARCHAR) + N' non-canonical Mohamed advance mappings';
END
ELSE
BEGIN
    PRINT N'  [!] Mohamed (EmpID=7) or correct category (ExpINID=34) not found';
END

-- 3) Validation - Show current Mohamed advance mappings
PRINT N'-- 3) Current Mohamed advance mappings --';
SELECT
    e.EmpID,
    e.EmpName,
    m.ExpINID,
    cat.CatName,
    m.TxnKind,
    m.IsActive,
    m.CreatedDate,
    m.ModifiedDate,
    m.Notes
FROM dbo.TblExpCatEmpMap m
JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
WHERE e.EmpID = 7
  AND m.TxnKind = N'advance'
ORDER BY m.IsActive DESC, m.ModifiedDate DESC;

-- 4) Validation - Test OUTER APPLY query (what the API should return)
PRINT N'-- 4) Test OUTER APPLY query for Mohamed --';
SELECT
    e.EmpID,
    e.EmpName,
    adv.ExpINID AS AdvanceExpINID,
    adv.CatName AS AdvanceCatName
FROM dbo.TblEmp e
OUTER APPLY (
    SELECT TOP 1
        m.ExpINID,
        cat.CatName
    FROM dbo.TblExpCatEmpMap m
    JOIN dbo.TblExpINCat cat
        ON cat.ExpINID = m.ExpINID
    WHERE m.EmpID = e.EmpID
      AND m.TxnKind = N'advance'
      AND m.IsActive = 1
      AND cat.ExpINType = N'مصروفات'
    ORDER BY m.ModifiedDate DESC, m.ID DESC
) adv
WHERE e.EmpID = 7;

-- 5) Show excluded categories for reference
PRINT N'-- 5) Excluded old advance categories --';
SELECT 
    ExpINID,
    CatName,
    ExpINType,
    'EXCLUDED FROM AUTO-MATCHING' AS Status
FROM dbo.TblExpINCat
WHERE ExpINID IN (12, 39)
ORDER BY ExpINID;

PRINT N'=== Cleanup Complete ===';
PRINT N'';
PRINT N'Expected results:';
PRINT N'- Mohamed should appear only once in /admin/employees';
PRINT N'- AdvanceCatName should be: سلفه ( محمد )';
PRINT N'- Old categories (12, 39) should be inactive';
PRINT N'- Financial data in TblCashMove is preserved';
