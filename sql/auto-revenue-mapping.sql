-- ============================================================
-- Automatic Revenue Mapping Script
-- Cut Salon POS - Auto-map revenue categories for unmapped employees
-- ============================================================

PRINT N'=== Automatic Revenue Mapping ===';

-- First, show current status
PRINT N'-- Current Revenue Mapping Status --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM dbo.TblExpCatEmpMap m
            JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
            WHERE m.EmpID = e.EmpID 
              AND m.TxnKind = N'revenue' 
              AND m.IsActive = 1
              AND cat.ExpINType = N'ايرادات'
        ) THEN 'MAPPED'
        ELSE 'UNMAPPED'
    END AS RevenueStatus
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName;

-- Show available revenue categories
PRINT N'-- Available Revenue Categories --';
SELECT 
    ExpINID,
    CatName,
    ExpINType
FROM dbo.TblExpINCat
WHERE ExpINType = N'ايرادات'
ORDER BY CatName;

-- Show employees that need revenue mapping
PRINT N'-- Employees Needing Revenue Mapping --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1 FROM dbo.TblExpCatEmpMap m
        JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
        WHERE m.EmpID = e.EmpID 
          AND m.TxnKind = N'revenue' 
          AND m.IsActive = 1
          AND cat.ExpINType = N'ايرادات'
  )
ORDER BY e.EmpName;

-- Note: Individual categories will be created as needed with format 'ايراد (employee name)'
PRINT N'-- Individual Category Naming Strategy --';
PRINT N'  [i] Will create individual categories: ايراد (employee name)';

-- Try smart mapping first (name matching)
PRINT N'-- Attempting Smart Revenue Mapping (Name Matching) --';
DECLARE @SmartMappings TABLE (
    EmpID INT,
    EmpName NVARCHAR(200),
    ExpINID INT,
    CatName NVARCHAR(200),
    MatchType NVARCHAR(50)
);

-- Find exact or partial name matches
INSERT INTO @SmartMappings (EmpID, EmpName, ExpINID, CatName, MatchType)
SELECT
    e.EmpID,
    e.EmpName,
    cat.ExpINID,
    cat.CatName,
    CASE 
        WHEN cat.CatName = e.EmpName THEN 'EXACT'
        WHEN cat.CatName LIKE N'%' + e.EmpName + N'%' THEN 'CONTAINS_EMP'
        WHEN e.EmpName LIKE N'%' + cat.CatName + N'%' THEN 'CONTAINS_CAT'
        ELSE 'PARTIAL'
    END AS MatchType
FROM dbo.TblEmp e
INNER JOIN dbo.TblExpINCat cat
    ON cat.ExpINType = N'ايرادات'
   AND (cat.CatName = e.EmpName
        OR cat.CatName LIKE N'%' + e.EmpName + N'%'
        OR e.EmpName LIKE N'%' + cat.CatName + N'%')
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1 FROM dbo.TblExpCatEmpMap m
        WHERE m.EmpID = e.EmpID 
          AND m.TxnKind = N'revenue' 
          AND m.IsActive = 1
  )
ORDER BY MatchType, e.EmpName;

-- Show smart mapping results
PRINT N'-- Smart Mapping Results --';
SELECT 
    EmpID,
    EmpName,
    CatName,
    MatchType
FROM @SmartMappings
ORDER BY MatchType, EmpName;

-- Insert smart mappings (only exact and contains matches)
PRINT N'-- Inserting Smart Mappings --';
INSERT INTO dbo.TblExpCatEmpMap 
    (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
SELECT
    m.EmpID,
    m.ExpINID,
    N'revenue',
    1,
    N'Auto revenue mapping - ' + m.MatchType + ' match',
    GETDATE(),
    GETDATE()
FROM @SmartMappings m
WHERE m.MatchType IN ('EXACT', 'CONTAINS_EMP', 'CONTAINS_CAT');

DECLARE @SmartInserted INT = @@ROWCOUNT;
PRINT N'  [~] Inserted ' + CAST(@SmartInserted AS NVARCHAR) + N' smart revenue mappings';

-- For remaining unmapped employees, create individual categories
PRINT N'-- Creating Individual Revenue Categories for Remaining Employees --';
DECLARE @IndividualMappings TABLE (
    EmpID INT,
    EmpName NVARCHAR(200),
    CategoryName NVARCHAR(200),
    ExpINID INT
);

-- Process each unmapped employee individually
DECLARE @EmpID INT, @EmpName NVARCHAR(200);
DECLARE unmapped_cursor CURSOR FOR
SELECT e.EmpID, e.EmpName
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
        SELECT 1 FROM dbo.TblExpCatEmpMap m
        WHERE m.EmpID = e.EmpID 
          AND m.TxnKind = N'revenue' 
          AND m.IsActive = 1
  )
  AND NOT EXISTS (
        -- Exclude employees that got smart mapping
        SELECT 1 FROM @SmartMappings sm WHERE sm.EmpID = e.EmpID
  )
