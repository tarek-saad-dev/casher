/*
  Segment D: VIP — 5+ paid visits in last 365 days; last visit 30–150 days ago.
  Highest mutual-exclusivity priority. Masked phone. READ-ONLY.
*/
SET NOCOUNT ON;
DECLARE @AsOfDate date = '2026-11-01';

;WITH
PaidInv AS (
  SELECT h.invID, h.ClientID, CAST(h.invDate AS date) AS InvDate, h.GrandTotal, h.BranchID
  FROM dbo.TblinvServHead h
  WHERE h.invType=N'مبيعات' AND ISNULL(h.isActive,N'no')=N'no' AND h.ClientID IS NOT NULL
    AND CAST(h.invDate AS date) <= @AsOfDate
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
),
Canonical AS (
  SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.PhoneE164 ORDER BY MAX(p.InvDate) DESC, e.ClientID DESC) rn
  FROM PhoneE164 e LEFT JOIN PaidInv p ON p.ClientID=e.ClientID
  WHERE e.PhoneE164 IS NOT NULL
  GROUP BY e.ClientID, e.Name, e.PhoneE164
),
VisitAgg AS (
  SELECT ClientID, MAX(InvDate) LastPaidVisit, MIN(InvDate) FirstPaidVisit,
    COUNT(DISTINCT CASE WHEN InvDate>=DATEADD(day,-365,@AsOfDate) THEN invID END) V365,
    SUM(GrandTotal) TotalSpend, AVG(1.0*GrandTotal) AvgInvoiceValue,
    (SELECT TOP 1 BranchID FROM PaidInv p2 WHERE p2.ClientID=p.ClientID ORDER BY InvDate DESC, invID DESC) PreferredBranchID
  FROM PaidInv p GROUP BY ClientID
),
Base AS (
  SELECT c.ClientID, c.Name, c.PhoneE164, v.LastPaidVisit, v.FirstPaidVisit, v.AvgInvoiceValue, v.TotalSpend, v.V365,
    DATEDIFF(day,v.LastPaidVisit,@AsOfDate) DaysSince, br.BranchCode
  FROM Canonical c
  INNER JOIN VisitAgg v ON v.ClientID=c.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID=v.PreferredBranchID
  WHERE c.rn=1
)
SELECT
  ClientID,
  LEFT(Name,1)+N'***' AS NameMasked,
  LEFT(PhoneE164,4)+N'****'+RIGHT(PhoneE164,2) AS PhoneMasked,
  BranchCode AS PreferredBranch,
  FirstPaidVisit, LastPaidVisit, DaysSince AS DaysSinceLastVisit,
  V365 AS Visits365, AvgInvoiceValue, TotalSpend,
  N'VIP' AS Segment
FROM Base
WHERE V365>=5 AND DaysSince BETWEEN 30 AND 150
ORDER BY TotalSpend DESC, ClientID;
