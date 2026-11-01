/*
  NOV-PRO600 — Aggregate segment counts (NO PII)
  READ-ONLY. Configurable as-of date.
*/
SET NOCOUNT ON;

DECLARE @AsOfDate         date = '2026-11-01';
DECLARE @FrequencyCapDays int  = 14;

IF OBJECT_ID('tempdb..#Matching') IS NOT NULL DROP TABLE #Matching;
IF OBJECT_ID('tempdb..#FinalEligible') IS NOT NULL DROP TABLE #FinalEligible;
IF OBJECT_ID('tempdb..#StructuralEligible') IS NOT NULL DROP TABLE #StructuralEligible;

;WITH
ProteinPro AS (
  SELECT ProID FROM (VALUES (15),(16),(1077),(1113)) v(ProID)
),
PaidInv AS (
  SELECT h.invID, h.ClientID, CAST(h.invDate AS date) AS InvDate, h.GrandTotal, h.BranchID
  FROM dbo.TblinvServHead h
  WHERE h.invType = N'مبيعات'
    AND ISNULL(h.isActive, N'no') = N'no'
    AND h.ClientID IS NOT NULL
    AND CAST(h.invDate AS date) <= @AsOfDate
),
PaidInvSvc AS (
  SELECT p.invID, p.ClientID, p.InvDate, p.GrandTotal, p.BranchID, d.ProID
  FROM PaidInv p
  INNER JOIN dbo.TblinvServDetail d ON d.invID = p.invID AND d.invType = N'مبيعات'
),
PhoneNorm AS (
  SELECT
    c.ClientID, c.Name,
    COALESCE(NULLIF(LTRIM(RTRIM(c.Mobile)), N''), NULLIF(LTRIM(RTRIM(c.Phone)), N'')) AS RawPhone,
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(c.Mobile)), N''), NULLIF(LTRIM(RTRIM(c.Phone)), N'')), N''),
      N'+',N''),N' ',N''),N'-',N''),N'(',N''),N')',N''),N'.',N'') AS Digits
  FROM dbo.TblClient c
),
PhoneE164 AS (
  SELECT ClientID, Name, RawPhone,
    CASE
      WHEN Digits LIKE N'01%' AND LEN(Digits)=11 THEN N'20'+SUBSTRING(Digits,2,10)
      WHEN Digits LIKE N'201%' AND LEN(Digits)=12 THEN Digits
      WHEN Digits LIKE N'20%' AND LEN(Digits)=12 AND SUBSTRING(Digits,3,1)=N'1' THEN Digits
      ELSE NULL
    END AS PhoneE164
  FROM PhoneNorm
),
CanonicalRank AS (
  SELECT e.ClientID, e.Name, e.PhoneE164, MAX(p.InvDate) AS LastPaidVisit,
    ROW_NUMBER() OVER (PARTITION BY e.PhoneE164 ORDER BY MAX(p.InvDate) DESC, e.ClientID DESC) AS rn
  FROM PhoneE164 e
  LEFT JOIN PaidInv p ON p.ClientID = e.ClientID
  WHERE e.PhoneE164 IS NOT NULL
  GROUP BY e.ClientID, e.Name, e.PhoneE164
),
CanonicalClient AS (
  SELECT ClientID, Name, PhoneE164 FROM CanonicalRank WHERE rn = 1
),
VisitAgg AS (
  SELECT ClientID,
    MIN(InvDate) AS FirstPaidVisit, MAX(InvDate) AS LastPaidVisit,
    COUNT(DISTINCT invID) AS TotalPaidVisits,
    COUNT(DISTINCT CASE WHEN InvDate >= DATEADD(day,-180,@AsOfDate) THEN invID END) AS Visits180,
    COUNT(DISTINCT CASE WHEN InvDate >= DATEADD(day,-365,@AsOfDate) THEN invID END) AS Visits365,
    SUM(GrandTotal) AS TotalSpend, AVG(1.0*GrandTotal) AS AvgInvoiceValue,
    (SELECT TOP 1 p2.BranchID FROM PaidInv p2 WHERE p2.ClientID=p.ClientID ORDER BY p2.InvDate DESC, p2.invID DESC) AS PreferredBranchID
  FROM PaidInv p GROUP BY ClientID
),
HaircutAgg AS (
  SELECT ClientID, COUNT(DISTINCT invID) AS Haircuts180, MAX(InvDate) AS LastHaircutDate
  FROM PaidInvSvc WHERE ProID=9 AND InvDate >= DATEADD(day,-180,@AsOfDate)
  GROUP BY ClientID
),
ProteinAgg AS (
  SELECT ClientID, COUNT(DISTINCT invID) AS ProteinVisitsEver, MAX(InvDate) AS LastProteinDate
  FROM PaidInvSvc WHERE ProID IN (SELECT ProID FROM ProteinPro)
  GROUP BY ClientID
),
FutureActive AS (
  SELECT DISTINCT ClientID FROM dbo.Bookings
  WHERE ClientID IS NOT NULL AND BookingDate >= @AsOfDate
    AND LOWER(Status) IN (N'confirmed',N'pending',N'arrived',N'queued')
),
NovBooked AS (
  SELECT DISTINCT ClientID FROM dbo.Bookings
  WHERE ClientID IS NOT NULL
    AND LOWER(Status) NOT IN (N'cancelled',N'canceled',N'no-show',N'noshow',N'no_show')
    AND (Notes LIKE N'%NOV-PRO600%' OR Notes LIKE N'%packageId=8;%')
),
UnresolvedComplaint AS (
  SELECT DISTINCT ClientID FROM dbo.TblCustomerFollowUp WHERE ResultType=N'complaint'
),
LastMarketingContact AS (
  SELECT ClientID, MAX(ContactedAt) AS LastContactAt FROM (
    SELECT ClientID, ContactedAt FROM dbo.TblCustomerFollowUp
    UNION ALL
    SELECT CustomerID, COALESCE(SentAt, CreatedAt) FROM dbo.TblWhatsAppCampaignRecipient
    WHERE CustomerID IS NOT NULL AND LOWER(Status) IN (N'sent',N'queued',N'pending')
  ) x GROUP BY ClientID
),
InboundInterest AS (
  SELECT DISTINCT conv.ClientID
  FROM dbo.TblBotMessage m
  INNER JOIN dbo.TblBotConversation conv ON conv.ConversationID = m.ConversationID
  WHERE m.Direction = N'inbound' AND conv.ClientID IS NOT NULL
    AND (m.Text LIKE N'%بروتين%' OR m.Text LIKE N'%protein%' OR m.Text LIKE N'%Protein%'
      OR m.Text LIKE N'%NOV-PRO600%' OR m.Text LIKE N'%نوفمبر%' OR m.Text LIKE N'%عرض بروتين%')
),
InterestConverted AS (
  SELECT DISTINCT i.ClientID FROM InboundInterest i
  INNER JOIN ProteinAgg pa ON pa.ClientID=i.ClientID
  UNION SELECT ClientID FROM NovBooked
),
CustomerBase AS (
  SELECT
    cc.ClientID, cc.Name, cc.PhoneE164,
    va.FirstPaidVisit, va.LastPaidVisit,
    ISNULL(va.TotalPaidVisits,0) AS TotalPaidVisits,
    ISNULL(va.Visits180,0) AS Visits180, ISNULL(va.Visits365,0) AS Visits365,
    ISNULL(va.TotalSpend,0) AS TotalSpend, va.AvgInvoiceValue, va.PreferredBranchID,
    br.BranchCode AS PreferredBranchCode,
    ha.Haircuts180, ha.LastHaircutDate, pa.LastProteinDate,
    DATEDIFF(day, va.LastPaidVisit, @AsOfDate) AS DaysSinceLastVisit,
    CASE WHEN fa.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasFutureActiveBooking,
    CASE WHEN nb.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasNovPro600Booking,
    CASE WHEN uc.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasUnresolvedComplaint,
    lmc.LastContactAt,
    CASE WHEN lmc.LastContactAt IS NOT NULL
      AND lmc.LastContactAt >= DATEADD(day,-@FrequencyCapDays,CAST(@AsOfDate AS datetime2))
      THEN 1 ELSE 0 END AS RecentlyContacted,
    CASE WHEN ii.ClientID IS NOT NULL AND ic.ClientID IS NULL THEN 1 ELSE 0 END AS IsInterestedLeadRaw,
    CAST(0 AS bit) AS HasVerifiedMarketingConsent
  FROM CanonicalClient cc
  LEFT JOIN VisitAgg va ON va.ClientID=cc.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID=va.PreferredBranchID
  LEFT JOIN HaircutAgg ha ON ha.ClientID=cc.ClientID
  LEFT JOIN ProteinAgg pa ON pa.ClientID=cc.ClientID
  LEFT JOIN FutureActive fa ON fa.ClientID=cc.ClientID
  LEFT JOIN NovBooked nb ON nb.ClientID=cc.ClientID
  LEFT JOIN UnresolvedComplaint uc ON uc.ClientID=cc.ClientID
  LEFT JOIN LastMarketingContact lmc ON lmc.ClientID=cc.ClientID
  LEFT JOIN InboundInterest ii ON ii.ClientID=cc.ClientID
  LEFT JOIN InterestConverted ic ON ic.ClientID=cc.ClientID
  WHERE ISNULL(va.TotalPaidVisits,0) > 0 OR ii.ClientID IS NOT NULL
),
SegmentFlags AS (
  SELECT *,
    CASE WHEN Visits365>=5 AND DaysSinceLastVisit BETWEEN 30 AND 150 THEN 1 ELSE 0 END AS FlagVip,
    CASE WHEN LastProteinDate IS NOT NULL AND DATEDIFF(day,LastProteinDate,@AsOfDate) BETWEEN 120 AND 365 THEN 1 ELSE 0 END AS FlagHairCare,
    CASE WHEN ISNULL(Haircuts180,0)>=2 AND DaysSinceLastVisit BETWEEN 30 AND 90 THEN 1 ELSE 0 END AS FlagHaircutRegular,
    CASE WHEN IsInterestedLeadRaw=1 THEN 1 ELSE 0 END AS FlagInterestedLeads,
    CASE WHEN DaysSinceLastVisit BETWEEN 90 AND 240 THEN 1 ELSE 0 END AS FlagLapsed
  FROM CustomerBase
),
Assigned AS (
  SELECT *,
    CASE
      WHEN FlagVip=1 THEN N'VIP'
      WHEN FlagHairCare=1 THEN N'HAIR_CARE'
      WHEN FlagHaircutRegular=1 THEN N'HAIRCUT_REGULAR'
      WHEN FlagInterestedLeads=1 THEN N'INTERESTED_LEADS'
      WHEN FlagLapsed=1 THEN N'LAPSED'
      ELSE NULL
    END AS Segment
  FROM SegmentFlags
)
SELECT *
INTO #Matching
FROM Assigned
WHERE Segment IS NOT NULL;

