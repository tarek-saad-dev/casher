-- ============================================================
--  payroll-migration.sql
--  Safe idempotent migration for Cut Salon Payroll System
--  HawaiDB  |  Run as many times as needed without side effects
-- ============================================================
SET NOCOUNT ON;
PRINT N'============================================================';
PRINT N'  payroll-migration.sql  START  ' + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT N'============================================================';

-- ============================================================
-- SECTION 1: AUDIT REPORT  (read-only, no changes)
-- ============================================================
PRINT N'';
PRINT N'--- SECTION 1: Audit Report ---';

-- 1a. Columns in TblEmp
PRINT N'[1a] TblEmp payroll columns:';
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    NUMERIC_PRECISION,
    NUMERIC_SCALE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME   = 'TblEmp'
  AND COLUMN_NAME IN (
        'BaseSalary','Salary','SalaryType',
        'TargetCommissionPercent','TargetMinSales',
        'DefaultCheckInTime','DefaultCheckOutTime','IsPayrollEnabled'
      )
ORDER BY ORDINAL_POSITION;

-- 1b. Tables exist?
PRINT N'[1b] Required tables:';
SELECT
    t.name                                   AS TableName,
    CASE WHEN t.object_id IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END AS Status
FROM (VALUES
    ('TblEmp'),('TblEmpAttendance'),
    ('TblExpCatEmpMap'),('TblExpINCat'),('TblCashMove')
) v(name)
LEFT JOIN sys.tables t ON t.name = v.name AND SCHEMA_NAME(t.schema_id) = 'dbo';

-- 1c. FKs on attendance / advance map
PRINT N'[1c] Foreign keys:';
SELECT
    fk.name          AS FK_Name,
    OBJECT_NAME(fk.parent_object_id)  AS ParentTable,
    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ParentCol,
    OBJECT_NAME(fk.referenced_object_id) AS RefTable,
    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS RefCol
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
WHERE OBJECT_NAME(fk.parent_object_id) IN ('TblEmpAttendance','TblExpCatEmpMap');

-- 1d. Indexes
PRINT N'[1d] Indexes on attendance / advance map:';
SELECT
    OBJECT_NAME(i.object_id) AS TableName,
    i.name                   AS IndexName,
    i.is_unique,
    i.type_desc
FROM sys.indexes i
WHERE OBJECT_NAME(i.object_id) IN ('TblEmpAttendance','TblExpCatEmpMap')
  AND i.type > 0;

-- 1e. Stored Procedure
PRINT N'[1e] SP sp_GetMonthlyPayroll:';
SELECT
    CASE WHEN OBJECT_ID('dbo.sp_GetMonthlyPayroll','P') IS NOT NULL
         THEN 'EXISTS' ELSE 'MISSING' END AS SPStatus;

-- 1f. ExpCatEmpMap row count
PRINT N'[1f] TblExpCatEmpMap row count:';
IF OBJECT_ID('dbo.TblExpCatEmpMap','U') IS NOT NULL
    SELECT COUNT(*) AS MappingRows FROM dbo.TblExpCatEmpMap;
ELSE
    PRINT '  Table does not exist yet.';

PRINT N'--- Audit complete ---';
PRINT N'';

-- ============================================================
-- SECTION 2: Add missing columns to TblEmp
-- ============================================================
PRINT N'--- SECTION 2: TblEmp column migration ---';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='SalaryType')
BEGIN
    ALTER TABLE dbo.TblEmp ADD SalaryType NVARCHAR(20) NULL CONSTRAINT DF_TblEmp_SalaryType DEFAULT N'monthly';
    PRINT N'  [+] Added SalaryType';
END ELSE PRINT N'  [=] SalaryType already exists';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='BaseSalary')
BEGIN
    ALTER TABLE dbo.TblEmp ADD BaseSalary DECIMAL(10,2) NULL CONSTRAINT DF_TblEmp_BaseSalary DEFAULT 0;
    PRINT N'  [+] Added BaseSalary';
END ELSE PRINT N'  [=] BaseSalary already exists';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='TargetCommissionPercent')
BEGIN
    ALTER TABLE dbo.TblEmp ADD TargetCommissionPercent DECIMAL(5,2) NULL CONSTRAINT DF_TblEmp_TargetCommissionPercent DEFAULT 0;
    PRINT N'  [+] Added TargetCommissionPercent';
END ELSE PRINT N'  [=] TargetCommissionPercent already exists';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='TargetMinSales')
BEGIN
    ALTER TABLE dbo.TblEmp ADD TargetMinSales DECIMAL(10,2) NULL CONSTRAINT DF_TblEmp_TargetMinSales DEFAULT 0;
    PRINT N'  [+] Added TargetMinSales';
