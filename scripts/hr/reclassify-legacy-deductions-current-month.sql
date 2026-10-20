/*
  Legacy deduction reconciliation, READ-ONLY by default.
  SQLCMD: -v Apply=0 or Apply=1. Run preview first, review ambiguous rows.
  A matching "معادلة خصم <employee name>" income is required.
  Existing treasury entries are never altered, inserted or deleted.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @Apply bit = $(Apply);
DECLARE @Today date = CONVERT(date, (SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Egypt Standard Time'));
DECLARE @MonthStart date = DATEFROMPARTS(YEAR(@Today),MONTH(@Today),1);
DECLARE @NextMonth date = DATEADD(month,1,@MonthStart);

;WITH Candidates AS (
 SELECT l.ID AS LedgerID, l.EmpID, e.EmpName, l.Amount,
        l.EntryDate, l.BranchID, l.CashMoveID, cm.ShiftMoveID,
        (SELECT COUNT_BIG(*) FROM dbo.TblCashMove i
         INNER JOIN dbo.TblExpINCat ic ON ic.ExpINID=i.ExpINID
         WHERE i.invType=N'ايرادات' AND i.inOut=N'in'
           AND ic.CatName=N'معادلة'
           AND i.Notes=N'معادلة خصم '+e.EmpName
           AND i.BranchID=cm.BranchID
           AND i.BusinessDayID=cm.BusinessDayID
           AND i.ShiftMoveID=cm.ShiftMoveID
           AND i.GrandTolal=cm.GrandTolal
        ) AS IncomeMatches,
        (SELECT COUNT_BIG(*) FROM dbo.TblEmpLedgerEntry other
         WHERE other.CashMoveID=l.CashMoveID AND other.IsVoided=0) AS LedgerMatches,
        (SELECT COUNT_BIG(*) FROM dbo.TblCashMove expense
         INNER JOIN dbo.TblExpINCat ec ON ec.ExpINID=expense.ExpINID
         WHERE expense.BranchID=cm.BranchID AND expense.BusinessDayID=cm.BusinessDayID
           AND expense.ShiftMoveID=cm.ShiftMoveID AND expense.GrandTolal=cm.GrandTolal
           AND expense.invType=N'مصروفات' AND expense.inOut=N'out'
           AND expense.ExpINID=cm.ExpINID
           AND expense.Notes=cm.Notes
        ) AS ExpenseMatches
 FROM dbo.TblEmpLedgerEntry l
 INNER JOIN dbo.TblEmp e ON e.EmpID=l.EmpID
 INNER JOIN dbo.TblCashMove cm ON cm.ID=l.CashMoveID
 WHERE l.IsVoided=0 AND l.EntryDirection=N'debit' AND l.EntryReason=N'advance'
   AND l.RefType=N'TblCashMove' AND l.RefID=l.CashMoveID
   AND cm.invType=N'مصروفات' AND cm.inOut=N'out'
   AND cm.GrandTolal=l.Amount AND cm.BranchID=l.BranchID
   AND l.EntryDate>=@MonthStart AND l.EntryDate<@NextMonth
   AND cm.Notes IS NOT NULL
   AND cm.Notes LIKE N'%خصم%'
   AND cm.Notes NOT LIKE N'%سلفة أخيرة%'
)
SELECT *, CASE WHEN IncomeMatches=1 AND LedgerMatches=1 AND ExpenseMatches=1
  THEN N'ELIGIBLE' ELSE N'REVIEW_REQUIRED' END AS Verdict
INTO #Reclassify FROM Candidates;
SELECT Verdict, COUNT(*) AS Rows, SUM(Amount) AS TotalAmount FROM #Reclassify
GROUP BY Verdict;
SELECT * FROM #Reclassify ORDER BY Verdict,EntryDate,EmpID;
IF @Apply=1
BEGIN
  IF EXISTS(SELECT 1 FROM #Reclassify WHERE Verdict=N'REVIEW_REQUIRED')
    THROW 52010,'Ambiguous historical deductions found. Review before applying.',1;
  BEGIN TRAN;
  UPDATE l SET EntryReason=N'deduction',UpdatedAt=SYSUTCDATETIME()
  FROM dbo.TblEmpLedgerEntry l
  INNER JOIN #Reclassify r ON r.LedgerID=l.ID
  WHERE r.Verdict=N'ELIGIBLE' AND l.EntryReason=N'advance' AND l.IsVoided=0
    AND l.EmpID=r.EmpID AND l.Amount=r.Amount AND l.CashMoveID=r.CashMoveID;
  SELECT @@ROWCOUNT AS ReclassifiedRows;
  COMMIT;
END;
