-- ============================================================
-- Migration: seed Phase 7 WhatsApp templates (global, idempotent)
-- employee.tip only — content matches catalog EMPLOYEE_TIP_DEFAULT_TEMPLATE
-- Safe to re-run.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageTemplate', N'U') IS NULL
BEGIN
    RAISERROR(N'TblMessageTemplate is missing — run create-tbl-message-template.sql first', 16, 1);
    RETURN;
END
GO

-- employee.tip
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'employee.tip'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'employee.tip', N'whatsapp', NULL, N'ar',
        N'مرحباً {{customerName}}' + NCHAR(10) + NCHAR(10)
        + N'تم إضافة تبس لحسابك بقيمة {{tipAmount}} ج.م.' + NCHAR(10)
        + N'رصيدك الحالي في الحساب: {{newBalance}} ج.م.' + NCHAR(10)
        + N'طريقة الدفع: {{paymentMethod}}',
        1, 1
    );
    PRINT N'Seeded global employee.tip';
END
ELSE
    PRINT N'Global employee.tip already present — seed skipped';
GO
