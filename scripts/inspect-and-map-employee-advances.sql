-- =============================================
-- Script: Inspect and Map Employee Advances
-- Purpose: Safely create TblExpCatEmpMap mappings using real DB data
-- Date: 2026-03-31
-- =============================================

-- =============================================
-- STEP 1: Inspect Real Expense Categories
-- =============================================
PRINT '=== STEP 1: Inspecting Expense Categories ===';
PRINT '';

SELECT 
    ExpINID,
    CatName,
    ExpINType,
    LEN(CatName) AS NameLength
FROM [dbo].[TblExpINCat]
WHERE ExpINType = N'مصروفات'
  AND (
      CatName LIKE N'%سلف%'
      OR CatName LIKE N'%سلفة%'
      OR CatName LIKE N'%سلفه%'
  )
ORDER BY CatName;

PRINT '';
PRINT '=== STEP 2: Inspecting Employees ===';
PRINT '';

-- =============================================
-- STEP 2: Inspect Real Employees
-- =============================================
SELECT 
    EmpID,
    EmpName,
    IsActive,
    LEN(EmpName) AS NameLength
FROM [dbo].[TblEmp]
WHERE IsActive = 1
ORDER BY EmpName;

PRINT '';
PRINT '=== STEP 3: Analyzing Potential Matches ===';
PRINT '';

-- =============================================
-- STEP 3: Find Potential Matches
-- =============================================
-- This query attempts to match category names to employee names
-- using various patterns

WITH CategoryCandidates AS (
    SELECT 
        ExpINID,
        CatName,
        -- Extract name from patterns like "سلفه ( محمد )" or "سلفة(كريم)"
        LTRIM(RTRIM(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            REPLACE(CatName, N'سلفه', N''),
                            N'سلفة', N''
                        ),
                        N'سلف', N''
                    ),
                    N'(', N''
                ),
                N')', N''
            )
        )) AS ExtractedName
    FROM [dbo].[TblExpINCat]
    WHERE ExpINType = N'مصروفات'
      AND (CatName LIKE N'%سلف%' OR CatName LIKE N'%سلفة%' OR CatName LIKE N'%سلفه%')
),
EmployeeCandidates AS (
    SELECT 
        EmpID,
        EmpName,
        -- Normalize employee name for matching
        LTRIM(RTRIM(EmpName)) AS NormalizedName
    FROM [dbo].[TblEmp]
    WHERE IsActive = 1
)
SELECT 
    c.ExpINID,
    c.CatName AS CategoryName,
    c.ExtractedName,
    e.EmpID,
    e.EmpName AS EmployeeName,
    -- Confidence level
    CASE 
        -- Exact match after normalization
        WHEN c.ExtractedName = e.NormalizedName THEN 'HIGH'
        -- Employee name contains extracted name
        WHEN e.NormalizedName LIKE N'%' + c.ExtractedName + N'%' THEN 'MEDIUM'
        -- Extracted name contains employee name
        WHEN c.ExtractedName LIKE N'%' + e.NormalizedName + N'%' THEN 'MEDIUM'
        ELSE 'LOW'
    END AS MatchConfidence,
    -- Match type
    CASE 
        WHEN c.ExtractedName = e.NormalizedName THEN 'Exact'
        WHEN e.NormalizedName LIKE N'%' + c.ExtractedName + N'%' THEN 'Contains'
        WHEN c.ExtractedName LIKE N'%' + e.NormalizedName + N'%' THEN 'Partial'
        ELSE 'Weak'
    END AS MatchType
FROM CategoryCandidates c
CROSS JOIN EmployeeCandidates e
WHERE 
    -- Only show potential matches
    (
        c.ExtractedName = e.NormalizedName
        OR e.NormalizedName LIKE N'%' + c.ExtractedName + N'%'
        OR c.ExtractedName LIKE N'%' + e.NormalizedName + N'%'
    )
    AND LEN(c.ExtractedName) > 0
ORDER BY 
    c.CatName,
    CASE 
        WHEN c.ExtractedName = e.NormalizedName THEN 1
        WHEN e.NormalizedName LIKE N'%' + c.ExtractedName + N'%' THEN 2
        WHEN c.ExtractedName LIKE N'%' + e.NormalizedName + N'%' THEN 3
        ELSE 4
    END;

PRINT '';
PRINT '=== STEP 4: Check for Ambiguous Matches ===';
PRINT '';

-- =============================================
-- STEP 4: Identify Ambiguous Matches
-- =============================================
-- Categories that match multiple employees need manual review

WITH CategoryCandidates AS (
    SELECT 
        ExpINID,
        CatName,
        LTRIM(RTRIM(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            REPLACE(CatName, N'سلفه', N''),
                            N'سلفة', N''
                        ),
                        N'سلف', N''
                    ),
                    N'(', N''
                ),
                N')', N''
            )
        )) AS ExtractedName
    FROM [dbo].[TblExpINCat]
    WHERE ExpINType = N'مصروفات'
      AND (CatName LIKE N'%سلف%' OR CatName LIKE N'%سلفة%' OR CatName LIKE N'%سلفه%')
),
EmployeeCandidates AS (
    SELECT 
        EmpID,
        EmpName,
        LTRIM(RTRIM(EmpName)) AS NormalizedName
    FROM [dbo].[TblEmp]
    WHERE IsActive = 1
),
PotentialMatches AS (
    SELECT 
        c.ExpINID,
        c.CatName,
        c.ExtractedName,
        e.EmpID,
        e.EmpName,
        CASE 
            WHEN c.ExtractedName = e.NormalizedName THEN 'HIGH'
            WHEN e.NormalizedName LIKE N'%' + c.ExtractedName + N'%' THEN 'MEDIUM'
            WHEN c.ExtractedName LIKE N'%' + e.NormalizedName + N'%' THEN 'MEDIUM'
            ELSE 'LOW'
        END AS MatchConfidence
    FROM CategoryCandidates c
    CROSS JOIN EmployeeCandidates e
    WHERE 
        (
            c.ExtractedName = e.NormalizedName
            OR e.NormalizedName LIKE N'%' + c.ExtractedName + N'%'
            OR c.ExtractedName LIKE N'%' + e.NormalizedName + N'%'
        )
        AND LEN(c.ExtractedName) > 0
)
SELECT 
    ExpINID,
    CatName,
    ExtractedName,
    COUNT(*) AS MatchCount,
    STRING_AGG(CAST(EmpName AS NVARCHAR(MAX)), N', ') AS PossibleEmployees
FROM PotentialMatches
WHERE MatchConfidence IN ('HIGH', 'MEDIUM')
GROUP BY ExpINID, CatName, ExtractedName
HAVING COUNT(*) > 1
ORDER BY CatName;

PRINT '';
PRINT '=== STEP 5: Check Existing Mappings ===';
PRINT '';

-- =============================================
-- STEP 5: Check Existing Mappings
-- =============================================
SELECT 
    m.ID,
    m.ExpINID,
    c.CatName,
    m.EmpID,
    e.EmpName,
    m.TxnKind,
    m.IsActive,
    m.CreatedDate
FROM [dbo].[TblExpCatEmpMap] m
INNER JOIN [dbo].[TblExpINCat] c ON m.ExpINID = c.ExpINID
INNER JOIN [dbo].[TblEmp] e ON m.EmpID = e.EmpID
ORDER BY c.CatName;

PRINT '';
PRINT '=== Inspection Complete ===';
PRINT 'Review the results above before running the mapping script.';