SELECT *
INTO #FinalEligible
FROM #Matching
WHERE PhoneE164 IS NOT NULL
  AND HasFutureActiveBooking=0
  AND HasNovPro600Booking=0
  AND HasUnresolvedComplaint=0
  AND RecentlyContacted=0
  AND HasVerifiedMarketingConsent=1;

SELECT *
INTO #StructuralEligible
FROM #Matching
WHERE PhoneE164 IS NOT NULL
  AND HasFutureActiveBooking=0
  AND HasNovPro600Booking=0
  AND HasUnresolvedComplaint=0
  AND RecentlyContacted=0;

SELECT
  m.Segment,
  COUNT(*) AS TotalMatchingCustomers,
  SUM(CASE WHEN m.HasVerifiedMarketingConsent=1 THEN 1 ELSE 0 END) AS MarketingConsentedCustomers,
  SUM(CASE
        WHEN m.HasFutureActiveBooking=1
          OR m.HasNovPro600Booking=1
          OR m.HasUnresolvedComplaint=1
          OR m.RecentlyContacted=1
          OR m.PhoneE164 IS NULL
          OR m.HasVerifiedMarketingConsent=0
        THEN 1 ELSE 0 END) AS SuppressedCustomers,
  SUM(CASE WHEN fe.ClientID IS NOT NULL THEN 1 ELSE 0 END) AS FinalEligibleCustomers,
  SUM(CASE WHEN se.ClientID IS NOT NULL THEN 1 ELSE 0 END) AS StructuralEligible_NoConsentGate,
  AVG(CAST(m.AvgInvoiceValue AS float)) AS AvgInvoiceValue,
  AVG(CAST(m.DaysSinceLastVisit AS float)) AS AvgDaysSinceLastVisit,
  SUM(m.TotalSpend) AS PreviousRevenueContribution
FROM #Matching m
LEFT JOIN #FinalEligible fe ON fe.ClientID=m.ClientID
LEFT JOIN #StructuralEligible se ON se.ClientID=m.ClientID
GROUP BY m.Segment
ORDER BY
  CASE m.Segment
    WHEN N'VIP' THEN 1
    WHEN N'HAIR_CARE' THEN 2
    WHEN N'HAIRCUT_REGULAR' THEN 3
    WHEN N'INTERESTED_LEADS' THEN 4
    WHEN N'LAPSED' THEN 5
  END;

SELECT
  se.Segment,
  ISNULL(se.PreferredBranchCode, N'(unknown)') AS PreferredBranch,
  COUNT(*) AS Customers
FROM #StructuralEligible se
GROUP BY se.Segment, ISNULL(se.PreferredBranchCode, N'(unknown)')
ORDER BY se.Segment, Customers DESC;

-- Totals
SELECT
  (SELECT COUNT(*) FROM #Matching) AS TotalMatchingAllSegments,
  (SELECT COUNT(*) FROM #StructuralEligible) AS TotalStructuralEligible,
  (SELECT COUNT(*) FROM #FinalEligible) AS TotalFinalEligibleOutbound;
