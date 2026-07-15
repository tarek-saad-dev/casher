-- =============================================================================
-- Booking data impact audit (Phase 4) — READ ONLY
-- Target: dbo.Bookings / dbo.BookingServices
-- Active statuses align with scheduleIntervals ACTIVE_BOOKING_BLOCK_STATUSES
-- =============================================================================

-- 1) Schema (columns)
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'Bookings' AND COLUMN_NAME IN (
        'BookingID','BookingCode','ClientID','AssignedEmpID','BookingDate',
        'StartTime','EndTime','Status','Source','CreatedAt','CancelledAt'))
   OR (TABLE_NAME = 'BookingServices' AND COLUMN_NAME IN (
        'BookingID','DurationMinutes','ProID','EmpID'))
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 1b) Indexes touching conflict keys
SELECT i.name AS IndexName, i.is_unique, i.type_desc,
       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS Columns
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID('dbo.Bookings') AND i.name IS NOT NULL
GROUP BY i.name, i.is_unique, i.type_desc
ORDER BY i.name;

-- 2) Same-start active conflicts
WITH Active AS (
  SELECT BookingID, BookingCode, Source, AssignedEmpID, BookingDate,
         StartTime, EndTime, Status, ClientID, CreatedAt
  FROM dbo.Bookings
  WHERE LOWER(Status) IN ('confirmed','arrived','queued','in_service','in_progress')
    AND AssignedEmpID IS NOT NULL
)
SELECT a.*
FROM Active a
WHERE EXISTS (
  SELECT 1 FROM Active b
  WHERE b.AssignedEmpID = a.AssignedEmpID
    AND b.BookingDate = a.BookingDate
    AND CONVERT(time(0), b.StartTime) = CONVERT(time(0), a.StartTime)
    AND b.BookingID <> a.BookingID
)
ORDER BY a.AssignedEmpID, a.BookingDate, a.StartTime, a.BookingID;

-- 3) Absolute interval overlaps (EndTime <= StartTime ⇒ +1 day)
WITH Base AS (
  SELECT
    BookingID, BookingCode, AssignedEmpID, ClientID, Source, Status, CreatedAt, BookingDate,
    CAST(BookingDate AS datetime) + CAST(CONVERT(time(0), StartTime) AS datetime) AS StartAt,
    CASE
      WHEN CONVERT(time(0), ISNULL(EndTime, StartTime)) <= CONVERT(time(0), StartTime)
      THEN DATEADD(day, 1, CAST(BookingDate AS datetime)
           + CAST(CONVERT(time(0), ISNULL(EndTime, StartTime)) AS datetime))
      ELSE CAST(BookingDate AS datetime)
           + CAST(CONVERT(time(0), ISNULL(EndTime, StartTime)) AS datetime)
    END AS EndAt
  FROM dbo.Bookings
  WHERE LOWER(Status) IN ('confirmed','arrived','queued','in_service','in_progress')
    AND AssignedEmpID IS NOT NULL AND StartTime IS NOT NULL
)
SELECT
  a.BookingID AS A_BookingID, b.BookingID AS B_BookingID, a.AssignedEmpID AS Barber,
  a.Source AS A_Source, b.Source AS B_Source, a.Status AS A_Status, b.Status AS B_Status,
  a.StartAt AS A_StartAt, a.EndAt AS A_EndAt, b.StartAt AS B_StartAt, b.EndAt AS B_EndAt,
  a.BookingDate AS A_BookingDate, b.BookingDate AS B_BookingDate,
  a.CreatedAt AS A_CreatedAt, b.CreatedAt AS B_CreatedAt,
  DATEDIFF(minute,
    CASE WHEN a.StartAt > b.StartAt THEN a.StartAt ELSE b.StartAt END,
    CASE WHEN a.EndAt < b.EndAt THEN a.EndAt ELSE b.EndAt END) AS OverlapMinutes,
  CASE WHEN a.BookingDate <> b.BookingDate THEN 'cross_midnight_overlap'
       WHEN a.StartAt = b.StartAt THEN 'same_start'
       WHEN a.StartAt >= b.StartAt AND a.EndAt <= b.EndAt THEN 'full_containment_A_in_B'
       WHEN b.StartAt >= a.StartAt AND b.EndAt <= a.EndAt THEN 'full_containment_B_in_A'
       ELSE 'partial_overlap' END AS ConflictClass
