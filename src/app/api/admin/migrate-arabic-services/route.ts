import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool } from '@/lib/db';

export async function POST() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();
    
    // Check if column already exists
    const checkColumn = await db.request().query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'TblPro' AND COLUMN_NAME = 'ProNameAr'
    `);
    
    if (checkColumn.recordset.length === 0) {
      // Add Arabic name column
      await db.request().query(`
        ALTER TABLE [dbo].[TblPro] 
        ADD [ProNameAr] NVARCHAR(200) NULL
      `);
      
      console.log('Added ProNameAr column to TblPro table');
    }
    
    // Update existing services with Arabic translations
    const updates = [
      ['Haircut', 'قصة شعر'],
      ['Precision Cut', 'حلاقة دقيقة'],
      ['Hair Wash', 'غسيل شعر'],
      ['Hair Styling', 'تصفيف شعر'],
      ['Hair Color', 'صبغة شعر'],
      ['Hair Treatment', 'معالجة شعر'],
      ['Hair Highlights', 'تشقير شعر'],
      ['Beard Trim', 'كريمات'],
      ['Full Shave', 'حلاقة كاملة'],
      ['Face Treatment', 'تقشير الوجه'],
      ['Face Mask', 'ماسك للوجه'],
      ['Head Massage', 'تدليك الرأس'],
      ['Manicure', 'مانيكير'],
      ['Pedicure', 'بيديكير'],
      ['Nail Care', 'عناية بالأظافر'],
      ['Nail Art', 'تزيين الأظافر'],
      ['Waxing', 'إزالة الشعر'],
      ['Facial', 'تنظيف البشرة'],
      ['Body Scrub', 'تقشير الجسم'],
      ['Full Body Massage', 'تدليك كامل'],
      ['Oil Treatment', 'علاج بالزيوت'],
      ['Hair Straightening', 'فرد الشعر'],
      ['Hair Perming', 'تمويج الشعر'],
      ['Hair Repair', 'ترميم الشعر'],
      ['Beard Wash', 'غسول كريمات'],
      ['Beard Styling', 'تزيين الكريمات'],
      ['Beard Color', 'صبغة الكريمات'],
      ['Beard Care', 'عناية بالكريمات'],
      ['Kids Haircut', 'حلاقة أطفال'],
      ['Event Styling', 'تصفيف مناسبات'],
      ['Bridal Package', 'عروس كامل'],
      ['Care Package', 'باقة عناية'],
      ['Hair Consultation', 'استشارة شعر']
    ];
    
    for (const [englishName, arabicName] of updates) {
      await db.request()
        .input('englishName', englishName)
        .input('arabicName', arabicName)
        .query(`
          UPDATE [dbo].[TblPro] 
          SET [ProNameAr] = @arabicName 
          WHERE [ProName] = @englishName AND [ProNameAr] IS NULL
        `);
    }
    
    // For any remaining services without Arabic names, use English as fallback
    await db.request().query(`
      UPDATE [dbo].[TblPro] 
      SET [ProNameAr] = [ProName] 
      WHERE [ProNameAr] IS NULL
    `);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Arabic service names migration completed successfully' 
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Migration error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
