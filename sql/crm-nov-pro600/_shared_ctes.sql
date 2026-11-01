-- Shared CTE block for NOV-PRO600 segmentation.
-- Requires: @AsOfDate date, @FrequencyCapDays int already declared.
-- READ-ONLY. Do not print full phones in operator consoles.

;WITH
ProteinPro AS (
  SELECT ProID FROM (VALUES (15), (16), (1077), (1113)) v(ProID)
),
PaidInv AS (
  SELECT
    h.invID,
    h.ClientID,
    CAST(h.invDate AS date) AS InvDate,
    h.GrandTotal,
    h.BranchID
  FROM dbo.TblinvServHead h
  WHERE h.invType = N'مبيعات'
    AND ISNULL(h.isActive, N'no') = N'no'
    AND h.ClientID IS NOT NULL
    AND CAST(h.invDate AS date) <= @AsOfDate
),
PaidInvSvc AS (
  SELECT
    p.invID,
    p.ClientID,
    p.InvDate,
    p.GrandTotal,
    p.BranchID,
    d.ProID
  FROM PaidInv p
  INNER JOIN dbo.TblinvServDetail d
    ON d.invID = p.invID AND d.invType = N'مبيعات'
),
PhoneNorm AS (
  SELECT
    c.ClientID,
    c.Name,
    c.TenantId,
    COALESCE(NULLIF(LTRIM(RTRIM(c.Mobile)), N''), NULLIF(LTRIM(RTRIM(c.Phone)), N'')) AS RawPhone,
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(c.Mobile)), N''), NULLIF(LTRIM(RTRIM(c.Phone)), N'')), N''),
      N'+', N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'.', N'') AS Digits
  FROM dbo.TblClient c
),
PhoneE164 AS (
  SELECT
    ClientID,
    Name,
    TenantId,
    RawPhone,
    CASE
      WHEN Digits LIKE N'01%' AND LEN(Digits) = 11 THEN N'20' + SUBSTRING(Digits, 2, 10)
      WHEN Digits LIKE N'201%' AND LEN(Digits) = 12 THEN Digits
      WHEN Digits LIKE N'20%' AND LEN(Digits) = 12 AND SUBSTRING(Digits, 3, 1) = N'1' THEN Digits
      ELSE NULL
    END AS PhoneE164
  FROM PhoneNorm
),
-- Canonical client per valid phone: most recent paid visit, then highest ClientID
CanonicalRank AS (
  SELECT
    e.ClientID,
    e.Name,
    e.PhoneE164,
    e.TenantId,
    MAX(p.InvDate) AS LastPaidVisit,
    ROW_NUMBER() OVER (
      PARTITION BY e.PhoneE164
      ORDER BY MAX(p.InvDate) DESC, e.ClientID DESC
    ) AS rn
  FROM PhoneE164 e
  LEFT JOIN PaidInv p ON p.ClientID = e.ClientID
  WHERE e.PhoneE164 IS NOT NULL
  GROUP BY e.ClientID, e.Name, e.PhoneE164, e.TenantId
),
CanonicalClient AS (
  SELECT ClientID, Name, PhoneE164, TenantId, LastPaidVisit
  FROM CanonicalRank
  WHERE rn = 1
),
VisitAgg AS (
  SELECT
    ClientID,
    MIN(InvDate) AS FirstPaidVisit,
    MAX(InvDate) AS LastPaidVisit,
    COUNT(DISTINCT invID) AS TotalPaidVisits,
    COUNT(DISTINCT CASE WHEN InvDate >= DATEADD(day, -180, @AsOfDate) THEN invID END) AS Visits180,
    COUNT(DISTINCT CASE WHEN InvDate >= DATEADD(day, -365, @AsOfDate) THEN invID END) AS Visits365,
    SUM(GrandTotal) AS TotalSpend,
    AVG(1.0 * GrandTotal) AS AvgInvoiceValue,
    -- preferred / last branch = branch of most recent paid invoice
    (
      SELECT TOP 1 p2.BranchID
      FROM PaidInv p2
      WHERE p2.ClientID = p.ClientID
      ORDER BY p2.InvDate DESC, p2.invID DESC
    ) AS PreferredBranchID
  FROM PaidInv p
  GROUP BY ClientID
),
HaircutAgg AS (
  SELECT
    ClientID,
    COUNT(DISTINCT invID) AS Haircuts180,
    MAX(InvDate) AS LastHaircutDate,
    CASE
      WHEN COUNT(DISTINCT invID) >= 2
        THEN DATEDIFF(day, MIN(InvDate), MAX(InvDate)) * 1.0 / NULLIF(COUNT(DISTINCT invID) - 1, 0)
      ELSE NULL
    END AS HaircutAvgGapDays
  FROM PaidInvSvc
  WHERE ProID = 9
    AND InvDate >= DATEADD(day, -180, @AsOfDate)
  GROUP BY ClientID
),
ProteinAgg AS (
  SELECT
    ClientID,
    COUNT(DISTINCT invID) AS ProteinVisitsEver,
    MAX(InvDate) AS LastProteinDate
  FROM PaidInvSvc
  WHERE ProID IN (SELECT ProID FROM ProteinPro)
  GROUP BY ClientID
),
FutureActive AS (
  SELECT DISTINCT ClientID
  FROM dbo.Bookings
  WHERE ClientID IS NOT NULL
    AND BookingDate >= @AsOfDate
    AND LOWER(Status) IN (N'confirmed', N'pending', N'arrived', N'queued')
),
NovBooked AS (
  SELECT DISTINCT ClientID
  FROM dbo.Bookings
  WHERE ClientID IS NOT NULL
    AND LOWER(Status) NOT IN (N'cancelled', N'canceled', N'no-show', N'noshow', N'no_show')
    AND (
      Notes LIKE N'%NOV-PRO600%'
      OR Notes LIKE N'%[groomPackage] packageId=8;%'
      OR Notes LIKE N'%packageId=8;%'
    )
),
UnresolvedComplaint AS (
  -- No resolution flag in schema; any complaint follow-up is treated as open suppression signal
  SELECT DISTINCT ClientID
  FROM dbo.TblCustomerFollowUp
  WHERE ResultType = N'complaint'
),
LastMarketingContact AS (
  SELECT ClientID, MAX(ContactedAt) AS LastContactAt
  FROM (
    SELECT ClientID, ContactedAt
    FROM dbo.TblCustomerFollowUp
    UNION ALL
    SELECT r.CustomerID AS ClientID, COALESCE(r.SentAt, r.CreatedAt) AS ContactedAt
    FROM dbo.TblWhatsAppCampaignRecipient r
    WHERE r.CustomerID IS NOT NULL
      AND LOWER(r.Status) IN (N'sent', N'queued', N'pending')
  ) x
  GROUP BY ClientID
),
InboundInterest AS (
  -- Explicit inbound customer asks about protein / November campaign
  SELECT DISTINCT COALESCE(conv.ClientID, c.ClientID) AS ClientID
  FROM dbo.TblBotMessage m
  INNER JOIN dbo.TblBotConversation conv ON conv.ConversationID = m.ConversationID
  LEFT JOIN PhoneE164 pe ON pe.PhoneE164 = CASE
      WHEN REPLACE(REPLACE(ISNULL(conv.Phone, N''), N'+', N''), N' ', N'') LIKE N'01%'
        AND LEN(REPLACE(REPLACE(ISNULL(conv.Phone, N''), N'+', N''), N' ', N'')) = 11
        THEN N'20' + SUBSTRING(REPLACE(REPLACE(ISNULL(conv.Phone, N''), N'+', N''), N' ', N''), 2, 10)
      WHEN REPLACE(REPLACE(ISNULL(conv.Phone, N''), N'+', N''), N' ', N'') LIKE N'201%'
        AND LEN(REPLACE(REPLACE(ISNULL(conv.Phone, N''), N'+', N''), N' ', N'')) = 12
        THEN REPLACE(REPLACE(ISNULL(conv.Phone, N''), N'+', N''), N' ', N'')
      ELSE NULL
    END
  LEFT JOIN CanonicalClient c ON c.PhoneE164 = pe.PhoneE164
  WHERE m.Direction = N'inbound'
    AND (
      m.Text LIKE N'%بروتين%' OR m.Text LIKE N'%protein%' OR m.Text LIKE N'%Protein%'
      OR m.Text LIKE N'%NOV-PRO600%' OR m.Text LIKE N'%نوفمبر%' OR m.Text LIKE N'%عرض بروتين%'
    )
),
-- Completed protein/nov booking after interest → exclude from INTERESTED_LEADS
InterestConverted AS (
  SELECT DISTINCT i.ClientID
  FROM InboundInterest i
  INNER JOIN ProteinAgg pa ON pa.ClientID = i.ClientID
  WHERE pa.LastProteinDate IS NOT NULL
  UNION
  SELECT ClientID FROM NovBooked
),
CustomerBase AS (
  SELECT
    cc.ClientID,
    cc.Name,
    cc.PhoneE164,
    va.FirstPaidVisit,
    va.LastPaidVisit,
    ISNULL(va.TotalPaidVisits, 0) AS TotalPaidVisits,
    ISNULL(va.Visits180, 0) AS Visits180,
    ISNULL(va.Visits365, 0) AS Visits365,
    ISNULL(va.TotalSpend, 0) AS TotalSpend,
    va.AvgInvoiceValue,
    va.PreferredBranchID,
    br.BranchCode AS PreferredBranchCode,
    ha.Haircuts180,
    ha.LastHaircutDate,
    ha.HaircutAvgGapDays,
    pa.ProteinVisitsEver,
    pa.LastProteinDate,
    DATEDIFF(day, va.LastPaidVisit, @AsOfDate) AS DaysSinceLastVisit,
    CASE WHEN fa.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasFutureActiveBooking,
    CASE WHEN nb.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasNovPro600Booking,
    CASE WHEN uc.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasUnresolvedComplaint,
    lmc.LastContactAt,
    CASE
      WHEN lmc.LastContactAt IS NOT NULL
       AND lmc.LastContactAt >= DATEADD(day, -@FrequencyCapDays, CAST(@AsOfDate AS datetime2))
      THEN 1 ELSE 0
    END AS RecentlyContacted,
    CASE WHEN ii.ClientID IS NOT NULL AND ic.ClientID IS NULL THEN 1 ELSE 0 END AS IsInterestedLeadRaw,
    -- CONSENT: no verified marketing permission store exists in this database
    CAST(0 AS bit) AS HasVerifiedMarketingConsent,
    CAST(NULL AS nvarchar(200)) AS ConsentEvidence
  FROM CanonicalClient cc
  LEFT JOIN VisitAgg va ON va.ClientID = cc.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID = va.PreferredBranchID
  LEFT JOIN HaircutAgg ha ON ha.ClientID = cc.ClientID
  LEFT JOIN ProteinAgg pa ON pa.ClientID = cc.ClientID
  LEFT JOIN FutureActive fa ON fa.ClientID = cc.ClientID
  LEFT JOIN NovBooked nb ON nb.ClientID = cc.ClientID
  LEFT JOIN UnresolvedComplaint uc ON uc.ClientID = cc.ClientID
  LEFT JOIN LastMarketingContact lmc ON lmc.ClientID = cc.ClientID
  LEFT JOIN InboundInterest ii ON ii.ClientID = cc.ClientID
  LEFT JOIN InterestConverted ic ON ic.ClientID = cc.ClientID
  WHERE va.TotalPaidVisits > 0  -- require at least one paid visit for CRM segments A–D
     OR ii.ClientID IS NOT NULL -- allow interest leads without paid visit
),
SegmentFlags AS (
  SELECT
    *,
    CASE
      WHEN Visits365 >= 5
       AND DaysSinceLastVisit BETWEEN 30 AND 150
      THEN 1 ELSE 0
    END AS FlagVip,
    CASE
      WHEN LastProteinDate IS NOT NULL
       AND DATEDIFF(day, LastProteinDate, @AsOfDate) BETWEEN 120 AND 365
      THEN 1 ELSE 0
    END AS FlagHairCare,
    CASE
      WHEN ISNULL(Haircuts180, 0) >= 2
       AND DaysSinceLastVisit BETWEEN 30 AND 90
      THEN 1 ELSE 0
    END AS FlagHaircutRegular,
    CASE
      WHEN IsInterestedLeadRaw = 1
      THEN 1 ELSE 0
    END AS FlagInterestedLeads,
    CASE
      WHEN DaysSinceLastVisit BETWEEN 90 AND 240
      THEN 1 ELSE 0
    END AS FlagLapsed
  FROM CustomerBase
),
Assigned AS (
  SELECT
    *,
    CASE
      WHEN FlagVip = 1 THEN N'VIP'
      WHEN FlagHairCare = 1 THEN N'HAIR_CARE'
      WHEN FlagHaircutRegular = 1 THEN N'HAIRCUT_REGULAR'
      WHEN FlagInterestedLeads = 1 THEN N'INTERESTED_LEADS'
      WHEN FlagLapsed = 1 THEN N'LAPSED'
      ELSE NULL
    END AS Segment
  FROM SegmentFlags
),
EligibleStructural AS (
  -- Structural exclusions only (consent still blocks outbound)
  SELECT *
  FROM Assigned
  WHERE Segment IS NOT NULL
    AND PhoneE164 IS NOT NULL
    AND HasFutureActiveBooking = 0
    AND HasNovPro600Booking = 0
    AND HasUnresolvedComplaint = 0
    AND RecentlyContacted = 0
)
-- SELECT from EligibleStructural / Assigned in calling scripts
SELECT 1 AS _shared_ctes_loaded;
