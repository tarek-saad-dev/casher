-- NOV-PRO600 shared parameters (READ-ONLY analysis)
-- Paste/execute before segment scripts, or include via sqlcmd :r
-- Override @AsOfDate / @FrequencyCapDays as needed.

DECLARE @AsOfDate           date = '2026-11-01';  -- Africa/Cairo campaign as-of
DECLARE @FrequencyCapDays   int  = 14;           -- recent contact suppression window
DECLARE @HairCutProId       int  = 9;
DECLARE @NovPackageId       int  = 8;
DECLARE @CampaignCode       nvarchar(40) = N'NOV-PRO600';

-- Protein SKUs verified live (Short / Long / Medium / generic)
-- 15, 16, 1077, 1113

-- Valid paid invoice predicate (project-canonical):
--   h.invType = N'مبيعات' AND ISNULL(h.isActive, N'no') = N'no'

-- Active future booking statuses:
--   confirmed, pending, arrived, queued

-- Booking package stamp pattern:
--   Notes LIKE N'%[groomPackage] packageId=8;%'
--   OR Notes LIKE N'%NOV-PRO600%'
