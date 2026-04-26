-- ============================================================
-- Employee Profile and Schedule Migration
-- Cut Salon POS - Safe, Idempotent Migration
-- ============================================================

PRINT N'=== Employee Profile and Schedule Migration ===';

-- ============================================================
-- 1) Add Personal Information Columns to TblEmp
-- ============================================================

PRINT N'-- 1) Adding Personal Information Columns to TblEmp --';

-- NationalID
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'NationalID'
)
BEGIN
    PRINT N'  [+] Adding NationalID column';
    ALTER TABLE dbo.TblEmp ADD NationalID NVARCHAR(50) NULL;
END
ELSE
BEGIN
    PRINT N'  [=] NationalID column already exists';
END

-- Address
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'Address'
)
BEGIN
    PRINT N'  [+] Adding Address column';
    ALTER TABLE dbo.TblEmp ADD Address NVARCHAR(250) NULL;
END
ELSE
BEGIN
    PRINT N'  [=] Address column already exists';
END

-- EmergencyContactName
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactName'
)
BEGIN
    PRINT N'  [+] Adding EmergencyContactName column';
    ALTER TABLE dbo.TblEmp ADD EmergencyContactName NVARCHAR(100) NULL;
END
ELSE
BEGIN
    PRINT N'  [=] EmergencyContactName column already exists';
END

-- EmergencyContactPhone
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'EmergencyContactPhone'
)
BEGIN
    PRINT N'  [+] Adding EmergencyContactPhone column';
    ALTER TABLE dbo.TblEmp ADD EmergencyContactPhone NVARCHAR(30) NULL;
END
ELSE
BEGIN
    PRINT N'  [=] EmergencyContactPhone column already exists';
END

-- BirthDate
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'BirthDate'
)
BEGIN
    PRINT N'  [+] Adding BirthDate column';
    ALTER TABLE dbo.TblEmp ADD BirthDate DATE NULL;
END
ELSE
BEGIN
    PRINT N'  [=] BirthDate column already exists';
END

-- HireDate
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'HireDate'
)
BEGIN
    PRINT N'  [+] Adding HireDate column';
    ALTER TABLE dbo.TblEmp ADD HireDate DATE NULL;
END
ELSE
BEGIN
    PRINT N'  [=] HireDate column already exists';
END

-- PersonalNotes
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'PersonalNotes'
)
BEGIN
    PRINT N'  [+] Adding PersonalNotes column';
    ALTER TABLE dbo.TblEmp ADD PersonalNotes NVARCHAR(500) NULL;
END
ELSE
BEGIN
    PRINT N'  [=] PersonalNotes column already exists';
END

-- ============================================================
-- 2) Create TblEmpWorkSchedule Table
-- ============================================================

PRINT N'-- 2) Creating TblEmpWorkSchedule Table --';

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpWorkSchedule')
BEGIN
    PRINT N'  [+] Creating TblEmpWorkSchedule table';
    
    CREATE TABLE dbo.TblEmpWorkSchedule (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        EmpID INT NOT NULL,
        DayOfWeek TINYINT NOT NULL,
        IsWorkingDay BIT NOT NULL DEFAULT 1,
        StartTime TIME NULL,
        EndTime TIME NULL,
        BreakStartTime TIME NULL,
        BreakEndTime TIME NULL,
        Notes NVARCHAR(200) NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL,
        CONSTRAINT CK_TblEmpWorkSchedule_DayOfWeek CHECK (DayOfWeek BETWEEN 0 AND 6)
    );
    
    PRINT N'  [+] Creating foreign key constraint';
    ALTER TABLE dbo.TblEmpWorkSchedule 
    ADD CONSTRAINT FK_TblEmpWorkSchedule_TblEmp 
    FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
    
    PRINT N'  [+] Creating unique index on (EmpID, DayOfWeek)';
    CREATE UNIQUE INDEX UQ_TblEmpWorkSchedule_Emp_Day 
    ON dbo.TblEmpWorkSchedule (EmpID, DayOfWeek);
    
    PRINT N'  [+] Creating index on EmpID';
    CREATE INDEX IX_TblEmpWorkSchedule_EmpID 
    ON dbo.TblEmpWorkSchedule (EmpID);
