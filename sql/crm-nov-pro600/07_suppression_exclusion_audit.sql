/*
  Suppression / exclusion funnel audit (counts only — no PII).
  READ-ONLY. Configurable @AsOfDate / @FrequencyCapDays.
*/
SET NOCOUNT ON;
DECLARE @AsOfDate date = '2026-11-01';
DECLARE @FrequencyCapDays int = 14;

SELECT N'db_identity' AS AuditStep, DB_NAME() AS DbName, SUSER_SNAME() AS LoginName, NULL AS Cnt
UNION ALL
SELECT N'clients_total', NULL, NULL, COUNT(*) FROM dbo.TblClient
UNION ALL
SELECT N'paid_invoices_valid', NULL, NULL, COUNT(*) FROM dbo.TblinvServHead
WHERE invType=N'مبيعات' AND ISNULL(isActive,N'no')=N'no'
UNION ALL
SELECT N'clients_missing_phone', NULL, NULL, COUNT(*) FROM dbo.TblClient
WHERE NULLIF(LTRIM(RTRIM(Mobile)),N'') IS NULL AND NULLIF(LTRIM(RTRIM(Phone)),N'') IS NULL
UNION ALL
SELECT N'future_active_booking_customers', NULL, NULL, COUNT(DISTINCT ClientID) FROM dbo.Bookings
WHERE ClientID IS NOT NULL AND BookingDate >= @AsOfDate
  AND LOWER(Status) IN (N'confirmed',N'pending',N'arrived',N'queued')
UNION ALL
SELECT N'nov_pro600_active_booked_customers', NULL, NULL, COUNT(DISTINCT ClientID) FROM dbo.Bookings
WHERE ClientID IS NOT NULL
  AND LOWER(Status) NOT IN (N'cancelled',N'canceled',N'no-show',N'noshow',N'no_show')
  AND (Notes LIKE N'%NOV-PRO600%' OR Notes LIKE N'%packageId=8;%')
UNION ALL
SELECT N'unresolved_complaint_customers', NULL, NULL, COUNT(DISTINCT ClientID)
FROM dbo.TblCustomerFollowUp WHERE ResultType=N'complaint'
UNION ALL
SELECT N'followup_contacted_within_cap', NULL, NULL, COUNT(DISTINCT ClientID)
FROM dbo.TblCustomerFollowUp
WHERE ContactedAt >= DATEADD(day,-@FrequencyCapDays,CAST(@AsOfDate AS datetime2))
UNION ALL
SELECT N'campaign_recipients_within_cap', NULL, NULL, COUNT(DISTINCT CustomerID)
FROM dbo.TblWhatsAppCampaignRecipient
WHERE CustomerID IS NOT NULL
  AND COALESCE(SentAt,CreatedAt) >= DATEADD(day,-@FrequencyCapDays,CAST(@AsOfDate AS datetime2))
UNION ALL
SELECT N'verified_marketing_consent_rows', NULL, NULL, 0  -- no consent table/column exists
UNION ALL
SELECT N'inbound_protein_or_nov_interest_clients', NULL, NULL, COUNT(DISTINCT conv.ClientID)
FROM dbo.TblBotMessage m
INNER JOIN dbo.TblBotConversation conv ON conv.ConversationID=m.ConversationID
WHERE m.Direction=N'inbound' AND conv.ClientID IS NOT NULL
  AND (m.Text LIKE N'%بروتين%' OR m.Text LIKE N'%protein%' OR m.Text LIKE N'%Protein%'
    OR m.Text LIKE N'%NOV-PRO600%' OR m.Text LIKE N'%نوفمبر%' OR m.Text LIKE N'%عرض بروتين%');
