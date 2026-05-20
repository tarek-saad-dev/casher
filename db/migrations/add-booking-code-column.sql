-- ============================================================
--  Add BookingCode to dbo.Bookings
--  Idempotent — safe to run multiple times
-- ============================================================

-- 1. Add column if missing
IF COL_LENGTH('dbo.Bookings', 'BookingCode') IS NULL
BEGIN
  ALTER TABLE dbo.Bookings
  ADD BookingCode NVARCHAR(30) NULL;
  PRINT 'Added column: Bookings.BookingCode';
END
ELSE
  PRINT 'Column already exists: Bookings.BookingCode';
GO

-- 2. Add unique filtered index if missing
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'UX_Bookings_BookingCode'
    AND object_id = OBJECT_ID('dbo.Bookings')
)
BEGIN
  CREATE UNIQUE INDEX UX_Bookings_BookingCode
  ON dbo.Bookings(BookingCode)
  WHERE BookingCode IS NOT NULL;
  PRINT 'Created index: UX_Bookings_BookingCode';
END
ELSE
  PRINT 'Index already exists: UX_Bookings_BookingCode';
GO

-- 3. Backfill existing rows that have NULL BookingCode
--    Generates a code like BK-XXXXXX using BookingID as seed
UPDATE dbo.Bookings
SET BookingCode = 'BK-' + RIGHT('000000' + CAST(BookingID AS NVARCHAR), 6)
WHERE BookingCode IS NULL;
PRINT 'Backfilled BookingCode for existing rows (if any)';
GO

PRINT '============================================================';
PRINT ' BookingCode migration COMPLETE';
PRINT '============================================================';