END
ELSE
BEGIN
    PRINT N'  [=] TblEmpWorkSchedule table already exists';
    
    -- Check and add missing indexes if needed
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_TblEmpWorkSchedule_Emp_Day' AND object_id = OBJECT_ID('dbo.TblEmpWorkSchedule'))
    BEGIN
        PRINT N'  [+] Creating missing unique index on (EmpID, DayOfWeek)';
        CREATE UNIQUE INDEX UQ_TblEmpWorkSchedule_Emp_Day 
        ON dbo.TblEmpWorkSchedule (EmpID, DayOfWeek);
    END
    
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TblEmpWorkSchedule_EmpID' AND object_id = OBJECT_ID('dbo.TblEmpWorkSchedule'))
    BEGIN
        PRINT N'  [+] Creating missing index on EmpID';
        CREATE INDEX IX_TblEmpWorkSchedule_EmpID 
        ON dbo.TblEmpWorkSchedule (EmpID);
    END
END

-- ============================================================
-- 3) Create TblEmpDayOff Table
-- ============================================================

PRINT N'-- 3) Creating TblEmpDayOff Table --';

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpDayOff')
BEGIN
    PRINT N'  [+] Creating TblEmpDayOff table';
    
    CREATE TABLE dbo.TblEmpDayOff (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        EmpID INT NOT NULL,
        OffDate DATE NOT NULL,
        OffType NVARCHAR(30) NOT NULL DEFAULT N'day_off',
        Reason NVARCHAR(200) NULL,
        IsPaid BIT NOT NULL DEFAULT 0,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL,
        CONSTRAINT CK_TblEmpDayOff_OffType CHECK (OffType IN (N'day_off', N'sick', N'emergency', N'annual'))
    );
    
    PRINT N'  [+] Creating foreign key constraint';
    ALTER TABLE dbo.TblEmpDayOff 
    ADD CONSTRAINT FK_TblEmpDayOff_TblEmp 
    FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);
    
    PRINT N'  [+] Creating unique index on (EmpID, OffDate)';
    CREATE UNIQUE INDEX UQ_TblEmpDayOff_Emp_Date 
    ON dbo.TblEmpDayOff (EmpID, OffDate) 
    WHERE IsDeleted = 0;
    
    PRINT N'  [+] Creating index on EmpID and OffDate';
    CREATE INDEX IX_TblEmpDayOff_EmpID_OffDate 
    ON dbo.TblEmpDayOff (EmpID, OffDate);
END
ELSE
BEGIN
    PRINT N'  [=] TblEmpDayOff table already exists';
    
    -- Check and add IsDeleted column if missing
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'TblEmpDayOff' AND COLUMN_NAME = 'IsDeleted'
    )
    BEGIN
        PRINT N'  [+] Adding IsDeleted column to TblEmpDayOff';
        ALTER TABLE dbo.TblEmpDayOff ADD IsDeleted BIT NOT NULL DEFAULT 0;
    END
    
    -- Check and add missing indexes if needed
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_TblEmpDayOff_Emp_Date' AND object_id = OBJECT_ID('dbo.TblEmpDayOff'))
    BEGIN
        PRINT N'  [+] Creating missing unique index on (EmpID, OffDate)';
        CREATE UNIQUE INDEX UQ_TblEmpDayOff_Emp_Date 
        ON dbo.TblEmpDayOff (EmpID, OffDate) 
        WHERE IsDeleted = 0;
    END
    
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TblEmpDayOff_EmpID_OffDate' AND object_id = OBJECT_ID('dbo.TblEmpDayOff'))
    BEGIN
        PRINT N'  [+] Creating missing index on EmpID and OffDate';
        CREATE INDEX IX_TblEmpDayOff_EmpID_OffDate 
        ON dbo.TblEmpDayOff (EmpID, OffDate);
    END
END

-- ============================================================
-- 4) Backfill Work Schedule for Existing Employees
-- ============================================================

PRINT N'-- 4) Backfilling Work Schedule for Existing Employees --';

DECLARE @EmployeesBackfilled INT = 0;
DECLARE @TotalEmployees INT = 0;

-- Get total active employees
SELECT @TotalEmployees = COUNT(*) 
FROM dbo.TblEmp 
WHERE ISNULL(isActive, 1) = 1;

PRINT N'  [i] Total active employees: ' + CAST(@TotalEmployees AS NVARCHAR);

