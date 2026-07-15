-- ============================================================
-- Migration: Unique index on TblEmpTargetPlan (EmpID, EffectiveFrom)
-- Idempotent. Aborts if duplicate EmpID+EffectiveFrom rows exist.
-- Does NOT delete or rewrite duplicates automatically.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblEmpTargetPlan', N'U') IS NULL
BEGIN
    RAISERROR(N'TblEmpTargetPlan غير موجودة — نفّذ هجرة create-employee-daily-target-system أولاً.', 16, 1);
    RETURN;
END
GO

-- Duplicate guard (read-only diagnosis; no auto-fix)
IF EXISTS (
    SELECT 1
    FROM dbo.TblEmpTargetPlan
    GROUP BY EmpID, EffectiveFrom
    HAVING COUNT(*) > 1
)
BEGIN
    DECLARE @msg NVARCHAR(MAX);

    ;WITH dups AS (
        SELECT EmpID, EffectiveFrom, COUNT(*) AS Cnt
        FROM dbo.TblEmpTargetPlan
        GROUP BY EmpID, EffectiveFrom
        HAVING COUNT(*) > 1
    )
    SELECT @msg = N'تعذر إنشاء UX_TblEmpTargetPlan_EmpID_EffectiveFrom بسبب تكرار EmpID+EffectiveFrom. ' +
        N'راجع الموظفين/التواريخ التالية ثم صحّح يدويًا: ' +
        STUFF((
            SELECT N' | EmpID=' + CAST(d.EmpID AS NVARCHAR(20))
                + N' EffectiveFrom=' + CONVERT(NVARCHAR(10), d.EffectiveFrom, 23)
                + N' count=' + CAST(d.Cnt AS NVARCHAR(10))
            FROM dups d
            ORDER BY d.EmpID, d.EffectiveFrom
            FOR XML PATH(N''), TYPE
        ).value(N'.', N'NVARCHAR(MAX)'), 1, 3, N'');

    RAISERROR(@msg, 16, 1);
    RETURN;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_TblEmpTargetPlan_EmpID_EffectiveFrom'
      AND object_id = OBJECT_ID(N'dbo.TblEmpTargetPlan')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [UX_TblEmpTargetPlan_EmpID_EffectiveFrom]
        ON [dbo].[TblEmpTargetPlan] ([EmpID], [EffectiveFrom]);
    PRINT N'Created UX_TblEmpTargetPlan_EmpID_EffectiveFrom';
END
ELSE
    PRINT N'UX_TblEmpTargetPlan_EmpID_EffectiveFrom already exists';
GO

PRINT N'Unique index migration complete.';
GO
