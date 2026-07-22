import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool } from '@/lib/db';

export async function POST() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();
    
    // Define the services with their categories
    // Using existing category IDs: 8 (حلاقة), 9 (Skincare), 10 (خدمات إضافية ومشعر)
    const services = [
      // خدمات الحلاقة (Barbering Services) - Category ID: 8
      { name: 'Hair Cut', nameAr: 'حلاقة شعر', price: 50, bonus: 0, catId: 8 },
      { name: 'Haircut & Beard', nameAr: 'شعر ودقن', price: 80, bonus: 0, catId: 8 },
      { name: 'Beard Styling & Fade', nameAr: 'تدريج وتحديد الدقن', price: 70, bonus: 0, catId: 8 },
      { name: 'Fade Cut', nameAr: 'حلاقة فيد', price: 60, bonus: 0, catId: 8 },
      { name: 'Face Threading', nameAr: 'فتلة وش', price: 30, bonus: 0, catId: 8 },
      { name: 'Advanced Cut', nameAr: 'قصة احترافية', price: 100, bonus: 0, catId: 8 },
      { name: 'Zero Beard Shave', nameAr: 'دقن زيرو', price: 40, bonus: 0, catId: 8 },
      
      // العناية بالبشرة (Skin Care) - Category ID: 9
      { name: 'Basic Skin Care', nameAr: 'تنظيف بشرة عادي', price: 60, bonus: 0, catId: 9 },
      { name: 'Face Mask', nameAr: 'ماسك وش', price: 40, bonus: 0, catId: 9 },
      { name: 'Medical Skin Care', nameAr: 'تنظيف بشرة طبي', price: 150, bonus: 0, catId: 9 },
      { name: 'Full Wax', nameAr: 'واكس وش كامل', price: 80, bonus: 0, catId: 9 },
      { name: 'Deep Skin Care', nameAr: 'تنظيف بشرة عميق', price: 120, bonus: 0, catId: 9 },
      { name: 'Hot / Cold Towel', nameAr: 'فوطة سخنة أو باردة', price: 20, bonus: 0, catId: 9 },
      { name: 'Partial Wax', nameAr: 'واكس جزئي', price: 50, bonus: 0, catId: 9 },
      { name: 'Foot Pedicure', nameAr: 'باديكير رجل', price: 60, bonus: 0, catId: 9 },
      { name: 'Hand Pedicure', nameAr: 'مانيكير يد', price: 50, bonus: 0, catId: 9 },
      { name: 'Peel-Off Mask', nameAr: 'ماسك تقشير', price: 70, bonus: 0, catId: 9 },
      { name: 'Coffee Mask', nameAr: 'ماسك قهوة', price: 55, bonus: 0, catId: 9 },
      { name: 'Gold Mask', nameAr: 'ماسك دهب', price: 200, bonus: 0, catId: 9 },
      
      // خدمات الشعر (Hair Services) - Category ID: 10
      { name: 'Dry-Hair', nameAr: 'سشوار', price: 30, bonus: 0, catId: 10 },
      { name: 'Basic Hair Color', nameAr: 'صبغة شعر', price: 150, bonus: 0, catId: 10 },
      { name: 'Hair Oil Treatment', nameAr: 'حمام زيت', price: 80, bonus: 0, catId: 10 },
      { name: 'Hair Straightening', nameAr: 'فرد شعر', price: 300, bonus: 0, catId: 10 },
      { name: 'Short Hair Protein', nameAr: 'بروتين شعر قصير', price: 250, bonus: 0, catId: 10 },
      { name: 'Hair & Beard Color', nameAr: 'صبغة شعر ودقن', price: 200, bonus: 0, catId: 10 },
      { name: 'Hair Mask', nameAr: 'ماسك شعر', price: 60, bonus: 0, catId: 10 },
      { name: 'Hair Design', nameAr: 'رسمة شعر', price: 100, bonus: 0, catId: 10 },
      { name: 'Silver Highlights', nameAr: 'خصل فضي', price: 180, bonus: 0, catId: 10 },
      { name: 'Smoothing Cream', nameAr: 'كريم تنعيم', price: 120, bonus: 0, catId: 10 },
      { name: 'Toppik Hair Spray', nameAr: 'توبك للشعر', price: 90, bonus: 0, catId: 10 },
      { name: 'Long Hair Protein', nameAr: 'بروتين شعر طويل', price: 350, bonus: 0, catId: 10 },
      { name: 'Threading', nameAr: 'فتلة', price: 25, bonus: 0, catId: 10 },
      { name: 'Hair Botox', nameAr: 'بوتوكس شعر', price: 400, bonus: 0, catId: 10 },
      { name: 'Wavy Styling', nameAr: 'ويفي', price: 150, bonus: 0, catId: 10 },
      { name: 'Beard Bleaching', nameAr: 'تشقير دقن', price: 60, bonus: 0, catId: 10 },
      { name: 'Hair Styling', nameAr: 'تصفيف شعر', price: 70, bonus: 0, catId: 10 }
    ];
    
    let insertedCount = 0;
    let skippedCount = 0;
    
    for (const service of services) {
      // Check if service already exists
      const existingService = await db.request()
        .input('ProName', service.name)
        .query('SELECT ProID FROM [dbo].[TblPro] WHERE ProName = @ProName');
      
      if (existingService.recordset.length === 0) {
        // Insert new service
        await db.request()
          .input('ProName', service.name)
          .input('ProNameAr', service.nameAr)
          .input('SPrice1', service.price)
          .input('Bonus', service.bonus)
          .input('CatID', service.catId)
          .input('isDeleted', 0)
          .query(`
            INSERT INTO [dbo].[TblPro] (ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted)
            VALUES (@ProName, @ProNameAr, @SPrice1, @Bonus, @CatID, @isDeleted)
          `);
        insertedCount++;
      } else {
        skippedCount++;
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Barber services seed completed successfully`,
      inserted: insertedCount,
      skipped: skippedCount,
      total: services.length
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Seed error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