ORDER BY e.EmpName;

OPEN unmapped_cursor;
FETCH NEXT FROM unmapped_cursor INTO @EmpID, @EmpName;

WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @IndividualCategoryName NVARCHAR(200) = N'ايراد (' + @EmpName + N')';
    DECLARE @CategoryExpINID INT;
    
    -- Check if individual category already exists
    SELECT @CategoryExpINID = ExpINID 
    FROM dbo.TblExpINCat 
    WHERE CatName = @IndividualCategoryName 
      AND ExpINType = N'ايرادات';
    
    IF @CategoryExpINID IS NULL OR @CategoryExpINID = 0
    BEGIN
        -- Create individual revenue category
        INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (@IndividualCategoryName, N'ايرادات');
        
        SELECT @CategoryExpINID = SCOPE_IDENTITY();
        PRINT N'  [+] Created individual category: ' + @IndividualCategoryName + N' (ID: ' + CAST(@CategoryExpINID AS NVARCHAR) + N')';
    END
    
    -- Insert mapping to individual category
    INSERT INTO dbo.TblExpCatEmpMap 
        (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
    VALUES
        (@EmpID, @CategoryExpINID, N'revenue', 1, 
         N'Auto revenue mapping - individual category', GETDATE(), GETDATE());
    
    INSERT INTO @IndividualMappings (EmpID, EmpName, CategoryName, ExpINID)
    VALUES (@EmpID, @EmpName, @IndividualCategoryName, @CategoryExpINID);
    
    FETCH NEXT FROM unmapped_cursor INTO @EmpID, @EmpName;
END

CLOSE unmapped_cursor;
DEALLOCATE unmapped_cursor;

-- Show employees getting individual mapping
PRINT N'-- Employees Getting Individual Revenue Mapping --';
SELECT 
    EmpID,
    EmpName,
    CategoryName
FROM @IndividualMappings
ORDER BY EmpName;

DECLARE @IndividualInserted INT = (SELECT COUNT(*) FROM @IndividualMappings);
PRINT N'  [~] Inserted ' + CAST(@IndividualInserted AS NVARCHAR) + N' individual revenue mappings';

-- Final summary
PRINT N'-- Final Mapping Summary --';
DECLARE @TotalEmployees INT;
DECLARE @MappedEmployees INT;

SELECT @TotalEmployees = COUNT(*) 
FROM dbo.TblEmp 
WHERE ISNULL(isActive, 1) = 1;

SELECT @MappedEmployees = COUNT(*)
FROM dbo.TblEmp e
WHERE ISNULL(e.isActive, 1) = 1
  AND EXISTS (
        SELECT 1 FROM dbo.TblExpCatEmpMap m
        JOIN dbo.TblExpINCat cat ON cat.ExpINID = m.ExpINID
        WHERE m.EmpID = e.EmpID 
          AND m.TxnKind = N'revenue' 
          AND m.IsActive = 1
          AND cat.ExpINType = N'ايرادات'
  );

PRINT N'  Total Active Employees: ' + CAST(@TotalEmployees AS NVARCHAR);
PRINT N'  Employees with Revenue Mapping: ' + CAST(@MappedEmployees AS NVARCHAR);
PRINT N'  Smart Mappings: ' + CAST(@SmartInserted AS NVARCHAR);
PRINT N'  Individual Mappings: ' + CAST(@IndividualInserted AS NVARCHAR);
PRINT N'  Mapping Coverage: ' + CAST(CAST(@MappedEmployees * 100.0 / @TotalEmployees AS DECIMAL(5,2)) AS NVARCHAR) + N'%';

-- Show final mapping status
PRINT N'-- Final Revenue Mapping Status --';
SELECT
    e.EmpID,
    e.EmpName,
    e.Job,
    cat.CatName AS RevenueCategory,
    m.Notes AS MappingNotes,
    m.CreatedDate AS MappingDate
FROM dbo.TblEmp e
LEFT JOIN dbo.TblExpCatEmpMap m
    ON m.EmpID = e.EmpID
   AND m.TxnKind = N'revenue'
   AND m.IsActive = 1
LEFT JOIN dbo.TblExpINCat cat
    ON cat.ExpINID = m.ExpINID
WHERE ISNULL(e.isActive, 1) = 1
ORDER BY e.EmpName;

PRINT N'=== Automatic Revenue Mapping Complete ===';
