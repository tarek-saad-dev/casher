-- ============================================================
-- Safe Revenue Mapping Insert Script
-- Cut Salon POS - Employee Finance Mapping
-- ============================================================

PRINT N'=== Revenue Mapping Insert ===';

-- First, show potential matches before inserting
PRINT N'-- Potential Revenue Matches (Audit) --';
SELECT
    e.EmpID,
    e.EmpName,
    cat.ExpINID,
    cat.CatName,
    cat.ExpINType,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM dbo.TblExpCatEmpMap m 
            WHERE m.EmpID = e.EmpID 
              AND m.ExpINID = cat.ExpINID 
              AND m.TxnKind = N'revenue'
              AND m.IsActive = 1
        ) THEN 'ALREADY_MAPPED'
        ELSE 'CAN_BE_MAPPED'
    END AS MappingStatus
FROM dbo.TblEmp e
INNER JOIN dbo.TblExpINCat cat
    ON cat.ExpINType = N'ايرادات'
   AND (cat.CatName LIKE N'%' + e.EmpName + N'%' 
        OR e.EmpName LIKE N'%' + cat.CatName + N'%')
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName, cat.CatName;

-- Check for ambiguous matches (employee with multiple revenue categories)
PRINT N'-- Ambiguous Matches (Multiple Revenue Categories) --';
SELECT
    e.EmpID,
    e.EmpName,
    COUNT(*) AS MatchCount,
    STRING_AGG(cat.CatName, N', ') WITHIN GROUP (ORDER BY cat.CatName) AS MatchedCategories
FROM dbo.TblEmp e
INNER JOIN dbo.TblExpINCat cat
    ON cat.ExpINType = N'ايرادات'
   AND (cat.CatName LIKE N'%' + e.EmpName + N'%' 
        OR e.EmpName LIKE N'%' + cat.CatName + N'%')
WHERE ISNULL(e.isActive, 1) = 1
GROUP BY e.EmpID, e.EmpName
HAVING COUNT(*) > 1
ORDER BY e.EmpName;

-- Check for employees without any revenue category match
PRINT N'-- Employees Without Revenue Category Match --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1 
        FROM dbo.TblExpINCat cat 
        WHERE cat.ExpINType = N'ايرادات'
          AND (cat.CatName LIKE N'%' + e.EmpName + N'%' 
               OR e.EmpName LIKE N'%' + cat.CatName + N'%')
  )
ORDER BY e.EmpName;

-- Safe insert only for clear matches (single category per employee)
PRINT N'-- Inserting Safe Revenue Mappings --';

-- Use a temporary table to store safe mappings
DECLARE @SafeMappings TABLE (
    EmpID INT,
    ExpINID INT,
    CatName NVARCHAR(100),
    EmpName NVARCHAR(100)
);

-- Insert only clear matches (employees with exactly one matching revenue category)
INSERT INTO @SafeMappings (EmpID, ExpINID, CatName, EmpName)
SELECT
    e.EmpID,
    cat.ExpINID,
    cat.CatName,
    e.EmpName
FROM dbo.TblEmp e
INNER JOIN dbo.TblExpINCat cat
    ON cat.ExpINType = N'ايرادات'
   AND (cat.CatName LIKE N'%' + e.EmpName + N'%' 
        OR e.EmpName LIKE N'%' + cat.CatName + N'%')
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        -- Exclude already mapped
        SELECT 1 FROM dbo.TblExpCatEmpMap m 
        WHERE m.EmpID = e.EmpID 
          AND m.ExpINID = cat.ExpINID 
          AND m.TxnKind = N'revenue'
          AND m.IsActive = 1
  )
  AND e.EmpID IN (
        -- Include only employees with exactly one matching category
        SELECT emp.EmpID
        FROM dbo.TblEmp emp
        INNER JOIN dbo.TblExpINCat c
            ON c.ExpINType = N'ايرادات'
           AND (c.CatName LIKE N'%' + emp.EmpName + N'%' 
                OR emp.EmpName LIKE N'%' + c.CatName + N'%')
        WHERE ISNULL(emp.isActive, 1) = 1
        GROUP BY emp.EmpID
        HAVING COUNT(*) = 1
  );

-- Show what will be inserted
PRINT N'-- Safe Mappings to Insert --';
SELECT 
    EmpID,
    EmpName,
    ExpINID,
    CatName
FROM @SafeMappings
ORDER BY EmpName;

-- Perform the safe insert
INSERT INTO dbo.TblExpCatEmpMap 
    (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
SELECT
    m.EmpID,
    m.ExpINID,
    N'revenue',
    1,
    N'Revenue map from employees admin - auto matched',
    GETDATE(),
    GETDATE()
FROM @SafeMappings m;

PRINT N'  [~] Inserted ' + CAST(@@ROWCOUNT AS NVARCHAR) + N' revenue mappings';

-- Show final results
PRINT N'-- Final Revenue Mapping Status --';
SELECT
    e.EmpID,
    e.EmpName,
    revCat.CatName AS RevenueCatName,
    CASE 
        WHEN revCat.CatName IS NOT NULL THEN 'MAPPED'
        ELSE 'NOT_MAPPED'
    END AS RevenueStatus
FROM dbo.TblEmp e
LEFT JOIN dbo.TblExpCatEmpMap rev
    ON rev.EmpID = e.EmpID
   AND rev.TxnKind = N'revenue'
   AND rev.IsActive = 1
LEFT JOIN dbo.TblExpINCat revCat
    ON revCat.ExpINID = rev.ExpINID
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName;

PRINT N'=== Revenue Mapping Insert Complete ===';
