-- ============================================================
--  employees-advance-setup.sql
--  Auto-create advance expense category + mapping for employees
--  Safe to run multiple times (idempotent)
--  Target DB: HawaiDB
-- ============================================================

SET NOCOUNT ON;
PRINT N'=== Starting employees-advance-setup.sql ===';

-- ============================================================
-- SECTION 1: Verify required tables exist
-- ============================================================
IF OBJECT_ID(N'dbo.TblEmp', N'U') IS NULL
    RAISERROR(N'ERROR: dbo.TblEmp not found. Aborting.', 16, 1);
IF OBJECT_ID(N'dbo.TblExpINCat', N'U') IS NULL
    RAISERROR(N'ERROR: dbo.TblExpINCat not found. Aborting.', 16, 1);
IF OBJECT_ID(N'dbo.TblExpCatEmpMap', N'U') IS NULL
    RAISERROR(N'ERROR: dbo.TblExpCatEmpMap not found. Aborting.', 16, 1);

PRINT N'[OK] All required tables found.';

-- ============================================================
-- SECTION 2: Inspect actual columns of key tables
--            (for documentation/debugging — does not modify anything)
-- ============================================================
PRINT N'--- TblExpINCat columns ---';
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblExpINCat'
ORDER BY ORDINAL_POSITION;

PRINT N'--- TblExpCatEmpMap columns ---';
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblExpCatEmpMap'
ORDER BY ORDINAL_POSITION;

PRINT N'--- TblEmp columns ---';
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmp'
ORDER BY ORDINAL_POSITION;

-- ============================================================
-- SECTION 3: Stored Procedure  usp_CreateEmployeeAdvanceMapping
--            Called by: AFTER INSERT Trigger + API route
-- ============================================================
PRINT N'--- Creating/Replacing usp_CreateEmployeeAdvanceMapping ---';