END ELSE PRINT N'  [=] TargetMinSales already exists';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='DefaultCheckInTime')
BEGIN
    ALTER TABLE dbo.TblEmp ADD DefaultCheckInTime TIME NULL;
    PRINT N'  [+] Added DefaultCheckInTime';
END ELSE PRINT N'  [=] DefaultCheckInTime already exists';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='DefaultCheckOutTime')
BEGIN
    ALTER TABLE dbo.TblEmp ADD DefaultCheckOutTime TIME NULL;
    PRINT N'  [+] Added DefaultCheckOutTime';
END ELSE PRINT N'  [=] DefaultCheckOutTime already exists';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='IsPayrollEnabled')
BEGIN
    ALTER TABLE dbo.TblEmp ADD IsPayrollEnabled BIT NULL CONSTRAINT DF_TblEmp_IsPayrollEnabled DEFAULT 1;
    PRINT N'  [+] Added IsPayrollEnabled';
END ELSE PRINT N'  [=] IsPayrollEnabled already exists';

-- Backfill BaseSalary from legacy Salary column if present
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='Salary')
   AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblEmp' AND COLUMN_NAME='BaseSalary')
BEGIN
    UPDATE dbo.TblEmp
    SET    BaseSalary = Salary
    WHERE  (BaseSalary IS NULL OR BaseSalary = 0)
      AND  Salary IS NOT NULL
      AND  Salary > 0;
    PRINT N'  [~] BaseSalary backfilled from legacy Salary where applicable';
END

PRINT N'--- Section 2 done ---';
PRINT N'';

-- ============================================================
-- SECTION 3: TblEmpAttendance
-- ============================================================
PRINT N'--- SECTION 3: TblEmpAttendance ---';

IF OBJECT_ID(N'dbo.TblEmpAttendance', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblEmpAttendance (
        ID            INT IDENTITY(1,1) NOT NULL,
        EmpID         INT NOT NULL,
        WorkDate      DATE NOT NULL,
        CheckInTime   TIME NULL,
        CheckOutTime  TIME NULL,
        Status        NVARCHAR(20) NULL,
        Notes         NVARCHAR(200) NULL,
        CreatedAt     DATETIME NOT NULL CONSTRAINT DF_TblEmpAttendance_CreatedAt DEFAULT GETDATE(),
        UpdatedAt     DATETIME NULL,
        CONSTRAINT PK_TblEmpAttendance PRIMARY KEY CLUSTERED (ID)
    );
    PRINT N'  [+] Created TblEmpAttendance';
END ELSE PRINT N'  [=] TblEmpAttendance already exists';

-- FK: EmpID -> TblEmp
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_TblEmpAttendance_EmpID'
      AND parent_object_id = OBJECT_ID('dbo.TblEmpAttendance')
)
BEGIN
    ALTER TABLE dbo.TblEmpAttendance
        ADD CONSTRAINT FK_TblEmpAttendance_EmpID
        FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
    PRINT N'  [+] FK_TblEmpAttendance_EmpID created';
END ELSE PRINT N'  [=] FK_TblEmpAttendance_EmpID already exists';

-- Index (EmpID, WorkDate) — non-unique (allow multiple records per day)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_TblEmpAttendance_EmpID_WorkDate'
      AND object_id = OBJECT_ID('dbo.TblEmpAttendance')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblEmpAttendance_EmpID_WorkDate
        ON dbo.TblEmpAttendance (EmpID, WorkDate);
    PRINT N'  [+] Index IX_TblEmpAttendance_EmpID_WorkDate created';
END ELSE PRINT N'  [=] Index IX_TblEmpAttendance_EmpID_WorkDate already exists';

PRINT N'--- Section 3 done ---';
PRINT N'';

-- ============================================================
-- SECTION 4: TblExpCatEmpMap (advance mapping)
--            NOTE: in the codebase the live table is TblExpCatEmpMap.
--            We create TblExpCatEmpMap if missing; the name
--            TblEmpAdvanceCatMap used in the request maps to same concept.
-- ============================================================
PRINT N'--- SECTION 4: TblExpCatEmpMap ---';