FROM Base a
JOIN Base b
  ON a.AssignedEmpID = b.AssignedEmpID
 AND a.BookingID < b.BookingID
 AND a.StartAt < b.EndAt
 AND b.StartAt < a.EndAt
ORDER BY OverlapMinutes DESC;

-- 4) Suspected double day-offset (online early morning)
SELECT
  BookingID, BookingCode, ClientID, AssignedEmpID, BookingDate,
  CONVERT(varchar(8), CONVERT(time(0), StartTime), 108) AS StartTime,
  Status, Source, CreatedAt, CAST(CreatedAt AS date) AS CreatedDate,
  CASE
    WHEN CONVERT(time(0), StartTime) < '06:00:00'
     AND CAST(CreatedAt AS date) = DATEADD(day, -1, CAST(BookingDate AS date))
    THEN 'Strong candidate'
    WHEN CONVERT(time(0), StartTime) < '06:00:00'
    THEN 'Weak candidate'
    ELSE 'Cannot determine from DB'
  END AS Classification
FROM dbo.Bookings
WHERE LOWER(ISNULL(Source,'')) = 'online'
  AND StartTime IS NOT NULL
  AND CONVERT(time(0), StartTime) < '06:00:00'
  AND LOWER(Status) NOT IN ('cancelled','canceled','no_show')
ORDER BY BookingDate DESC;

-- 5) Status inventory (CI collation may collapse casing in GROUP BY)
SELECT Status AS ExactValue, LOWER(Status) AS LowerValue, COUNT(*) AS Cnt,
       SUM(CASE WHEN LOWER(ISNULL(Source,''))='online' THEN 1 ELSE 0 END) AS OnlineCnt,
       SUM(CASE WHEN LOWER(ISNULL(Source,''))='operations' THEN 1 ELSE 0 END) AS OperationsCnt
FROM dbo.Bookings
GROUP BY Status
ORDER BY COUNT(*) DESC;

-- 5b) Case-sensitive casing anomalies
SELECT BookingID, Status, Source
FROM dbo.Bookings
WHERE Status COLLATE Latin1_General_CS_AS <> LOWER(Status)
  AND LOWER(Status) IN ('cancelled','canceled','confirmed','completed','arrived','queued');

-- 6) Partial-plan cancelled candidates (online, nearby online within 120s)
SELECT c.BookingID AS CancelledID, c.ClientID, c.AssignedEmpID, c.BookingDate,
       CONVERT(varchar(8), CONVERT(time(0), c.StartTime), 108) AS StartTime,
       c.Status, c.CreatedAt, c.CancelledAt,
       (SELECT COUNT(*) FROM dbo.Bookings x
         WHERE x.ClientID = c.ClientID AND LOWER(ISNULL(x.Source,''))='online'
           AND x.BookingID <> c.BookingID
           AND ABS(DATEDIFF(second, x.CreatedAt, c.CreatedAt)) <= 120) AS NearbyWithin120s
FROM dbo.Bookings c
WHERE LOWER(ISNULL(c.Source,'')) = 'online'
  AND LOWER(c.Status) IN ('cancelled','canceled')
  AND EXISTS (
    SELECT 1 FROM dbo.Bookings x
    WHERE x.ClientID = c.ClientID AND LOWER(ISNULL(x.Source,''))='online'
      AND x.BookingID <> c.BookingID
      AND ABS(DATEDIFF(second, x.CreatedAt, c.CreatedAt)) <= 120
  )
ORDER BY c.CreatedAt DESC;

-- 7) Distributions
SELECT ISNULL(Source,'(null)') AS Source, Status, COUNT(*) AS Cnt
FROM dbo.Bookings GROUP BY Source, Status ORDER BY Source, Cnt DESC;

SELECT ISNULL(Source,'(null)') AS Source,
       DATEPART(hour, CONVERT(time(0), StartTime)) AS StartHour,
       COUNT(*) AS Cnt
FROM dbo.Bookings
WHERE StartTime IS NOT NULL
GROUP BY Source, DATEPART(hour, CONVERT(time(0), StartTime))
ORDER BY Source, StartHour;
