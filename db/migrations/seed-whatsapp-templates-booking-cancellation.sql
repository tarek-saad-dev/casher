-- ============================================================
-- Migration: seed booking.cancellation WhatsApp template (global, idempotent)
-- Content matches catalog BOOKING_CANCELLATION_DEFAULT_TEMPLATE
-- Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageTemplate', N'U') IS NULL
BEGIN
    RAISERROR(N'TblMessageTemplate is missing — run create-tbl-message-template.sql first', 16, 1);
    RETURN;
END
GO

-- booking.cancellation
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'booking.cancellation'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'booking.cancellation', N'whatsapp', NULL, N'ar',
        N'أهلاً {{customerName}}،' + NCHAR(10) + NCHAR(10)
        + N'تم إلغاء حجزك في Cut Salon ❌' + NCHAR(10) + NCHAR(10)
        + N'📅 الموعد: {{date}}' + NCHAR(10)
        + N'🕐 الساعة: {{time}}' + NCHAR(10)
        + N'💇 الخدمة: {{service}}' + NCHAR(10)
        + N'🔖 رقم الحجز: {{bookingId}}' + NCHAR(10)
        + N'🏢 الفرع: {{branchName}}' + NCHAR(10) + NCHAR(10)
        + N'للاستفسار يرجى التواصل مع الفرع.',
        1, 1
    );
    PRINT N'Seeded global booking.cancellation';
END
ELSE
    PRINT N'Global booking.cancellation already present — seed skipped';
GO