IF OBJECT_ID(N'dbo.usp_CreateEmployeeAdvanceMapping', N'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_CreateEmployeeAdvanceMapping;
GO

CREATE PROCEDURE dbo.usp_CreateEmployeeAdvanceMapping
    @EmpID   INT,
    @EmpName NVARCHAR(200),
    @NewExpINID INT OUTPUT   -- returns the ExpINID that was created or already existed
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CatName   NVARCHAR(200) = N'سلفه ( ' + @EmpName + N' )';
    DECLARE @ExpINType NVARCHAR(50)  = N'مصروفات';   -- matches existing rows in TblExpINCat
    DECLARE @ExpINID   INT;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ── Step 1: Create category if it doesn't exist ──────────────────
        SELECT @ExpINID = ExpINID
        FROM   dbo.TblExpINCat
        WHERE  CatName = @CatName
          AND  ExpINType = @ExpINType;

        IF @ExpINID IS NULL
        BEGIN
            INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
            VALUES (@CatName, @ExpINType);

            SET @ExpINID = SCOPE_IDENTITY();
            PRINT N'  [+] Created TblExpINCat: ExpINID=' + CAST(@ExpINID AS NVARCHAR)
                  + N'  CatName=' + @CatName;
        END
        ELSE
        BEGIN
            PRINT N'  [=] TblExpINCat already exists: ExpINID=' + CAST(@ExpINID AS NVARCHAR)
                  + N'  CatName=' + @CatName;
        END

        -- ── Step 2: Create advance mapping if it doesn't exist ───────────
        IF NOT EXISTS (
            SELECT 1 FROM dbo.TblExpCatEmpMap
            WHERE  EmpID    = @EmpID
              AND  ExpINID  = @ExpINID
              AND  TxnKind  = N'advance'
        )
        BEGIN
            INSERT INTO dbo.TblExpCatEmpMap
                (EmpID, ExpINID, TxnKind, IsActive, Notes, CreatedDate, ModifiedDate)
            VALUES
                (@EmpID, @ExpINID, N'advance', 1,
                 N'Auto map on employee creation', GETDATE(), GETDATE());

            PRINT N'  [+] Created advance mapping: EmpID=' + CAST(@EmpID AS NVARCHAR)
                  + N'  ExpINID=' + CAST(@ExpINID AS NVARCHAR);
        END
        ELSE
        BEGIN
            PRINT N'  [=] Advance mapping already exists for EmpID=' + CAST(@EmpID AS NVARCHAR);
        END

        COMMIT TRANSACTION;
        SET @NewExpINID = @ExpINID;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        PRINT N'  [ERROR] usp_CreateEmployeeAdvanceMapping: ' + @msg;
        THROW;
    END CATCH
END;
GO

PRINT N'[OK] Stored procedure created.';

-- ============================================================
-- SECTION 4: AFTER INSERT Trigger on dbo.TblEmp
--            Fires automatically for every new employee row
-- ============================================================
PRINT N'--- Creating/Replacing trg_TblEmp_AfterInsert ---';

IF OBJECT_ID(N'dbo.trg_TblEmp_AfterInsert', N'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_TblEmp_AfterInsert;
GO

CREATE TRIGGER dbo.trg_TblEmp_AfterInsert
ON  dbo.TblEmp
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Handle multi-row inserts safely via cursor
    DECLARE @EmpID   INT;
    DECLARE @EmpName NVARCHAR(200);
    DECLARE @NewExpINID INT;

    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT EmpID, EmpName FROM inserted;

    OPEN cur;
    FETCH NEXT FROM cur INTO @EmpID, @EmpName;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        BEGIN TRY
            EXEC dbo.usp_CreateEmployeeAdvanceMapping
                @EmpID      = @EmpID,
                @EmpName    = @EmpName,
                @NewExpINID = @NewExpINID OUTPUT;
        END TRY
        BEGIN CATCH
            -- Log but do not fail the INSERT
            PRINT N'[TRIGGER WARNING] Could not create advance mapping for EmpID='
                  + CAST(@EmpID AS NVARCHAR) + N': ' + ERROR_MESSAGE();
        END CATCH

        FETCH NEXT FROM cur INTO @EmpID, @EmpName;
    END

    CLOSE cur;
    DEALLOCATE cur;
END;
GO

PRINT N'[OK] Trigger created.';

-- ============================================================
-- SECTION 5: Backfill — fix existing employees without mapping
-- ============================================================
PRINT N'--- Backfilling existing employees without advance mapping ---';

DECLARE @EmpID   INT;
DECLARE @EmpName NVARCHAR(200);
DECLARE @NewExpINID INT;
DECLARE @Count   INT = 0;

DECLARE backfill_cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT e.EmpID, e.EmpName
    FROM   dbo.TblEmp e
    WHERE  NOT EXISTS (
        SELECT 1
        FROM   dbo.TblExpCatEmpMap m
        WHERE  m.EmpID   = e.EmpID
          AND  m.TxnKind = N'advance'
    );

OPEN backfill_cur;
FETCH NEXT FROM backfill_cur INTO @EmpID, @EmpName;

WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC dbo.usp_CreateEmployeeAdvanceMapping
        @EmpID      = @EmpID,
        @EmpName    = @EmpName,
        @NewExpINID = @NewExpINID OUTPUT;

    SET @Count = @Count + 1;
    FETCH NEXT FROM backfill_cur INTO @EmpID, @EmpName;
END

CLOSE backfill_cur;
DEALLOCATE backfill_cur;

PRINT N'[OK] Backfill complete. Employees processed: ' + CAST(@Count AS NVARCHAR);

-- ============================================================
-- SECTION 6: Verification Queries
-- ============================================================
PRINT N'--- Verification: All employees with their advance category ---';
SELECT
    e.EmpID,
    e.EmpName,
    cat.ExpINID,
    cat.CatName,
    m.TxnKind,
    m.IsActive,
    m.Notes
FROM      dbo.TblEmp e
LEFT JOIN dbo.TblExpCatEmpMap m   ON e.EmpID   = m.EmpID   AND m.TxnKind = N'advance'
LEFT JOIN dbo.TblExpINCat     cat ON m.ExpINID  = cat.ExpINID
ORDER BY  e.EmpName;

PRINT N'--- Verification: Employees still WITHOUT advance mapping ---';
SELECT e.EmpID, e.EmpName
FROM   dbo.TblEmp e
WHERE  NOT EXISTS (
    SELECT 1 FROM dbo.TblExpCatEmpMap m
    WHERE  m.EmpID = e.EmpID AND m.TxnKind = N'advance'
);

PRINT N'--- Verification: Duplicate advance mappings (should be empty) ---';
SELECT EmpID, ExpINID, TxnKind, COUNT(*) AS DupCount
FROM   dbo.TblExpCatEmpMap
WHERE  TxnKind = N'advance'
GROUP  BY EmpID, ExpINID, TxnKind
HAVING COUNT(*) > 1;

PRINT N'=== employees-advance-setup.sql completed successfully ===';
