-- ============================================================
-- Revenue Mapping Audit Script
-- Cut Salon POS - Employee Finance Mapping
-- ============================================================

PRINT N'=== Revenue Mapping Audit ===';

-- 1) Audit existing revenue categories
PRINT N'-- 1) Existing Revenue Categories --';
SELECT
    ExpINID,
    CatName,
    ExpINType
FROM dbo.TblExpINCat
WHERE ExpINType = N'ايرادات'
ORDER BY CatName;

-- 2) Audit existing expense categories (for advances)
PRINT N'-- 2) Existing Expense Categories (Advances) --';
SELECT
    ExpINID,
    CatName,
    ExpINType
FROM dbo.TblExpINCat
WHERE ExpINType = N'مصروفات'
ORDER BY CatName;

-- 3) Try to match employees with revenue categories
PRINT N'-- 3) Employee Revenue Category Matches --';
SELECT
    e.EmpID,
    e.EmpName,
    cat.ExpINID,
    cat.CatName,
    cat.ExpINType,
    CASE 
        WHEN cat.ExpINID IS NULL THEN 'NO_MATCH'
        ELSE 'MATCH'
    END AS MatchStatus
FROM dbo.TblEmp e
LEFT JOIN dbo.TblExpINCat cat
    ON cat.ExpINType = N'ايرادات'
   AND (cat.CatName LIKE N'%' + e.EmpName + N'%' 
        OR e.EmpName LIKE N'%' + cat.CatName + N'%')
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName, cat.CatName;

-- 4) Current advance mappings
PRINT N'-- 4) Current Advance Mappings --';
SELECT
    e.EmpID,
    e.EmpName,
    mp.ExpINID,
    cat.CatName AS AdvanceCatName,
    cat.ExpINType,
    mp.IsActive,
    mp.CreatedDate,
    mp.ModifiedDate
FROM dbo.TblEmp e
LEFT JOIN dbo.TblExpCatEmpMap mp
    ON mp.EmpID = e.EmpID
   AND mp.TxnKind = N'advance'
LEFT JOIN dbo.TblExpINCat cat
    ON cat.ExpINID = mp.ExpINID
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName;

-- 5) Current revenue mappings (if any)
PRINT N'-- 5) Current Revenue Mappings --';
SELECT
    e.EmpID,
    e.EmpName,
    mp.ExpINID,
    cat.CatName AS RevenueCatName,
    cat.ExpINType,
    mp.IsActive,
    mp.CreatedDate,
    mp.ModifiedDate
FROM dbo.TblEmp e
LEFT JOIN dbo.TblExpCatEmpMap mp
    ON mp.EmpID = e.EmpID
   AND mp.TxnKind = N'revenue'
LEFT JOIN dbo.TblExpINCat cat
    ON cat.ExpINID = mp.ExpINID
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName;

-- 6) Employees without advance mapping
PRINT N'-- 6) Employees Without Advance Mapping --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1
        FROM dbo.TblExpCatEmpMap m
        WHERE m.EmpID = e.EmpID
          AND m.TxnKind = N'advance'
          AND m.IsActive = 1
  )
ORDER BY e.EmpName;

-- 7) Employees without revenue mapping
PRINT N'-- 7) Employees Without Revenue Mapping --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1
        FROM dbo.TblExpCatEmpMap m
        WHERE m.EmpID = e.EmpID
          AND m.TxnKind = N'revenue'
          AND m.IsActive = 1
  )
ORDER BY e.EmpName;

-- 8) Check for potential duplicate mappings
PRINT N'-- 8) Potential Duplicate Mappings --';
SELECT
    EmpID,
    ExpINID,
    TxnKind,
    COUNT(*) AS DuplicateCount,
    MAX(CreatedDate) AS LatestDate
FROM dbo.TblExpCatEmpMap
GROUP BY EmpID, ExpINID, TxnKind
HAVING COUNT(*) > 1
ORDER BY EmpID, TxnKind, ExpINID;

PRINT N'=== Audit Complete ===';
