-- ============================================================
-- Final Validation Script
-- Cut Salon POS - Employee Finance Mapping
-- ============================================================

PRINT N'=== Final Validation Report ===';

-- 1) All employees with advance and revenue mapping
PRINT N'-- 1) Complete Employee Finance Mapping Status --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job,
    e.isActive,
    advCat.CatName AS AdvanceCatName,
    revCat.CatName AS RevenueCatName,
    CASE 
        WHEN advCat.CatName IS NOT NULL AND revCat.CatName IS NOT NULL THEN 'COMPLETE'
        WHEN advCat.CatName IS NOT NULL OR revCat.CatName IS NOT NULL THEN 'PARTIAL'
        ELSE 'NONE'
    END AS MappingStatus
FROM dbo.TblEmp e
LEFT JOIN dbo.TblExpCatEmpMap adv
    ON adv.EmpID = e.EmpID
   AND adv.TxnKind = N'advance'
   AND adv.IsActive = 1
LEFT JOIN dbo.TblExpINCat advCat
    ON advCat.ExpINID = adv.ExpINID
LEFT JOIN dbo.TblExpCatEmpMap rev
    ON rev.EmpID = e.EmpID
   AND rev.TxnKind = N'revenue'
   AND rev.IsActive = 1
LEFT JOIN dbo.TblExpINCat revCat
    ON revCat.ExpINID = rev.ExpINID
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName;

-- 2) Summary statistics
PRINT N'-- 2) Mapping Summary Statistics --';
SELECT 
    'Total Employees' AS Metric,
    COUNT(*) AS Count
FROM dbo.TblEmp 
WHERE ISNULL(isActive, 1) = 1

UNION ALL

SELECT 
    'With Advance Mapping' AS Metric,
    COUNT(*) AS Count
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND EXISTS (
    SELECT 1 FROM dbo.TblExpCatEmpMap m 
    WHERE m.EmpID = e.EmpID 
      AND m.TxnKind = N'advance' 
      AND m.IsActive = 1
  )

UNION ALL

SELECT 
    'With Revenue Mapping' AS Metric,
    COUNT(*) AS Count
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND EXISTS (
    SELECT 1 FROM dbo.TblExpCatEmpMap m 
    WHERE m.EmpID = e.EmpID 
      AND m.TxnKind = N'revenue' 
      AND m.IsActive = 1
  )

UNION ALL

SELECT 
    'Complete Mapping' AS Metric,
    COUNT(*) AS Count
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND EXISTS (
    SELECT 1 FROM dbo.TblExpCatEmpMap m 
    WHERE m.EmpID = e.EmpID 
      AND m.TxnKind = N'advance' 
      AND m.IsActive = 1
  )
  AND EXISTS (
    SELECT 1 FROM dbo.TblExpCatEmpMap m 
    WHERE m.EmpID = e.EmpID 
      AND m.TxnKind = N'revenue' 
      AND m.IsActive = 1
  );

-- 3) Employees without revenue mapping
PRINT N'-- 3) Employees Without Revenue Mapping --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1
        FROM dbo.TblExpCatEmpMap m
        JOIN dbo.TblExpINCat cat
            ON cat.ExpINID = m.ExpINID
        WHERE m.EmpID = e.EmpID
          AND m.TxnKind = N'revenue'
          AND m.IsActive = 1
          AND cat.ExpINType = N'ايرادات'
  )
ORDER BY e.EmpName;

-- 4) Employees without advance mapping
PRINT N'-- 4) Employees Without Advance Mapping --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1
        FROM dbo.TblExpCatEmpMap m
        JOIN dbo.TblExpINCat cat
            ON cat.ExpINID = m.ExpINID
        WHERE m.EmpID = e.EmpID
          AND m.TxnKind = N'advance'
          AND m.IsActive = 1
          AND cat.ExpINType = N'مصروفات'
  )
ORDER BY e.EmpName;

-- 5) Check for duplicate mappings
PRINT N'-- 5) Duplicate Mappings Check --';
SELECT
    EmpID,
    ExpINID,
    TxnKind,
    COUNT(*) AS DuplicateCount,
    MAX(CreatedDate) AS LatestDate,
    MIN(CreatedDate) AS EarliestDate
FROM dbo.TblExpCatEmpMap
GROUP BY EmpID, ExpINID, TxnKind
HAVING COUNT(*) > 1
ORDER BY EmpID, TxnKind, ExpINID;

-- 6) Available categories for mapping
PRINT N'-- 6) Available Categories --';
SELECT 
    ExpINType,
    COUNT(*) AS CategoryCount,
    STRING_AGG(CatName, N', ') WITHIN GROUP (ORDER BY CatName) AS Categories
FROM dbo.TblExpINCat
GROUP BY ExpINType
ORDER BY ExpINType;

-- 7) Recent mapping changes (last 7 days)
PRINT N'-- 7) Recent Mapping Changes (Last 7 Days) --';
SELECT
    e.EmpName,
    m.TxnKind,
    cat.CatName,
    m.IsActive,
    m.CreatedDate,
    m.ModifiedDate,
    m.Notes
FROM dbo.TblExpCatEmpMap m
JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
WHERE m.CreatedDate >= DATEADD(day, -7, GETDATE())
   OR m.ModifiedDate >= DATEADD(day, -7, GETDATE())
ORDER BY m.ModifiedDate DESC, m.CreatedDate DESC;

-- 8) Table structure validation
PRINT N'-- 8) Table Structure Validation --';
IF OBJECT_ID('dbo.TblExpCatEmpMap') IS NOT NULL
BEGIN
    SELECT 
        'TblExpCatEmpMap' AS TableName,
        'EXISTS' AS Status,
        (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TblExpCatEmpMap')) AS ColumnCount
END
ELSE
BEGIN
    SELECT 
        'TblExpCatEmpMap' AS TableName,
        'MISSING' AS Status,
        0 AS ColumnCount
END;

PRINT N'=== Validation Complete ===';

-- 9) API Test Queries (for manual testing)
PRINT N'-- 9) API Test Queries --';
PRINT N'-- GET /api/employees --';
PRINT N'SELECT ... (same as query #1)';
PRINT N'';
PRINT N'-- GET /api/finance/categories?type=مصروفات --';
PRINT N'SELECT ExpINID, CatName, ExpINType FROM dbo.TblExpINCat WHERE ExpINType = N''مصروفات'' ORDER BY CatName;';
PRINT N'';
PRINT N'-- GET /api/finance/categories?type=ايرادات --';
PRINT N'SELECT ExpINID, CatName, ExpINType FROM dbo.TblExpINCat WHERE ExpINType = N''ايرادات'' ORDER BY CatName;';
PRINT N'';
PRINT N'-- PATCH /api/admin/employees/{id}/finance-map --';
PRINT N'-- Test with: { "advanceExpINID": 1, "revenueExpINID": 2 }';
PRINT N'';
PRINT N'-- DELETE /api/admin/employees/{id}/finance-map --';
PRINT N'-- Test with: { "type": "advance" } or { "type": "revenue" }';