IF OBJECT_ID(N'dbo.TblExpCatEmpMap', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblExpCatEmpMap (
        ID           INT IDENTITY(1,1) NOT NULL,
        EmpID        INT NOT NULL,
        ExpINID      INT NOT NULL,
        TxnKind      NVARCHAR(20) NOT NULL CONSTRAINT DF_TblExpCatEmpMap_TxnKind DEFAULT N'advance',
        IsActive     BIT NOT NULL CONSTRAINT DF_TblExpCatEmpMap_IsActive DEFAULT 1,
        Notes        NVARCHAR(200) NULL,
        CreatedDate  DATETIME NOT NULL CONSTRAINT DF_TblExpCatEmpMap_CreatedDate DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL,
        CONSTRAINT PK_TblExpCatEmpMap PRIMARY KEY CLUSTERED (ID)
    );
    PRINT N'  [+] Created TblExpCatEmpMap';
END ELSE PRINT N'  [=] TblExpCatEmpMap already exists';

-- FK: EmpID -> TblEmp
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_TblExpCatEmpMap_EmpID'
      AND parent_object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
)
BEGIN
    ALTER TABLE dbo.TblExpCatEmpMap
        ADD CONSTRAINT FK_TblExpCatEmpMap_EmpID
        FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
    PRINT N'  [+] FK_TblExpCatEmpMap_EmpID created';
END ELSE PRINT N'  [=] FK_TblExpCatEmpMap_EmpID already exists';

-- FK: ExpINID -> TblExpINCat
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_TblExpCatEmpMap_ExpINID'
      AND parent_object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
)
BEGIN
    ALTER TABLE dbo.TblExpCatEmpMap
        ADD CONSTRAINT FK_TblExpCatEmpMap_ExpINID
        FOREIGN KEY (ExpINID) REFERENCES dbo.TblExpINCat(ExpINID);
    PRINT N'  [+] FK_TblExpCatEmpMap_ExpINID created';
END ELSE PRINT N'  [=] FK_TblExpCatEmpMap_ExpINID already exists';

-- Unique constraint (EmpID, ExpINID, TxnKind)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UQ_TblExpCatEmpMap_Emp_ExpIN_Kind'
      AND object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_TblExpCatEmpMap_Emp_ExpIN_Kind
        ON dbo.TblExpCatEmpMap (EmpID, ExpINID, TxnKind);
    PRINT N'  [+] Unique index UQ_TblExpCatEmpMap_Emp_ExpIN_Kind created';
END ELSE PRINT N'  [=] Unique index already exists';

PRINT N'--- Section 4 done ---';
PRINT N'';

-- ============================================================
-- SECTION 5: Safe backfill of known employee-advance mappings
-- ============================================================
PRINT N'--- SECTION 5: Employee advance mapping backfill ---';

DECLARE @mappings TABLE (
    EmpID            INT,
    ExpINID          INT,
    ExpectedCatName  NVARCHAR(100)
);
INSERT INTO @mappings VALUES
    (19, 52, N'سلف باسم'),
    (12, 33, N'سلفه ( ذياد )'),
    (16, 35, N'سلفة ( ذياد المساعد )'),
    (5,  8,  N'سلفة(كريم)'),
    (7,  34, N'سلفه ( محمد )'),
    (21, 44, N'سلفه ( هدى )'),
    (22, 7,  N'سلف (طارق)');

-- Report any mismatches before inserting
SELECT
    m.EmpID,
    e.EmpName,
    m.ExpINID,
    m.ExpectedCatName,
    c.CatName       AS ActualCatName,
    c.ExpINType,
    CASE WHEN e.EmpID   IS NULL THEN 'MISSING EmpID'   ELSE 'OK' END AS EmpCheck,
    CASE WHEN c.ExpINID IS NULL THEN 'MISSING ExpINID' ELSE 'OK' END AS CatCheck,
    CASE
        WHEN c.ExpINID IS NULL        THEN 'NO_CAT'
        WHEN c.CatName = m.ExpectedCatName THEN 'MATCH'
        ELSE 'NAME_DIFF'
    END AS CatNameCheck
FROM @mappings m
LEFT JOIN dbo.TblEmp      e ON e.EmpID   = m.EmpID
LEFT JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID;

-- Safe insert: only rows where both FK targets exist and no duplicate
INSERT INTO dbo.TblExpCatEmpMap (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
SELECT
    m.EmpID,
    m.ExpINID,
    N'advance',
    1,
    N'Backfill from payroll-migration.sql',
    GETDATE(),
    GETDATE()
FROM @mappings m
INNER JOIN dbo.TblEmp      e ON e.EmpID   = m.EmpID
INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.TblExpCatEmpMap x
    WHERE  x.EmpID   = m.EmpID
      AND  x.ExpINID = m.ExpINID
      AND  x.TxnKind = N'advance'
);

