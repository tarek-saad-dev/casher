-- ============================================================
--  Add missing columns to QueueBookingSettings and TblPro
--  Idempotent — safe to run multiple times
-- ============================================================

-- 1. QueueBookingSettings: SlotIntervalMinutes
IF COL_LENGTH('dbo.QueueBookingSettings', 'SlotIntervalMinutes') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD SlotIntervalMinutes INT NOT NULL DEFAULT 15;
  PRINT 'Added: QueueBookingSettings.SlotIntervalMinutes';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.SlotIntervalMinutes';
GO

-- 2. QueueBookingSettings: MaxBookingDaysAhead
IF COL_LENGTH('dbo.QueueBookingSettings', 'MaxBookingDaysAhead') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD MaxBookingDaysAhead INT NOT NULL DEFAULT 14;
  PRINT 'Added: QueueBookingSettings.MaxBookingDaysAhead';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.MaxBookingDaysAhead';
GO

-- 3. QueueBookingSettings: MinNoticeMinutes
IF COL_LENGTH('dbo.QueueBookingSettings', 'MinNoticeMinutes') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD MinNoticeMinutes INT NOT NULL DEFAULT 30;
  PRINT 'Added: QueueBookingSettings.MinNoticeMinutes';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.MinNoticeMinutes';
GO

-- 4. QueueBookingSettings: BookingEnabled
IF COL_LENGTH('dbo.QueueBookingSettings', 'BookingEnabled') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD BookingEnabled BIT NOT NULL DEFAULT 1;
  PRINT 'Added: QueueBookingSettings.BookingEnabled';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.BookingEnabled';
GO

-- 5. QueueBookingSettings: SalonName
IF COL_LENGTH('dbo.QueueBookingSettings', 'SalonName') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD SalonName NVARCHAR(100) NULL;
  PRINT 'Added: QueueBookingSettings.SalonName';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.SalonName';
GO

-- 6. QueueBookingSettings: Timezone
IF COL_LENGTH('dbo.QueueBookingSettings', 'Timezone') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD Timezone NVARCHAR(50) NOT NULL DEFAULT 'Africa/Cairo';
  PRINT 'Added: QueueBookingSettings.Timezone';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.Timezone';
GO

-- 7. QueueBookingSettings: Currency
IF COL_LENGTH('dbo.QueueBookingSettings', 'Currency') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD Currency NVARCHAR(10) NOT NULL DEFAULT 'EGP';
  PRINT 'Added: QueueBookingSettings.Currency';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.Currency';
GO

-- 8. QueueBookingSettings: AllowSpecificBarber
IF COL_LENGTH('dbo.QueueBookingSettings', 'AllowSpecificBarber') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD AllowSpecificBarber BIT NOT NULL DEFAULT 1;
  PRINT 'Added: QueueBookingSettings.AllowSpecificBarber';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.AllowSpecificBarber';
GO

-- 9. QueueBookingSettings: AllowNearestBarber
IF COL_LENGTH('dbo.QueueBookingSettings', 'AllowNearestBarber') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD AllowNearestBarber BIT NOT NULL DEFAULT 1;
  PRINT 'Added: QueueBookingSettings.AllowNearestBarber';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.AllowNearestBarber';
GO

-- 10. QueueBookingSettings: DefaultMode
IF COL_LENGTH('dbo.QueueBookingSettings', 'DefaultMode') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD DefaultMode NVARCHAR(20) NOT NULL DEFAULT 'nearest';
  PRINT 'Added: QueueBookingSettings.DefaultMode';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.DefaultMode';
GO

-- 11a. QueueBookingSettings: DefaultServiceDurationMinutes (alias for DefaultServiceMinutes)
IF COL_LENGTH('dbo.QueueBookingSettings', 'DefaultServiceDurationMinutes') IS NULL
BEGIN
  ALTER TABLE dbo.QueueBookingSettings ADD DefaultServiceDurationMinutes INT NULL;
  PRINT 'Added: QueueBookingSettings.DefaultServiceDurationMinutes';
END
ELSE
  PRINT 'Exists: QueueBookingSettings.DefaultServiceDurationMinutes';
GO

-- 11b. Backfill DefaultServiceDurationMinutes from DefaultServiceMinutes
UPDATE dbo.QueueBookingSettings
SET DefaultServiceDurationMinutes = DefaultServiceMinutes
WHERE DefaultServiceDurationMinutes IS NULL AND DefaultServiceMinutes IS NOT NULL;
PRINT 'Backfilled: QueueBookingSettings.DefaultServiceDurationMinutes';
GO

-- 12. TblPro: DurationMinutes
IF COL_LENGTH('dbo.TblPro', 'DurationMinutes') IS NULL
BEGIN
  ALTER TABLE dbo.TblPro ADD DurationMinutes INT NULL;
  PRINT 'Added: TblPro.DurationMinutes (NULL = use default)';
END
ELSE
  PRINT 'Exists: TblPro.DurationMinutes';
GO

PRINT '============================================================';
PRINT ' Booking settings migration COMPLETE';
PRINT '============================================================';