-- Backfill schedule for employees who don't have complete 7-day schedule
INSERT INTO dbo.TblEmpWorkSchedule (EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime, Notes, CreatedAt)
SELECT 
    e.EmpID,
    days.DayNum,
    CASE 
        WHEN days.DayNum = 5 THEN 0  -- Friday is day off
        ELSE 1
    END AS IsWorkingDay,
    CASE 
        WHEN days.DayNum = 5 THEN NULL
        WHEN ISNULL(e.DefaultCheckInTime, '') != '' THEN e.DefaultCheckInTime
        ELSE '12:00'
    END AS StartTime,
    CASE 
        WHEN days.DayNum = 5 THEN NULL
        WHEN ISNULL(e.DefaultCheckOutTime, '') != '' THEN e.DefaultCheckOutTime
        ELSE '02:00'
    END AS EndTime,
    CASE 
        WHEN days.DayNum = 5 THEN N'جمعة - إجازة أسبوعية'
        ELSE N'يوم عمل عادي'
    END AS Notes,
    GETDATE() AS CreatedAt
FROM dbo.TblEmp e
CROSS JOIN (
    VALUES (0), (1), (2), (3), (4), (5), (6)
) AS days(DayNum)
WHERE ISNULL(e.isActive, 1) = 1
  AND NOT EXISTS (
    SELECT 1 FROM dbo.TblEmpWorkSchedule ws 
    WHERE ws.EmpID = e.EmpID AND ws.DayOfWeek = days.DayNum
  );

SET @EmployeesBackfilled = @@ROWCOUNT / 7; -- Divide by 7 since each employee gets 7 days

PRINT N'  [~] Backfilled schedule for ' + CAST(@EmployeesBackfilled AS NVARCHAR) + N' employees';

-- ============================================================
-- 5) Validation Queries
-- ============================================================

PRINT N'-- 5) Validation Results --';

-- Check work schedule
PRINT N'-- Work Schedule Sample --';
SELECT TOP 10 
    ws.EmpID,
    e.EmpName,
    ws.DayOfWeek,
    CASE ws.DayOfWeek
        WHEN 0 THEN N'الأحد'
        WHEN 1 THEN N'الاثنين'
        WHEN 2 THEN N'الثلاثاء'
        WHEN 3 THEN N'الأربعاء'
        WHEN 4 THEN N'الخميس'
        WHEN 5 THEN N'الجمعة'
        WHEN 6 THEN N'السبت'
    END AS DayName,
    ws.IsWorkingDay,
    ws.StartTime,
    ws.EndTime,
    ws.Notes
FROM dbo.TblEmpWorkSchedule ws
JOIN dbo.TblEmp e ON e.EmpID = ws.EmpID
ORDER BY ws.EmpID, ws.DayOfWeek;

-- Check days off
PRINT N'-- Days Off Sample --';
SELECT TOP 5 
    de.EmpID,
    e.EmpName,
    de.OffDate,
    de.OffType,
    de.Reason,
    de.IsPaid,
    de.IsDeleted
FROM dbo.TblEmpDayOff de
JOIN dbo.TblEmp e ON e.EmpID = de.EmpID
WHERE de.IsDeleted = 0
ORDER BY de.OffDate DESC;

-- Check schedule completeness
PRINT N'-- Schedule Completeness Check --';
SELECT
    e.EmpID,
    e.EmpName,
    COUNT(s.ID) AS ScheduleDays,
    CASE 
        WHEN COUNT(s.ID) = 7 THEN N'مكتمل'
        ELSE N'ناقص'
    END AS Status
FROM dbo.TblEmp e
LEFT JOIN dbo.TblEmpWorkSchedule s ON s.EmpID = e.EmpID
WHERE ISNULL(e.isActive, 1) = 1
GROUP BY e.EmpID, e.EmpName
ORDER BY e.EmpName;

-- Check new columns in TblEmp
PRINT N'-- New Employee Columns Check --';
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'TblEmp' 
  AND COLUMN_NAME IN (
    'NationalID', 'Address', 'EmergencyContactName', 
    'EmergencyContactPhone', 'BirthDate', 'HireDate', 'PersonalNotes'
  )
ORDER BY COLUMN_NAME;

PRINT N'=== Migration Complete ===';
PRINT N'';
PRINT N'Migration Summary:';
PRINT N'- Added personal info columns to TblEmp';
PRINT N'- Created TblEmpWorkSchedule with 7 days for each employee';
PRINT N'- Created TblEmpDayOff for employee day offs';
PRINT N'- Backfilled schedule for ' + CAST(@EmployeesBackfilled AS NVARCHAR) + N' employees';
PRINT N'- All operations are idempotent and safe to re-run';