PRINT N'  [~] Inserted ' + CAST(@@ROWCOUNT AS NVARCHAR) + N' new mapping rows';

-- Post-insert verification
PRINT N'  --- Mapping report after backfill ---';
SELECT
    e.EmpID,
    e.EmpName,
    mp.ExpINID,
    cat.CatName     AS CatName,
    cat.ExpINType,
    mp.TxnKind,
    mp.IsActive
FROM      dbo.TblExpCatEmpMap mp
JOIN      dbo.TblEmp          e   ON e.EmpID   = mp.EmpID
JOIN      dbo.TblExpINCat     cat ON cat.ExpINID = mp.ExpINID
WHERE     mp.TxnKind = N'advance'
ORDER BY  e.EmpName;

PRINT N'--- Section 5 done ---';
PRINT N'';

-- ============================================================
-- SECTION 6: sp_GetMonthlyPayroll  (CREATE OR ALTER)
-- ============================================================
PRINT N'--- SECTION 6: sp_GetMonthlyPayroll ---';
GO

CREATE OR ALTER PROCEDURE dbo.sp_GetMonthlyPayroll
    @FromDate DATE,
    @ToDate   DATE          -- inclusive; converted internally to exclusive
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ToDateExclusive DATE = DATEADD(DAY, 1, @ToDate);

    -- ── CTE 1: Sales/work aggregated per employee ──────────────────────
    WITH SalesAgg AS (
        SELECT
            d.EmpID,
            COUNT(d.ID)              AS TotalServ,
            SUM(ISNULL(d.SValue, 0)) AS MonthlyWorkTotal
        FROM dbo.TblinvServDetail d
        JOIN dbo.TblinvServHead   h ON h.invID   = d.invID
                                    AND h.invType = d.invType
        JOIN dbo.TblPro           p ON p.ProID    = d.ProID
        JOIN dbo.TblCat           c ON c.CatID    = p.CatID
        WHERE h.invDate >= @FromDate
          AND h.invDate <  @ToDateExclusive
          AND (
                c.CatType = N'serv'
             OR (c.CatType = N'Pro'
                 AND d.invType IN (N'مبيعات', N'مبيعات بالكارت'))
              )
        GROUP BY d.EmpID
    ),

    -- ── CTE 2: Deductions/advances aggregated per employee ────────────
    DeductAgg AS (
        SELECT
            mp.EmpID,
            SUM(ISNULL(cm.GrandTolal, 0)) AS TotalEmployeeDeductions
        FROM      dbo.TblExpCatEmpMap mp
        JOIN      dbo.TblExpINCat     cat ON cat.ExpINID  = mp.ExpINID
                                          AND cat.ExpINType = N'مصروفات'
        LEFT JOIN dbo.TblCashMove     cm  ON cm.ExpINID   = mp.ExpINID
                                          AND cm.invDate  >= @FromDate
                                          AND cm.invDate  <  @ToDateExclusive
        WHERE mp.TxnKind = N'advance'
          AND mp.IsActive = 1
        GROUP BY mp.EmpID
    )

    -- ── Final result ───────────────────────────────────────────────────
    SELECT
        e.EmpID,
        e.EmpName,
        -- BaseSalary with fallback to legacy Salary column if present
        ISNULL(NULLIF(e.BaseSalary, 0),
               ISNULL(
                   (SELECT TOP 1 CAST(Salary AS DECIMAL(10,2))
                    FROM dbo.TblEmp s2
                    WHERE s2.EmpID = e.EmpID
                      AND EXISTS (
                            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                            WHERE TABLE_NAME='TblEmp' AND COLUMN_NAME='Salary'
                          )
                   ),
                   0
               )
        )                                                        AS BaseSalary,
        ISNULL(e.SalaryType, N'monthly')                        AS SalaryType,
        ISNULL(e.TargetCommissionPercent, 0)                    AS TargetCommissionPercent,
        ISNULL(e.TargetMinSales, 0)                             AS TargetMinSales,
        ISNULL(s.TotalServ, 0)                                  AS TotalServ,
        ISNULL(s.MonthlyWorkTotal, 0)                           AS MonthlyWorkTotal,

        -- Commission: only if target met
        CASE
            WHEN ISNULL(s.MonthlyWorkTotal, 0) >= ISNULL(e.TargetMinSales, 0)
            THEN ISNULL(s.MonthlyWorkTotal, 0)
                 * ISNULL(e.TargetCommissionPercent, 0) / 100.0
            ELSE 0
        END                                                     AS TargetCommissionAmount,

        ISNULL(d.TotalEmployeeDeductions, 0)                    AS TotalEmployeeDeductions,

        -- NetSalary
        ISNULL(NULLIF(e.BaseSalary, 0), 0)
        + CASE
              WHEN ISNULL(s.MonthlyWorkTotal, 0) >= ISNULL(e.TargetMinSales, 0)
              THEN ISNULL(s.MonthlyWorkTotal, 0)
                   * ISNULL(e.TargetCommissionPercent, 0) / 100.0
              ELSE 0
          END
        - ISNULL(d.TotalEmployeeDeductions, 0)                  AS NetSalary

    FROM      dbo.TblEmp  e
    LEFT JOIN SalesAgg    s ON s.EmpID = e.EmpID
    LEFT JOIN DeductAgg   d ON d.EmpID = e.EmpID
    WHERE ISNULL(e.isActive, 1)        = 1
      AND ISNULL(e.IsPayrollEnabled, 1) = 1
    ORDER BY e.EmpName;
