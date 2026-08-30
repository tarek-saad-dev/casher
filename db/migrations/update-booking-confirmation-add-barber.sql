-- ============================================================
-- Update global booking.confirmation to include {{barberName}}
-- Only rewrites the known stock body (does not touch custom edits).
-- Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageTemplate', N'U') IS NULL
BEGIN
    RAISERROR(N'TblMessageTemplate is missing — run create-tbl-message-template.sql first', 16, 1);
    RETURN;
END
GO

DECLARE @OldContent NVARCHAR(MAX) =
    N'أهلاً {{customerName}}،' + NCHAR(10) + NCHAR(10)
    + N'تم تأكيد حجزك في Cut Salon بنجاح ✅' + NCHAR(10) + NCHAR(10)
    + N'📅 الموعد: {{date}}' + NCHAR(10)
    + N'🕐 الساعة: {{time}}' + NCHAR(10)
    + N'💇 الخدمة: {{service}}' + NCHAR(10) + NCHAR(10)
    + N'منتظرينك! 💈';

DECLARE @NewContent NVARCHAR(MAX) =
    N'أهلاً {{customerName}}،' + NCHAR(10) + NCHAR(10)
    + N'تم تأكيد حجزك في Cut Salon بنجاح ✅' + NCHAR(10) + NCHAR(10)
    + N'📅 الموعد: {{date}}' + NCHAR(10)
    + N'🕐 الساعة: {{time}}' + NCHAR(10)
    + N'💇 الخدمة: {{service}}' + NCHAR(10)
    + N'✂️ الحلاق: {{barberName}}' + NCHAR(10) + NCHAR(10)
    + N'منتظرينك! 💈';

UPDATE [dbo].[TblMessageTemplate]
SET
    [Content] = @NewContent,
    [Version] = [Version] + 1,
    [UpdatedAt] = SYSUTCDATETIME()
WHERE [Channel] = N'whatsapp'
  AND [TemplateKey] = N'booking.confirmation'
  AND [Language] = N'ar'
  AND [BranchID] IS NULL
  AND [Content] = @OldContent;

IF @@ROWCOUNT > 0
    PRINT N'Updated global booking.confirmation to include barberName';
ELSE
    PRINT N'Global booking.confirmation left unchanged (customized or already updated)';
GO
