-- ====================================================
-- TASK 1 — Diagnose empId=13 from real DB
-- ====================================================

PRINT '====================================================';
PRINT '1. EMPLOYEE ROW (empId=13)';
PRINT '====================================================';

SELECT 
    EmpID,
    EmpName,
    Job,
    isActive,
    IsDeleted,
    EmpTel1,
    EmpTel2,
    EmpAddress,
    EmpSalary,
    EmpDate,
    IsBarber,
    CanBook
FROM dbo.TblEmp
WHERE EmpID = 13;

PRINT '';
PRINT '====================================================';
PRINT '2. WORK SCHEDULE ROWS (empId=13)';
PRINT '====================================================';

SELECT 
    ScheduleID,
    EmpID,
    DayOfWeek,
    WorkDay,
    StartTime,
    EndTime,
    IsOvernight,
    Notes
FROM dbo.TblEmpWorkSchedule
WHERE EmpID = 13
ORDER BY DayOfWeek, WorkDay;

PRINT '';
PRINT '====================================================';
PRINT '3. DAY OFF ROWS (empId=13)';
PRINT '====================================================';

SELECT 
    DayOffID,
    EmpID,
    OffDate,
    DayOfWeek,
    Reason,
    IsApproved,
    CreatedAt,
    StartDate,
    EndDate,
    IsRecurring
FROM dbo.TblEmpDayOff
WHERE EmpID = 13
ORDER BY OffDate;

PRINT '';
PRINT '====================================================';
PRINT '4. SERVICE ROW (serviceId=9)';
PRINT '====================================================';

SELECT 
    ProID,
    ProName,
    DurationMinutes,
    SPrice1,
    SPrice2,
    SPrice3,
    Notes,
    IsActive,
    CategoryID
FROM dbo.TblPro
WHERE ProID = 9;

PRINT '';
PRINT '====================================================';
PRINT '5. QUEUE BOOKING SETTINGS';
PRINT '====================================================';

SELECT TOP 1
    SettingsID,
    IsEnabled,
    MinNoticeMinutes,
    MaxAdvanceDays,
    DefaultSlotIntervalMinutes,
    MaxBookingsPerSlot,
    AllowMultipleServices,
    UpdatedAt
FROM dbo.QueueBookingSettings;

PRINT '';
PRINT '====================================================';
PRINT '6. CHECK IF empId=13 APPEARS IN BARBER LIST API';
PRINT '====================================================';

-- This simulates the barber list API query
SELECT 
    e.EmpID,
    e.EmpName,
    e.Job,
    e.isActive,
    e.IsDeleted,
    CASE 
        WHEN e.isActive = 1 AND (e.IsDeleted = 0 OR e.IsDeleted IS NULL) 
        THEN 'WOULD APPEAR in /api/public/booking/barbers'
        ELSE 'WOULD NOT APPEAR (inactive or deleted)'
    END AS ApiVisibility
FROM dbo.TblEmp e
WHERE e.EmpID = 13
AND e.Job LIKE N'%حلاق%'
AND e.isActive = 1
AND (e.IsDeleted = 0 OR e.IsDeleted IS NULL);

PRINT '';
PRINT '====================================================';
PRINT '7. DAY-OF-WEEK MAPPING VERIFICATION';
PRINT '====================================================';

-- Create a temp table with the dates we care about
DECLARE @Dates TABLE (
    DateStr VARCHAR(10),
    DateObj DATE,
    JsDayNumber INT,
    JsDayName VARCHAR(20),
    DbDayNumber INT,
    ArabicLabel VARCHAR(20)
);

INSERT INTO @Dates VALUES
('2026-05-18', '2026-05-18', 1, 'Monday',    1, 'الاثنين'),
('2026-05-19', '2026-05-19', 2, 'Tuesday',   2, 'الثلاثاء'),
('2026-05-20', '2026-05-20', 3, 'Wednesday', 3, 'الأربعاء'),
('2026-05-21', '2026-05-21', 4, 'Thursday',  4, 'الخميس'),
('2026-05-22', '2026-05-22', 5, 'Friday',    5, 'الجمعة'),
('2026-05-23', '2026-05-23', 6, 'Saturday',  6, 'السبت'),
('2026-05-24', '2026-05-24', 0, 'Sunday',    0, 'الأحد');

SELECT 
    d.DateStr,
    d.ArabicLabel,
    d.JsDayNumber AS JsGetDay,
    d.DbDayNumber AS ExpectedDbDay,
    -- Check if schedule exists for this day
    CASE WHEN ws.ScheduleID IS NOT NULL THEN 'YES' ELSE 'NO' END AS HasSchedule,
    ws.StartTime,
    ws.EndTime,
    ws.IsOvernight,
    -- Check if day off exists
    CASE WHEN do.DayOffID IS NOT NULL THEN 'YES' ELSE 'NO' END AS HasDayOff,
    do.OffDate,
    do.Reason AS DayOffReason,
    do.IsRecurring,
    -- Summary
    CASE 
        WHEN do.DayOffID IS NOT NULL THEN 'DAY_OFF (specific date)'
        WHEN ws.ScheduleID IS NULL THEN 'NO_WORKING_SCHEDULE'
        ELSE 'Has schedule: ' + CONVERT(VARCHAR(5), ws.StartTime) + ' - ' + CONVERT(VARCHAR(5), ws.EndTime)
    END AS ExpectedApiResult
FROM @Dates d
LEFT JOIN dbo.TblEmpWorkSchedule ws 
    ON ws.EmpID = 13 
    AND ws.DayOfWeek = d.DbDayNumber
LEFT JOIN dbo.TblEmpDayOff do 
    ON do.EmpID = 13 
    AND do.OffDate = d.DateObj
ORDER BY d.DateObj;

PRINT '';
PRINT '====================================================';
PRINT '8. TblEmpDayOff STRUCTURE ANALYSIS';
PRINT '====================================================';

-- Check column names and types
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TblEmpDayOff'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '====================================================';
PRINT '9. SAMPLE DAY OFF DATA (all employees, recent)';
PRINT '====================================================';

SELECT TOP 10
    DayOffID,
    EmpID,
    OffDate,
    DayOfWeek,
    Reason,
    IsApproved,
    CreatedAt,
    StartDate,
    EndDate,
    IsRecurring,
    '---' AS Analysis,
    CASE 
        WHEN OffDate IS NOT NULL AND DayOfWeek IS NULL THEN 'SPECIFIC_DATE_ONLY'
        WHEN DayOfWeek IS NOT NULL AND OffDate IS NULL THEN 'WEEKLY_RECURRING'
        WHEN OffDate IS NOT NULL AND DayOfWeek IS NOT NULL THEN 'BOTH_FIELDS_SET'
        ELSE 'UNKNOWN_PATTERN'
    END AS DataPattern
FROM dbo.TblEmpDayOff
WHERE OffDate >= '2026-01-01' OR OffDate IS NULL
ORDER BY CreatedAt DESC;

PRINT '';
PRINT '====================================================';
PRINT '10. CHECK FOR ANY BARBER WITH SCHEDULE (for comparison)';
PRINT '====================================================';

SELECT TOP 5
    e.EmpID,
    e.EmpName,
    COUNT(ws.ScheduleID) AS ScheduleCount
FROM dbo.TblEmp e
JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID = e.EmpID
WHERE e.Job LIKE N'%حلاق%'
    AND e.isActive = 1
    AND (e.IsDeleted = 0 OR e.IsDeleted IS NULL)
GROUP BY e.EmpID, e.EmpName
ORDER BY ScheduleCount DESC;
