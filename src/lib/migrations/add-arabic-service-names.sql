-- Add Arabic name column to TblPro table
-- Migration: Add Arabic service names support

-- Add Arabic name column to services table
ALTER TABLE [dbo].[TblPro] 
ADD [ProNameAr] NVARCHAR(200) NULL;

-- Add comment to describe the new column
EXEC sp_addextendedproperty 
    @name = N'MS_Description', 
    @value = N'Arabic name of the service for display purposes', 
    @level0type = N'Schema', @level0name = N'dbo',
    @level1type = N'Table', @level1name = N'TblPro',
    @level2type = N'Column', @level2name = N'ProNameAr';

GO

-- Update existing services with Arabic translations
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'قصة شعر' WHERE [ProName] = 'Haircut';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'حلاقة دقيقة' WHERE [ProName] = 'Precision Cut';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'غسيل شعر' WHERE [ProName] = 'Hair Wash';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تصفيف شعر' WHERE [ProName] = 'Hair Styling';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'صبغة شعر' WHERE [ProName] = 'Hair Color';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'معالجة شعر' WHERE [ProName] = 'Hair Treatment';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تشقير شعر' WHERE [ProName] = 'Hair Highlights';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'كريمات' WHERE [ProName] = 'Beard Trim';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'حلاقة كاملة' WHERE [ProName] = 'Full Shave';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تقشير الوجه' WHERE [ProName] = 'Face Treatment';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'ماسك للوجه' WHERE [ProName] = 'Face Mask';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تدليك الرأس' WHERE [ProName] = 'Head Massage';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'مانيكير' WHERE [ProName] = 'Manicure';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'بيديكير' WHERE [ProName] = 'Pedicure';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'عناية بالأظافر' WHERE [ProName] = 'Nail Care';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تزيين الأظافر' WHERE [ProName] = 'Nail Art';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'إزالة الشعر' WHERE [ProName] = 'Waxing';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تنظيف البشرة' WHERE [ProName] = 'Facial';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تقشير الجسم' WHERE [ProName] = 'Body Scrub';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تدليك كامل' WHERE [ProName] = 'Full Body Massage';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'علاج بالزيوت' WHERE [ProName] = 'Oil Treatment';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'فرد الشعر' WHERE [ProName] = 'Hair Straightening';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تمويج الشعر' WHERE [ProName] = 'Hair Perming';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'ترميم الشعر' WHERE [ProName] = 'Hair Repair';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'غسول كريمات' WHERE [ProName] = 'Beard Wash';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تزيين الكريمات' WHERE [ProName] = 'Beard Styling';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'صبغة الكريمات' WHERE [ProName] = 'Beard Color';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'عناية بالكريمات' WHERE [ProName] = 'Beard Care';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'حلاقة أطفال' WHERE [ProName] = 'Kids Haircut';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'تصفيف مناسبات' WHERE [ProName] = 'Event Styling';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'عروس كامل' WHERE [ProName] = 'Bridal Package';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'باقة عناية' WHERE [ProName] = 'Care Package';
UPDATE [dbo].[TblPro] SET [ProNameAr] = 'استشارة شعر' WHERE [ProName] = 'Hair Consultation';

GO

-- For any services that don't have Arabic names yet, use the English name as fallback
UPDATE [dbo].[TblPro] 
SET [ProNameAr] = [ProName] 
WHERE [ProNameAr] IS NULL;

PRINT 'Arabic service names column added and populated successfully.';
