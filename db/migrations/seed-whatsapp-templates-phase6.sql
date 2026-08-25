-- ============================================================
-- Migration: seed Phase 6 WhatsApp templates (global, idempotent)
-- Safe to re-run. Does not touch sale.customer_receipt.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TblMessageTemplate', N'U') IS NULL
BEGIN
    RAISERROR(N'TblMessageTemplate is missing — run create-tbl-message-template.sql first', 16, 1);
    RETURN;
END
GO

-- customer.first_time
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'customer.first_time'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'customer.first_time', N'whatsapp', NULL, N'ar',
        N'أهلاً وسهلاً {{customerName}}! 🎉' + NCHAR(10) + NCHAR(10)
        + N'نورتنا في Cut Salon لأول مرة وفرحانين إنك اخترتنا.' + NCHAR(10) + NCHAR(10)
        + N'نتمنى تكون التجربة عجبتك، ولو عندك أي ملاحظة احنا دايمًا هنا.' + NCHAR(10) + NCHAR(10)
        + N'منتظرينك تاني! 💈',
        1, 1
    );
    PRINT N'Seeded global customer.first_time';
END
ELSE
    PRINT N'Global customer.first_time already present — seed skipped';
GO

-- sale.employee_notification (POS production body)
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'sale.employee_notification'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'sale.employee_notification', N'whatsapp', NULL, N'ar',
        N'تم تسجيل فاتورة جديدة لك {{customerName}}:' + NCHAR(10)
        + N'رقم الفاتورة: {{invoiceNumber}}' + NCHAR(10)
        + N'الخدمات: {{services}}',
        1, 1
    );
    PRINT N'Seeded global sale.employee_notification';
END
ELSE
    PRINT N'Global sale.employee_notification already present — seed skipped';
GO

-- booking.confirmation
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'booking.confirmation'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'booking.confirmation', N'whatsapp', NULL, N'ar',
        N'أهلاً {{customerName}}،' + NCHAR(10) + NCHAR(10)
        + N'تم تأكيد حجزك في Cut Salon بنجاح ✅' + NCHAR(10) + NCHAR(10)
        + N'📅 الموعد: {{date}}' + NCHAR(10)
        + N'🕐 الساعة: {{time}}' + NCHAR(10)
        + N'💇 الخدمة: {{service}}' + NCHAR(10) + NCHAR(10)
        + N'منتظرينك! 💈',
        1, 1
    );
    PRINT N'Seeded global booking.confirmation';
END
ELSE
    PRINT N'Global booking.confirmation already present — seed skipped';
GO

-- employee.advance
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'employee.advance'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'employee.advance', N'whatsapp', NULL, N'ar',
        N'أهلاً {{customerName}} 👋' + NCHAR(10) + NCHAR(10)
        + N'تم تسجيل سلفة جديدة لك:' + NCHAR(10)
        + N'المبلغ: {{amount}} ج.م' + NCHAR(10)
        + N'رقم العملية: {{invoiceNumber}}' + NCHAR(10)
        + N'طريقة الدفع: {{paymentMethod}}' + NCHAR(10)
        + N'الفرع: {{branchName}}' + NCHAR(10) + NCHAR(10)
        + N'ملاحظات: {{notes}}' + NCHAR(10) + NCHAR(10)
        + N'بالتوفيق! 💈',
        1, 1
    );
    PRINT N'Seeded global employee.advance';
END
ELSE
    PRINT N'Global employee.advance already present — seed skipped';
GO

-- employee.funding
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'employee.funding'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'employee.funding', N'whatsapp', NULL, N'ar',
        N'أهلاً {{customerName}} 👋' + NCHAR(10) + NCHAR(10)
        + N'تم تسجيل إيراد جديد لك:' + NCHAR(10)
        + N'المبلغ: {{amount}} ج.م' + NCHAR(10)
        + N'رقم العملية: {{invoiceNumber}}' + NCHAR(10)
        + N'طريقة الدفع: {{paymentMethod}}' + NCHAR(10)
        + N'الفرع: {{branchName}}' + NCHAR(10) + NCHAR(10)
        + N'ملاحظات: {{notes}}' + NCHAR(10) + NCHAR(10)
        + N'بالتوفيق! 💈',
        1, 1
    );
    PRINT N'Seeded global employee.funding';
END
ELSE
    PRINT N'Global employee.funding already present — seed skipped';
GO

-- attendance.check_in
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'attendance.check_in'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'attendance.check_in', N'whatsapp', NULL, N'ar',
        N'تم تسجيل حضورك الساعة {{time}}',
        1, 1
    );
    PRINT N'Seeded global attendance.check_in';
END
ELSE
    PRINT N'Global attendance.check_in already present — seed skipped';
GO

-- attendance.check_out
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'attendance.check_out'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'attendance.check_out', N'whatsapp', NULL, N'ar',
        N'تم تسجيل انصرافك الساعة {{time}}',
        1, 1
    );
    PRINT N'Seeded global attendance.check_out';
END
ELSE
    PRINT N'Global attendance.check_out already present — seed skipped';
GO

-- employee.daily_report (ERP-composed body via {{message}})
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'employee.daily_report'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'employee.daily_report', N'whatsapp', NULL, N'ar',
        N'{{message}}',
        1, 1
    );
    PRINT N'Seeded global employee.daily_report';
END
ELSE
    PRINT N'Global employee.daily_report already present — seed skipped';
GO

-- owner.daily_report (ERP-composed body via {{message}})
IF NOT EXISTS (
    SELECT 1 FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = N'whatsapp' AND [TemplateKey] = N'owner.daily_report'
      AND [Language] = N'ar' AND [BranchID] IS NULL
)
BEGIN
    INSERT INTO [dbo].[TblMessageTemplate] (
        [TemplateKey], [Channel], [BranchID], [Language], [Content], [IsActive], [Version]
    ) VALUES (
        N'owner.daily_report', N'whatsapp', NULL, N'ar',
        N'{{message}}',
        1, 1
    );
    PRINT N'Seeded global owner.daily_report';
END
ELSE
    PRINT N'Global owner.daily_report already present — seed skipped';
GO
