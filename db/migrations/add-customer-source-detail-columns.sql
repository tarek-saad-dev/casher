-- ============================================================
--  Add CameFromDetails / ReferralCode to dbo.TblClient
--  Idempotent — safe to run multiple times on local & cloud
-- ============================================================

IF COL_LENGTH('dbo.TblClient', 'CameFromDetails') IS NULL
BEGIN
  ALTER TABLE dbo.TblClient
  ADD CameFromDetails NVARCHAR(150) NULL;
  PRINT 'Added column: TblClient.CameFromDetails';
END
ELSE
  PRINT 'Column already exists: TblClient.CameFromDetails';
GO

IF COL_LENGTH('dbo.TblClient', 'ReferralCode') IS NULL
BEGIN
  ALTER TABLE dbo.TblClient
  ADD ReferralCode NVARCHAR(50) NULL;
  PRINT 'Added column: TblClient.ReferralCode';
END
ELSE
  PRINT 'Column already exists: TblClient.ReferralCode';
GO

PRINT '============================================================';
PRINT ' Customer source detail columns migration COMPLETE';
PRINT '============================================================';
