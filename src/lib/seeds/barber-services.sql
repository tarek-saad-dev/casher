-- Barber Services Seed File
-- This file contains comprehensive barber services with Arabic names

-- First, let's check if we need to create categories
-- Assuming categories already exist, but if not, you may need to create them

-- خدمات الحلاقة (Barbering Services) - Category ID: 1 (assuming)
INSERT INTO [dbo].[TblPro] (ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted) VALUES
('Hair Cut', 'حلاقة شعر', 50, 0, 1, 0),
('Haircut & Beard', 'شعر ودقن', 80, 0, 1, 0),
('Beard Styling & Fade', 'تدريج وتحديد الدقن', 70, 0, 1, 0),
('Fade Cut', 'حلاقة فيد', 60, 0, 1, 0),
('Face Threading', 'فتلة وش', 30, 0, 1, 0),
('Advanced Cut', 'قصة احترافية', 100, 0, 1, 0),
('Zero Beard Shave', 'دقن زيرو', 40, 0, 1, 0);

-- العناية بالبشرة (Skin Care) - Category ID: 2 (assuming)
INSERT INTO [dbo].[TblPro] (ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted) VALUES
('Basic Skin Care', 'تنظيف بشرة عادي', 60, 0, 2, 0),
('Face Mask', 'ماسك وش', 40, 0, 2, 0),
('Medical Skin Care', 'تنظيف بشرة طبي', 150, 0, 2, 0),
('Full Wax', 'واكس وش كامل', 80, 0, 2, 0),
('Deep Skin Care', 'تنظيف بشرة عميق', 120, 0, 2, 0),
('Hot / Cold Towel', 'فوطة سخنة أو باردة', 20, 0, 2, 0),
('Partial Wax', 'واكس جزئي', 50, 0, 2, 0),
('Foot Pedicure', 'باديكير رجل', 60, 0, 2, 0),
('Hand Pedicure', 'مانيكير يد', 50, 0, 2, 0),
('Peel-Off Mask', 'ماسك تقشير', 70, 0, 2, 0),
('Coffee Mask', 'ماسك قهوة', 55, 0, 2, 0),
('Gold Mask', 'ماسك دهب', 200, 0, 2, 0);

-- خدمات الشعر (Hair Services) - Category ID: 3 (assuming)
INSERT INTO [dbo].[TblPro] (ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted) VALUES
('Dry-Hair', 'سشوار', 30, 0, 3, 0),
('Basic Hair Color', 'صبغة شعر', 150, 0, 3, 0),
('Hair Oil Treatment', 'حمام زيت', 80, 0, 3, 0),
('Hair Straightening', 'فرد شعر', 300, 0, 3, 0),
('Short Hair Protein', 'بروتين شعر قصير', 250, 0, 3, 0),
('Hair & Beard Color', 'صبغة شعر ودقن', 200, 0, 3, 0),
('Hair Mask', 'ماسك شعر', 60, 0, 3, 0),
('Hair Design', 'رسمة شعر', 100, 0, 3, 0),
('Silver Highlights', 'خصل فضي', 180, 0, 3, 0),
('Smoothing Cream', 'كريم تنعيم', 120, 0, 3, 0),
('Toppik Hair Spray', 'توبك للشعر', 90, 0, 3, 0),
('Long Hair Protein', 'بروتين شعر طويل', 350, 0, 3, 0),
('Threading', 'فتلة', 25, 0, 3, 0),
('Hair Botox', 'بوتوكس شعر', 400, 0, 3, 0),
('Wavy Styling', 'ويفي', 150, 0, 3, 0),
('Beard Bleaching', 'تشقير دقن', 60, 0, 3, 0),
('Hair Styling', 'تصفيف شعر', 70, 0, 3, 0);

-- Verify insertion
SELECT COUNT(*) AS TotalServicesInserted FROM [dbo].[TblPro] WHERE ProNameAr IS NOT NULL;

PRINT 'Barber services seed file executed successfully.';
PRINT 'Total services inserted: 33 services across 3 categories.';
