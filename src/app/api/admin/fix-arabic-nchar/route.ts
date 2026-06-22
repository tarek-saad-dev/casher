import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST() {
  try {
    const db = await getPool();
    
    // Update using regular strings, will use N prefix in SQL query
    const updates = [
      // خدمات الحلاقة
      { name: 'Hair Cut', nameAr: 'حلاقة شعر' },
      { name: 'Haircut & Beard', nameAr: 'شعر ودقن' },
      { name: 'Beard Styling & Fade', nameAr: 'تدريج وتحديد الدقن' },
      { name: 'Fade Cut', nameAr: 'حلاقة فيد' },
      { name: 'Face Threading', nameAr: 'فتلة وش' },
      { name: 'Advanced Cut', nameAr: 'قصة احترافية' },
      { name: 'Zero Beard Shave', nameAr: 'دقن زيرو' },
      
      // العناية بالبشرة
      { name: 'Basic Skin Care', nameAr: 'تنظيف بشرة عادي' },
      { name: 'Face Mask', nameAr: 'ماسك وش' },
      { name: 'Medical Skin Care', nameAr: 'تنظيف بشرة طبي' },
      { name: 'Full Wax', nameAr: 'واكس وش كامل' },
      { name: 'Deep Skin Care', nameAr: 'تنظيف بشرة عميق' },
      { name: 'Hot / Cold Towel', nameAr: 'فوطة سخنة أو باردة' },
      { name: 'Partial Wax', nameAr: 'واكس جزئي' },
      { name: 'Foot Pedicure', nameAr: 'باديكير رجل' },
      { name: 'Hand Pedicure', nameAr: 'مانيكير يد' },
      { name: 'Peel-Off Mask', nameAr: 'ماسك تقشير' },
      { name: 'Coffee Mask', nameAr: 'ماسك قهوة' },
      { name: 'Gold Mask', nameAr: 'ماسك دهب' },
      
      // خدمات الشعر
      { name: 'Dry-Hair', nameAr: 'سشوار' },
      { name: 'Basic Hair Color', nameAr: 'صبغة شعر' },
      { name: 'Hair Oil Treatment', nameAr: 'حمام زيت' },
      { name: 'Hair Straightening', nameAr: 'فرد شعر' },
      { name: 'Short Hair Protein', nameAr: 'بروتين شعر قصير' },
      { name: 'Hair & Beard Color', nameAr: 'صبغة شعر ودقن' },
      { name: 'Hair Mask', nameAr: 'ماسك شعر' },
      { name: 'Hair Design', nameAr: 'رسمة شعر' },
      { name: 'Silver Highlights', nameAr: 'خصل فضي' },
      { name: 'Smoothing Cream', nameAr: 'كريم تنعيم' },
      { name: 'Toppik Hair Spray', nameAr: 'توبك للشعر' },
      { name: 'Long Hair Protein', nameAr: 'بروتين شعر طويل' },
      { name: 'Threading', nameAr: 'فتلة' },
      { name: 'Hair Botox', nameAr: 'بوتوكس شعر' },
      { name: 'Wavy Styling', nameAr: 'ويفي' },
      { name: 'Beard Bleaching', nameAr: 'تشقير دقن' },
      { name: 'Hair Styling', nameAr: 'تصفيف شعر' }
    ];
    
    let updatedCount = 0;
    
    for (const service of updates) {
      try {
        // Use raw SQL with NCHAR literals
        const result = await db.request()
          .input('ProName', service.name)
          .query(`
            UPDATE [dbo].[TblPro] 
            SET ProNameAr = N'${service.nameAr.replace(/'/g, "''")}' 
            WHERE ProName = @ProName
          `);
        
        if (result.rowsAffected && result.rowsAffected[0] > 0) {
          updatedCount++;
          console.log(`Updated: ${service.name}`);
        }
      } catch (err) {
        console.error(`Error updating ${service.name}:`, err);
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Arabic NCHAR fix completed`,
      updated: updatedCount,
      total: updates.length
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fix Arabic NCHAR error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
