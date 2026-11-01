/*
  EXAMPLE ONLY — authorized staff import of verifiable WhatsApp marketing permission.
  Do not commit real phone lists. Do not run without human review.

  Prerequisites:
    1) Apply db/migrations/create-tbl-marketing-consent-evidence.sql
    2) Confirm DB_NAME() / SUSER_SNAME()
    3) Load phones into a staging table you control, then INSERT…SELECT below

  Status meanings:
    granted  = verified marketing permission evidence
    revoked  = explicit opt-out / no-marketing request
*/
SET NOCOUNT ON;

-- Example shape (replace with your secure staging source):
/*
INSERT INTO dbo.TblMarketingConsentEvidence (
  TenantId, ClientID, PhoneE164, Status, EvidenceSource, EvidenceRef, GrantedAt, CreatedByUserID, Notes
)
SELECT
  @TenantId,
  c.ClientID,
  pe.PhoneE164,
  N'granted',
  N'whatsapp_opt_in_form',
  N'batch-2026-11-01',
  SYSUTCDATETIME(),
  @UserId,
  N'Imported from verified consent export'
FROM #ConsentStaging s
INNER JOIN ... -- join to canonical PhoneE164 / TblClient
;
*/

SELECT
  Status,
  COUNT(*) AS Cnt
FROM dbo.TblMarketingConsentEvidence
WHERE TenantId = @TenantId
GROUP BY Status;
