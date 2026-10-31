-- Reclassify confirmed Oct-2026 internet expenses from «اشتراكات شهريه» → «انترنت»
-- Category-only change; amounts/dates/branches/payment methods unchanged.
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @TenantId uniqueidentifier =
  (SELECT TOP 1 TenantId FROM dbo.TblExpINCat WHERE ExpINID = 27);
DECLARE @OldCatId int = 27;
DECLARE @NewCatId int;
DECLARE @Reason nvarchar(400) =
  N'إعادة تصنيف أكتوبر 2026: مصروف إنترنت مؤكد من الاشتراكات الشهرية إلى انترنت';

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM dbo.TblExpINCat
  WHERE TenantId = @TenantId AND CatName = N'انترنت' AND ExpINType = N'مصروفات'
)
BEGIN
  INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType)
  VALUES (@TenantId, N'انترنت', N'مصروفات');
END

SELECT @NewCatId = ExpINID
FROM dbo.TblExpINCat
WHERE TenantId = @TenantId AND CatName = N'انترنت' AND ExpINType = N'مصروفات';

IF @NewCatId IS NULL
BEGIN
  RAISERROR(N'فشل إنشاء/إيجاد فئة انترنت', 16, 1);
  ROLLBACK TRAN;
  RETURN;
END

PRINT CONCAT(N'Internet category ExpINID=', @NewCatId);

-- Totals BEFORE (Oct 2026, Gleem+Camp, all expenses)
SELECT N'BEFORE' AS Phase, cm.BranchID, SUM(cm.GrandTolal) AS TotalOut, COUNT(*) AS Cnt
FROM dbo.TblCashMove cm
WHERE cm.inOut = N'out' AND cm.invType = N'مصروفات'
  AND cm.invDate >= '2026-10-01' AND cm.invDate < '2026-11-01'
  AND cm.BranchID IN (1, 3)
GROUP BY cm.BranchID
ORDER BY cm.BranchID;

-- Confirmed internet rows only (explicit notes)
DECLARE @Ids TABLE (ID int PRIMARY KEY, BranchID int, Amount decimal(12,2), Notes nvarchar(200));
INSERT INTO @Ids (ID, BranchID, Amount, Notes)
SELECT cm.ID, cm.BranchID, cm.GrandTolal, LEFT(ISNULL(cm.Notes, N''), 200)
FROM dbo.TblCashMove cm
WHERE cm.ID IN (41584, 42077, 43056, 43481, 43799)
  AND cm.ExpINID = @OldCatId
  AND cm.inOut = N'out'
  AND cm.invType = N'مصروفات'
  AND cm.invDate >= '2026-10-01' AND cm.invDate < '2026-11-01'
  AND cm.BranchID = 1;

IF (SELECT COUNT(*) FROM @Ids) <> 5
BEGIN
  RAISERROR(N'Expected 5 confirmed Gleem internet rows still in الاشتراكات', 16, 1);
  ROLLBACK TRAN;
  RETURN;
END

SELECT N'TO_MOVE' AS Phase, * FROM @Ids ORDER BY ID;

-- Capture old snapshots then update category only
DECLARE @id int, @branchId int, @amount decimal(12,2), @notes nvarchar(200);
DECLARE @oldExp int, @oldDate date, @oldPay int, @oldGrand decimal(12,2), @oldNotes nvarchar(max);
DECLARE @oldJson nvarchar(max), @newJson nvarchar(max), @auditId int;
DECLARE @reqId uniqueidentifier;

DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT ID, BranchID, Amount, Notes FROM @Ids;
OPEN c;
FETCH NEXT FROM c INTO @id, @branchId, @amount, @notes;
WHILE @@FETCH_STATUS = 0
BEGIN
  SELECT
    @oldExp = ExpINID,
    @oldDate = invDate,
    @oldPay = PaymentMethodID,
    @oldGrand = GrandTolal,
    @oldNotes = Notes
  FROM dbo.TblCashMove
  WHERE ID = @id;

  SET @oldJson = (
    SELECT ID, ExpINID, invDate, BranchID, GrandTolal, PaymentMethodID, Notes, inOut, invType
    FROM dbo.TblCashMove WHERE ID = @id
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  );

  UPDATE dbo.TblCashMove
  SET ExpINID = @NewCatId
  WHERE ID = @id
    AND ExpINID = @OldCatId
    AND GrandTolal = @oldGrand
    AND invDate = @oldDate
    AND ISNULL(PaymentMethodID, -1) = ISNULL(@oldPay, -1)
    AND BranchID = @branchId;

  IF @@ROWCOUNT <> 1
  BEGIN
    RAISERROR(N'Update failed for cash move', 16, 1);
    CLOSE c; DEALLOCATE c;
    ROLLBACK TRAN;
    RETURN;
  END

  -- Guard: amount/date/branch/payment unchanged
  IF EXISTS (
    SELECT 1 FROM dbo.TblCashMove
    WHERE ID = @id AND (
      GrandTolal <> @oldGrand OR invDate <> @oldDate OR BranchID <> @branchId
      OR ISNULL(PaymentMethodID, -1) <> ISNULL(@oldPay, -1)
      OR ExpINID <> @NewCatId
    )
  )
  BEGIN
    RAISERROR(N'Integrity check failed after category update', 16, 1);
    CLOSE c; DEALLOCATE c;
    ROLLBACK TRAN;
    RETURN;
  END

  SET @newJson = (
    SELECT ID, ExpINID, invDate, BranchID, GrandTolal, PaymentMethodID, Notes, inOut, invType
    FROM dbo.TblCashMove WHERE ID = @id
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  );

  SET @reqId = NEWID();

  INSERT INTO dbo.TblSensitiveActionAuditLog
    (ActionType, ActionLabel, EntityType, EntityID,
     PerformedByUserID, PerformedByUserName, UserRolesSnapshot,
     ActionMethod, EndpointPath, OldData, NewData, ChangedFields,
     Reason, RiskLevel, RequestID, IPAddress, UserAgent,
     ExecutionStatus, ErrorMessage)
  VALUES
    (N'edit_expense', N'تعديل مصروف', N'TblCashMove', CAST(@id AS nvarchar(40)),
     13, N'Tarek', N'["admin"]',
     N'PUT', N'/ops/reclass-oct2026-internet', @oldJson, @newJson, N'["ExpINID"]',
     @Reason, N'high', CAST(@reqId AS nvarchar(64)), NULL, N'sql-ops-reclass-internet',
     N'success', NULL);

  FETCH NEXT FROM c INTO @id, @branchId, @amount, @notes;
END
CLOSE c;
DEALLOCATE c;

SELECT N'AFTER' AS Phase, cm.BranchID, SUM(cm.GrandTolal) AS TotalOut, COUNT(*) AS Cnt
FROM dbo.TblCashMove cm
WHERE cm.inOut = N'out' AND cm.invType = N'مصروفات'
  AND cm.invDate >= '2026-10-01' AND cm.invDate < '2026-11-01'
  AND cm.BranchID IN (1, 3)
GROUP BY cm.BranchID
ORDER BY cm.BranchID;

SELECT N'MOVED' AS Phase, cm.ID, cm.BranchID, cm.invDate, cm.GrandTolal, cm.Notes, cat.CatName, cm.ExpINID
FROM dbo.TblCashMove cm
INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
WHERE cm.ID IN (41584, 42077, 43056, 43481, 43799)
ORDER BY cm.ID;

SELECT N'REVIEW_LEFT_IN_SUBSCRIPTIONS' AS Phase, cm.ID, cm.BranchID, b.BranchCode, cm.invDate, cm.GrandTolal,
       LEFT(ISNULL(cm.Notes,N''), 120) AS Notes
FROM dbo.TblCashMove cm
LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
WHERE cm.inOut = N'out' AND cm.invType = N'مصروفات'
  AND cm.invDate >= '2026-10-01' AND cm.invDate < '2026-11-01'
  AND cm.BranchID IN (1, 3)
  AND cm.ExpINID = @OldCatId
ORDER BY cm.BranchID, cm.invDate, cm.ID;

COMMIT TRAN;
PRINT N'DONE';
