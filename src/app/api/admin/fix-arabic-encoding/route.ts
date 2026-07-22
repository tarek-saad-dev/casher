import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool } from '@/lib/db';

export async function POST() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();
    
    // Define the services with proper Arabic names (using Unicode escape sequences if needed)
    const serviceUpdates = [
      // خدمات الحلاقة (Barbering Services)
      { name: 'Hair Cut', nameAr: 'حلاقة شعر' },
      { name: 'Haircut & Beard', nameAr: 'شعر ودقن' },
      { name: 'Beard Styling & Fade', nameAr: 'تدريج وتحديد الدقن' },
      { name: 'Fade Cut', nameAr: 'حلاقة فيد' },
      { name: 'Face Threading', nameAr: 'فتلة وش' },
      { name: 'Advanced Cut', nameAr: 'قصة احترافية' },
      { name: 'Zero Beard Shave', nameAr: 'دقن زيرو' },
      
      // العناية بالبشرة (Skin Care)
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
      
      // خدمات الشعر (Hair Services)
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
    let errorCount = 0;
    
    for (const service of serviceUpdates) {
      try {
        // Update the Arabic name for each service
        const result = await db.request()
          .input('ProName', service.name)
          .input('ProNameAr', service.nameAr)
          .query(`
            UPDATE [dbo].[TblPro] 
            SET ProNameAr = @ProNameAr 
            WHERE ProName = @ProName
          `);
        
        if (result.rowsAffected && result.rowsAffected[0] > 0) {
          updatedCount++;
          console.log(`Updated: ${service.name} -> ${service.nameAr}`);
        }
      } catch (err) {
        errorCount++;
        console.error(`Error updating ${service.name}:`, err);
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Arabic encoding fix completed`,
      updated: updatedCount,
      errors: errorCount,
      total: serviceUpdates.length
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fix Arabic encoding error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
