/*
  Overlap between raw segment flags + duplicate phone detection.
  Counts / masked keys only. READ-ONLY.
*/
SET NOCOUNT ON;
DECLARE @AsOfDate date = '2026-11-01';

;WITH
PaidInv AS (
  SELECT h.invID, h.ClientID, CAST(h.invDate AS date) AS InvDate, h.GrandTotal
  FROM dbo.TblinvServHead h
  WHERE h.invType=N'مبيعات' AND ISNULL(h.isActive,N'no')=N'no' AND h.ClientID IS NOT NULL
    AND CAST(h.invDate AS date) <= @AsOfDate
),
PaidInvSvc AS (
  SELECT p.*, d.ProID FROM PaidInv p
  INNER JOIN dbo.TblinvServDetail d ON d.invID=p.invID AND d.invType=N'مبيعات'
),
PhoneE164 AS (
  SELECT ClientID,
    CASE WHEN d LIKE N'01%' AND LEN(d)=11 THEN N'20'+SUBSTRING(d,2,10)
         WHEN d LIKE N'201%' AND LEN(d)=12 THEN d ELSE NULL END AS PhoneE164
  FROM (
    SELECT ClientID,
      REPLACE(REPLACE(REPLACE(ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(Mobile)),N''),NULLIF(LTRIM(RTRIM(Phone)),N'')),N''),N'+',N''),N' ',N''),N'-',N'') d
    FROM dbo.TblClient
  ) x
),
VisitAgg AS (
  SELECT ClientID, MAX(InvDate) LastPaidVisit,
    COUNT(DISTINCT CASE WHEN InvDate>=DATEADD(day,-365,@AsOfDate) THEN invID END) V365
  FROM PaidInv GROUP BY ClientID
),
Hair AS (
  SELECT ClientID, COUNT(DISTINCT invID) Haircuts180
  FROM PaidInvSvc WHERE ProID=9 AND InvDate>=DATEADD(day,-180,@AsOfDate) GROUP BY ClientID
),
Protein AS (
  SELECT ClientID, MAX(InvDate) LastProteinDate
  FROM PaidInvSvc WHERE ProID IN (15,16,1077,1113) GROUP BY ClientID
),
Flags AS (
  SELECT v.ClientID,
    CASE WHEN v.V365>=5 AND DATEDIFF(day,v.LastPaidVisit,@AsOfDate) BETWEEN 30 AND 150 THEN 1 ELSE 0 END AS Vip,
    CASE WHEN pr.LastProteinDate IS NOT NULL AND DATEDIFF(day,pr.LastProteinDate,@AsOfDate) BETWEEN 120 AND 365 THEN 1 ELSE 0 END AS HairCare,
    CASE WHEN ISNULL(h.Haircuts180,0)>=2 AND DATEDIFF(day,v.LastPaidVisit,@AsOfDate) BETWEEN 30 AND 90 THEN 1 ELSE 0 END AS HaircutRegular,
    CASE WHEN DATEDIFF(day,v.LastPaidVisit,@AsOfDate) BETWEEN 90 AND 240 THEN 1 ELSE 0 END AS Lapsed
  FROM VisitAgg v
  LEFT JOIN Hair h ON h.ClientID=v.ClientID
  LEFT JOIN Protein pr ON pr.ClientID=v.ClientID
)
SELECT N'overlap_vip_haircare' AS Metric, COUNT(*) AS Cnt FROM Flags WHERE Vip=1 AND HairCare=1
UNION ALL SELECT N'overlap_vip_haircut', COUNT(*) FROM Flags WHERE Vip=1 AND HaircutRegular=1
UNION ALL SELECT N'overlap_vip_lapsed', COUNT(*) FROM Flags WHERE Vip=1 AND Lapsed=1
UNION ALL SELECT N'overlap_haircare_haircut', COUNT(*) FROM Flags WHERE HairCare=1 AND HaircutRegular=1
UNION ALL SELECT N'overlap_haircare_lapsed', COUNT(*) FROM Flags WHERE HairCare=1 AND Lapsed=1
UNION ALL SELECT N'overlap_haircut_lapsed', COUNT(*) FROM Flags WHERE HaircutRegular=1 AND Lapsed=1
UNION ALL SELECT N'multi_flag_customers', COUNT(*) FROM Flags WHERE (Vip+HairCare+HaircutRegular+Lapsed) >= 2
UNION ALL
SELECT N'duplicate_phone_groups', COUNT(*) FROM (
  SELECT PhoneE164 FROM PhoneE164 WHERE PhoneE164 IS NOT NULL
  GROUP BY PhoneE164 HAVING COUNT(*)>1
) d
UNION ALL
SELECT N'extra_rows_from_phone_dupes', SUM(cnt-1) FROM (
  SELECT PhoneE164, COUNT(*) cnt FROM PhoneE164 WHERE PhoneE164 IS NOT NULL
  GROUP BY PhoneE164 HAVING COUNT(*)>1
) d2;
