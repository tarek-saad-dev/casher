/*
  Campaign audience data contract (NOV-PRO600)
  ------------------------------------------------
  Shape for authorized staff export ONLY to a secured local path.
  DO NOT run with results-to-text in shared CI logs.
  DO NOT commit recipient CSV/JSON containing phones.
  DO NOT send WhatsApp from unofficial automation.

  Gate: HasVerifiedMarketingConsent = 1 AND no structural suppression.
  Current DB: consent integration MISSING → this query returns ZERO rows by design.
*/
SET NOCOUNT ON;
DECLARE @AsOfDate date = '2026-11-01';
DECLARE @FrequencyCapDays int = 14;
DECLARE @CampaignCode nvarchar(40) = N'NOV-PRO600';

-- Intentionally empty until consent store exists.
-- When consent is integrated, replace the CAST(0 AS bit) gate with real evidence joins.

SELECT TOP 0
  @CampaignCode AS CampaignCode,
  CAST(NULL AS int) AS CustomerId,
  CAST(NULL AS nvarchar(100)) AS FirstName,
  CAST(NULL AS nvarchar(20)) AS PhoneE164,
  CAST(NULL AS nvarchar(40)) AS Segment,
  CAST(NULL AS nvarchar(40)) AS PreferredBranch,
  CAST(NULL AS date) AS LastVisit,
  CAST(NULL AS nvarchar(200)) AS LastService,
  CAST(NULL AS nvarchar(200)) AS ConsentEvidence,
  CAST(NULL AS nvarchar(40)) AS SuggestedMessageVariant;

/*
  SuggestedMessageVariant mapping (when consent exists):
    VIP              -> VIP_SOFT_INVITE
    HAIR_CARE        -> PROTEIN_ASSESSMENT_INVITE  (never promise retreatment)
    HAIRCUT_REGULAR  -> NOV_PACKAGE_REMINDER
    LAPSED           -> WINBACK_SOFT
    INTERESTED_LEADS -> LEAD_FOLLOWUP_NOV

  Export checklist for authorized staff:
  1. Confirm DB_NAME() and login
  2. Confirm consent evidence column/table is live
  3. Write only to secured local encrypted folder
  4. Retain access audit log (who/when/rowcount)
  5. No unofficial WhatsApp bulk send
*/
