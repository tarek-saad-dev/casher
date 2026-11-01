/*
  Segment C: LAPSED — last paid visit 90–240 days ago.
  Lowest mutual-exclusivity priority. Masked phone. READ-ONLY.
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
PaidInvSvc AS (
  SELECT p.*, d.ProID FROM PaidInv p
  INNER JOIN dbo.TblinvServDetail d ON d.invID=p.invID AND d.invType=N'مبيعات'
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
  SELECT ClientID, MAX(InvDate) LastPaidVisit,
    COUNT(DISTINCT CASE WHEN InvDate>=DATEADD(day,-365,@AsOfDate) THEN invID END) V365,
    COUNT(DISTINCT CASE WHEN InvDate>=DATEADD(day,-180,@AsOfDate) THEN invID END) V180,
    SUM(GrandTotal) TotalSpend, AVG(1.0*GrandTotal) AvgInvoiceValue,
    (SELECT TOP 1 BranchID FROM PaidInv p2 WHERE p2.ClientID=p.ClientID ORDER BY InvDate DESC, invID DESC) PreferredBranchID
  FROM PaidInv p GROUP BY ClientID
),
Hair AS (
  SELECT ClientID, COUNT(DISTINCT invID) Haircuts180
  FROM PaidInvSvc WHERE ProID=9 AND InvDate>=DATEADD(day,-180,@AsOfDate) GROUP BY ClientID
),
Protein AS (
  SELECT ClientID, MAX(InvDate) LastProteinDate
  FROM PaidInvSvc WHERE ProID IN (15,16,1077,1113) GROUP BY ClientID
),
Base AS (
  SELECT c.ClientID, c.Name, c.PhoneE164, v.LastPaidVisit, v.AvgInvoiceValue, v.TotalSpend, v.V365,
    DATEDIFF(day,v.LastPaidVisit,@AsOfDate) DaysSince, h.Haircuts180, pr.LastProteinDate, br.BranchCode
  FROM Canonical c
  INNER JOIN VisitAgg v ON v.ClientID=c.ClientID
  LEFT JOIN Hair h ON h.ClientID=c.ClientID
  LEFT JOIN Protein pr ON pr.ClientID=c.ClientID
  LEFT JOIN dbo.TblBranch br ON br.BranchID=v.PreferredBranchID
  WHERE c.rn=1
),
Seg AS (
  SELECT *,
    CASE
      WHEN V365>=5 AND DaysSince BETWEEN 30 AND 150 THEN N'VIP'
      WHEN LastProteinDate IS NOT NULL AND DATEDIFF(day,LastProteinDate,@AsOfDate) BETWEEN 120 AND 365 THEN N'HAIR_CARE'
      WHEN ISNULL(Haircuts180,0)>=2 AND DaysSince BETWEEN 30 AND 90 THEN N'HAIRCUT_REGULAR'
      WHEN DaysSince BETWEEN 90 AND 240 THEN N'LAPSED'
      ELSE NULL
    END AS Segment
  FROM Base
)
SELECT
  ClientID,
  LEFT(Name,1)+N'***' AS NameMasked,
  LEFT(PhoneE164,4)+N'****'+RIGHT(PhoneE164,2) AS PhoneMasked,
  BranchCode AS PreferredBranch,
  LastPaidVisit,
  DaysSince AS DaysSinceLastVisit,
  AvgInvoiceValue,
  TotalSpend,
  N'LAPSED' AS Segment
FROM Seg
WHERE Segment=N'LAPSED'
ORDER BY DaysSince, ClientID;
