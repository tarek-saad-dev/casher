-- ============================================================
-- Migration: Unique index for daily-target ledger entries
-- Identity: RefType=TblEmpDailyTarget + RefID + EntryReason=target
-- Idempotent. Aborts if duplicates exist (no auto-delete).
-- Does NOT alter payroll/advance unique indexes.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblEmpLedgerEntry', N'U') IS NULL
BEGIN
    RAISERROR(N'TblEmpLedgerEntry غير موجودة — نفّذ create-tbl-emp-ledger-entry أولاً.', 16, 1);
    RETURN;
END
GO

-- Duplicate guard (diagnosis only — no auto-fix)
IF EXISTS (
    SELECT 1
    FROM dbo.TblEmpLedgerEntry
    WHERE RefType = N'TblEmpDailyTarget'
      AND EntryReason = N'target'
      AND RefID IS NOT NULL
    GROUP BY RefType, RefID, EntryReason
    HAVING COUNT(*) > 1
)
BEGIN
    DECLARE @msg NVARCHAR(MAX);

    ;WITH dups AS (
        SELECT RefType, RefID, EntryReason, COUNT(*) AS Cnt
        FROM dbo.TblEmpLedgerEntry
        WHERE RefType = N'TblEmpDailyTarget'
          AND EntryReason = N'target'
          AND RefID IS NOT NULL
        GROUP BY RefType, RefID, EntryReason
        HAVING COUNT(*) > 1
    ),
    ids AS (
        SELECT
            d.RefID,
            d.Cnt,
            STUFF((
                SELECT N',' + CAST(l.ID AS NVARCHAR(20))
                FROM dbo.TblEmpLedgerEntry l
                WHERE l.RefType = N'TblEmpDailyTarget'
                  AND l.EntryReason = N'target'
                  AND l.RefID = d.RefID
                ORDER BY l.ID
                FOR XML PATH(N''), TYPE
            ).value(N'.', N'NVARCHAR(MAX)'), 1, 1, N'') AS LedgerIDs
        FROM dups d
    )
    SELECT @msg = N'تعذر إنشاء UX_TblEmpLedgerEntry_DailyTargetRef بسبب تكرار قيود التارجت. ' +
        N'راجع IDs التالية ثم صحّح يدويًا: ' +
        STUFF((
            SELECT N' | RefID=' + CAST(i.RefID AS NVARCHAR(20))
                + N' count=' + CAST(i.Cnt AS NVARCHAR(10))
                + N' LedgerIDs=' + i.LedgerIDs
            FROM ids i
            ORDER BY i.RefID
            FOR XML PATH(N''), TYPE
        ).value(N'.', N'NVARCHAR(MAX)'), 1, 3, N'');

    RAISERROR(@msg, 16, 1);
    RETURN;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_TblEmpLedgerEntry_DailyTargetRef'
      AND object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblEmpLedgerEntry_DailyTargetRef]
        ON [dbo].[TblEmpLedgerEntry] ([RefType], [RefID], [EntryReason])
        WHERE [RefType] = N'TblEmpDailyTarget'
          AND [EntryReason] = N'target'
          AND [RefID] IS NOT NULL;
    PRINT N'Created UX_TblEmpLedgerEntry_DailyTargetRef';
END
ELSE
    PRINT N'UX_TblEmpLedgerEntry_DailyTargetRef already exists';
GO

PRINT N'Daily target ledger unique index migration complete.';
GO
