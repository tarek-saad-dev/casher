/*
  Segment E: INTERESTED_LEADS
  Explicit inbound ask about protein / November campaign; no completed protein/NOV booking.
  Requires verified marketing permission for outbound (currently BLOCKED — no consent store).
  Masked phone. READ-ONLY.
*/
SET NOCOUNT ON;
DECLARE @AsOfDate date = '2026-11-01';

;WITH
InboundInterest AS (
  SELECT DISTINCT conv.ClientID, MAX(m.OccurredAt) AS LastInterestAt
  FROM dbo.TblBotMessage m
  INNER JOIN dbo.TblBotConversation conv ON conv.ConversationID = m.ConversationID
  WHERE m.Direction = N'inbound'
    AND conv.ClientID IS NOT NULL
    AND (
      m.Text LIKE N'%بروتين%' OR m.Text LIKE N'%protein%' OR m.Text LIKE N'%Protein%'
      OR m.Text LIKE N'%NOV-PRO600%' OR m.Text LIKE N'%نوفمبر%' OR m.Text LIKE N'%عرض بروتين%'
    )
  GROUP BY conv.ClientID
),
ProteinDone AS (
  SELECT DISTINCT h.ClientID
  FROM dbo.TblinvServHead h
  INNER JOIN dbo.TblinvServDetail d ON d.invID=h.invID AND d.invType=h.invType
  WHERE h.invType=N'مبيعات' AND ISNULL(h.isActive,N'no')=N'no'
    AND d.ProID IN (15,16,1077,1113) AND h.ClientID IS NOT NULL
),
NovBooked AS (
  SELECT DISTINCT ClientID FROM dbo.Bookings
  WHERE ClientID IS NOT NULL
    AND LOWER(Status) NOT IN (N'cancelled',N'canceled',N'no-show',N'noshow',N'no_show')
    AND (Notes LIKE N'%NOV-PRO600%' OR Notes LIKE N'%packageId=8;%')
),
PhoneE164 AS (
  SELECT ClientID, Name,
    CASE WHEN d LIKE N'01%' AND LEN(d)=11 THEN N'20'+SUBSTRING(d,2,10)
         WHEN d LIKE N'201%' AND LEN(d)=12 THEN d ELSE NULL END AS PhoneE164
  FROM (
    SELECT ClientID, Name,
      REPLACE(REPLACE(REPLACE(ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(Mobile)),N''),NULLIF(LTRIM(RTRIM(Phone)),N'')),N''),N'+',N''),N' ',N''),N'-',N'') d
    FROM dbo.TblClient
  ) x
)
SELECT
  i.ClientID,
  LEFT(c.Name,1)+N'***' AS NameMasked,
  CASE WHEN pe.PhoneE164 IS NULL THEN N'(invalid)'
       ELSE LEFT(pe.PhoneE164,4)+N'****'+RIGHT(pe.PhoneE164,2) END AS PhoneMasked,
  i.LastInterestAt,
  CAST(0 AS bit) AS HasVerifiedMarketingConsent,
  N'BLOCKED: no marketing consent integration' AS ConsentStatus,
  N'INTERESTED_LEADS' AS Segment
FROM InboundInterest i
INNER JOIN dbo.TblClient c ON c.ClientID=i.ClientID
LEFT JOIN PhoneE164 pe ON pe.ClientID=i.ClientID
WHERE NOT EXISTS (SELECT 1 FROM ProteinDone p WHERE p.ClientID=i.ClientID)
  AND NOT EXISTS (SELECT 1 FROM NovBooked n WHERE n.ClientID=i.ClientID)
ORDER BY i.LastInterestAt DESC;