END;
GO

PRINT N'  [+] sp_GetMonthlyPayroll created/updated';
PRINT N'--- Section 6 done ---';
PRINT N'';

-- ============================================================
-- SECTION 7: Validation queries
-- ============================================================
PRINT N'--- SECTION 7: Validation ---';

-- 7a. New columns present?
PRINT N'[7a] TblEmp payroll columns after migration:';
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME   = 'TblEmp'
  AND COLUMN_NAME IN (
        'BaseSalary','SalaryType','TargetCommissionPercent',
        'TargetMinSales','DefaultCheckInTime','DefaultCheckOutTime','IsPayrollEnabled'
      )
ORDER BY ORDINAL_POSITION;

-- 7b. Attendance table peek
PRINT N'[7b] TblEmpAttendance (top 5):';
SELECT TOP 5 * FROM dbo.TblEmpAttendance;

-- 7c. Advance mapping
PRINT N'[7c] TblExpCatEmpMap advance mappings:';
SELECT
    e.EmpID,
    e.EmpName,
    mp.ExpINID,
    cat.CatName     AS CatName,
    cat.ExpINType,
    mp.TxnKind,
    mp.IsActive
FROM      dbo.TblExpCatEmpMap mp
JOIN      dbo.TblEmp          e   ON e.EmpID   = mp.EmpID
JOIN      dbo.TblExpINCat     cat ON cat.ExpINID = mp.ExpINID
WHERE     mp.TxnKind = N'advance'
ORDER BY  e.EmpName;

-- 7d. Run payroll SP for current month
PRINT N'[7d] sp_GetMonthlyPayroll result (2026-04-01 to 2026-04-24):';
EXEC dbo.sp_GetMonthlyPayroll
    @FromDate = '2026-04-01',
    @ToDate   = '2026-04-24';

-- 7e. Deductions cross-check
PRINT N'[7e] Manual deductions cross-check:';
DECLARE @F DATE = '2026-04-01', @T DATE = '2026-04-24';
DECLARE @TX DATE = DATEADD(DAY, 1, @T);
SELECT
    e.EmpID,
    e.EmpName,
    SUM(ISNULL(cm.GrandTolal, 0)) AS TotalEmployeeDeductions
FROM      dbo.TblEmp          e
LEFT JOIN dbo.TblExpCatEmpMap mp  ON mp.EmpID   = e.EmpID  AND mp.IsActive = 1 AND mp.TxnKind = N'advance'
LEFT JOIN dbo.TblCashMove     cm  ON cm.ExpINID = mp.ExpINID
                                  AND cm.invDate >= @F
                                  AND cm.invDate <  @TX
LEFT JOIN dbo.TblExpINCat     cat ON cat.ExpINID  = cm.ExpINID
                                  AND cat.ExpINType = N'مصروفات'
WHERE ISNULL(e.isActive, 1) = 1
GROUP BY e.EmpID, e.EmpName
ORDER BY e.EmpName;

-- 7f. Employees with no advance mapping (should be empty after backfill)
PRINT N'[7f] Employees WITHOUT advance mapping:';
SELECT e.EmpID, e.EmpName
FROM   dbo.TblEmp e
WHERE  ISNULL(e.isActive, 1) = 1
  AND  NOT EXISTS (
         SELECT 1 FROM dbo.TblExpCatEmpMap m
         WHERE  m.EmpID   = e.EmpID
           AND  m.TxnKind = N'advance'
           AND  m.IsActive = 1
       )
ORDER BY e.EmpName;

PRINT N'';
PRINT N'============================================================';
PRINT N'  payroll-migration.sql  COMPLETE  ' + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT N'============================================================';
