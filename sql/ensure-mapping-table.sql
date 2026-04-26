-- ============================================================
-- Ensure TblExpCatEmpMap Table Structure
-- Cut Salon POS - Employee Finance Mapping
-- ============================================================

PRINT N'=== Ensuring TblExpCatEmpMap Table Structure ===';

-- Check if table exists
IF OBJECT_ID(N'dbo.TblExpCatEmpMap', N'U') IS NULL
BEGIN
    PRINT N'  [+] Creating TblExpCatEmpMap table...';
    
    CREATE TABLE dbo.TblExpCatEmpMap (
        ID           INT IDENTITY(1,1) NOT NULL,
        EmpID        INT NOT NULL,
        ExpINID      INT NOT NULL,
        TxnKind      NVARCHAR(20) NOT NULL CONSTRAINT DF_TblExpCatEmpMap_TxnKind DEFAULT N'advance',
        IsActive     BIT NOT NULL CONSTRAINT DF_TblExpCatEmpMap_IsActive DEFAULT 1,
        Notes        NVARCHAR(200) NULL,
        CreatedDate  DATETIME NOT NULL CONSTRAINT DF_TblExpCatEmpMap_CreatedDate DEFAULT GETDATE(),
        ModifiedDate DATETIME NOT NULL CONSTRAINT DF_TblExpCatEmpMap_ModifiedDate DEFAULT GETDATE(),
        CONSTRAINT PK_TblExpCatEmpMap PRIMARY KEY CLUSTERED (ID)
    );
    
    PRINT N'  [+] TblExpCatEmpMap table created successfully';
END
ELSE
BEGIN
    PRINT N'  [=] TblExpCatEmpMap table already exists';
    
    -- Check if ModifiedDate column allows NULL and fix if needed
    IF EXISTS (
        SELECT 1 
        FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.TblExpCatEmpMap') 
          AND name = 'ModifiedDate' 
          AND is_nullable = 1
    )
    BEGIN
        PRINT N'  [!] ModifiedDate column is nullable - fixing...';
        
        -- Update any NULL values
        UPDATE dbo.TblExpCatEmpMap 
        SET ModifiedDate = GETDATE() 
        WHERE ModifiedDate IS NULL;
        
        -- Alter column to NOT NULL
        ALTER TABLE dbo.TblExpCatEmpMap 
        ALTER COLUMN ModifiedDate DATETIME NOT NULL;
        
        PRINT N'  [+] ModifiedDate column fixed to NOT NULL';
    END;
END

-- Check and create Foreign Key for EmpID
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_TblExpCatEmpMap_EmpID'
      AND parent_object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
)
BEGIN
    PRINT N'  [+] Creating FK for EmpID...';
    ALTER TABLE dbo.TblExpCatEmpMap
    ADD CONSTRAINT FK_TblExpCatEmpMap_EmpID FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
    PRINT N'  [+] FK_TblExpCatEmpMap_EmpID created';
END
ELSE
BEGIN
    PRINT N'  [=] FK_TblExpCatEmpMap_EmpID already exists';
END

-- Check and create Foreign Key for ExpINID
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_TblExpCatEmpMap_ExpINID'
      AND parent_object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
)
BEGIN
    PRINT N'  [+] Creating FK for ExpINID...';
    ALTER TABLE dbo.TblExpCatEmpMap
    ADD CONSTRAINT FK_TblExpCatEmpMap_ExpINID FOREIGN KEY (ExpINID) REFERENCES dbo.TblExpINCat(ExpINID);
    PRINT N'  [+] FK_TblExpCatEmpMap_ExpINID created';
END
ELSE
BEGIN
    PRINT N'  [=] FK_TblExpCatEmpMap_ExpINID already exists';
END

-- Check and create Unique Index for EmpID, ExpINID, TxnKind
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UQ_TblExpCatEmpMap_Emp_ExpIN_Kind'
      AND object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
)
BEGIN
    PRINT N'  [+] Creating Unique Index for (EmpID, ExpINID, TxnKind)...';
    CREATE UNIQUE INDEX UQ_TblExpCatEmpMap_Emp_ExpIN_Kind 
    ON dbo.TblExpCatEmpMap (EmpID, ExpINID, TxnKind)
    WHERE IsActive = 1;
    PRINT N'  [+] UQ_TblExpCatEmpMap_Emp_ExpIN_Kind created';
END
ELSE
BEGIN
    PRINT N'  [=] UQ_TblExpCatEmpMap_Emp_ExpIN_Kind already exists';
END

-- Show current table structure
PRINT N'-- Current Table Structure --';
SELECT 
    c.name AS ColumnName,
    t.name AS DataType,
    c.max_length AS MaxLength,
    c.is_nullable AS IsNullable,
    c.default_object_id > 0 AS HasDefault
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.TblExpCatEmpMap')
ORDER BY c.column_id;

-- Show current data count
PRINT N'-- Current Data Count --';
SELECT 
    TxnKind,
    COUNT(*) AS TotalRows,
    COUNT(CASE WHEN IsActive = 1 THEN 1 END) AS ActiveRows
FROM dbo.TblExpCatEmpMap
GROUP BY TxnKind
ORDER BY TxnKind;

PRINT N'=== Table Structure Complete ===';
