import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// Smart category grouping based on common patterns
function getCategoryGroup(catName: string): string {
  const name = catName.toLowerCase();
  
  // مصروفات تشغيلية
  if (name.includes('كهرباء') || name.includes('مياه') || name.includes('غاز') || 
      name.includes('انترنت') || name.includes('تليفون') || name.includes('اتصالات')) {
    return 'مصروفات تشغيلية';
  }
  
  // رواتب ومكافآت
  if (name.includes('راتب') || name.includes('رواتب') || name.includes('مرتب') || 
      name.includes('أجر') || name.includes('مكافأة') || name.includes('حوافز') ||
      name.includes('بونص') || name.includes('عمولة')) {
    return 'رواتب ومكافآت';
  }
  
  // صيانة وإصلاحات
  if (name.includes('صيانة') || name.includes('إصلاح') || name.includes('تصليح') || 
      name.includes('ترميم')) {
    return 'صيانة وإصلاحات';
  }
  
  // مواد ومستلزمات
  if (name.includes('مواد') || name.includes('خام') || name.includes('مستلزم') || 
      name.includes('أدوات') || name.includes('لوازم')) {
    return 'مواد ومستلزمات';
  }
  
  // نظافة ومطهرات
  if (name.includes('نظافة') || name.includes('تنظيف') || name.includes('مطهر') || 
      name.includes('معقم')) {
    return 'نظافة ومطهرات';
  }
  
  // ضرائب ورسوم
  if (name.includes('ضريبة') || name.includes('ضرائب') || name.includes('رسوم') || 
      name.includes('رسم')) {
    return 'ضرائب ورسوم';
  }
  
  // تأمينات
  if (name.includes('تأمين') || name.includes('تأمينات')) {
    return 'تأمينات';
  }
  
  // إيجارات
  if (name.includes('إيجار') || name.includes('ايجار')) {
    return 'إيجارات';
  }
  
  // تسويق وإعلانات
  if (name.includes('تسويق') || name.includes('إعلان') || name.includes('دعاية') || 
      name.includes('ترويج')) {
    return 'تسويق وإعلانات';
  }
  
  // مصروفات إدارية
  if (name.includes('إدار') || name.includes('مكتب') || name.includes('قرطاسية') || 
      name.includes('طباعة')) {
    return 'مصروفات إدارية';
  }
  
  // نقل ومواصلات
  if (name.includes('نقل') || name.includes('مواصلات') || name.includes('بنزين') || 
      name.includes('وقود') || name.includes('سولار')) {
    return 'نقل ومواصلات';
  }
  
  // Default group
  return 'مصروفات أخرى';
}

// GET /api/expenses/categories — Expense categories sorted by usage frequency with grouping
export async function GET() {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT 
        cat.ExpINID, 
        cat.CatName,
        ISNULL(usage.UsageCount, 0) AS UsageCount
      FROM [dbo].[TblExpINCat] cat
      LEFT JOIN (
        SELECT ExpINID, COUNT(*) AS UsageCount
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' AND inOut = N'out'
          AND invDate >= DATEADD(MONTH, -3, GETDATE())
        GROUP BY ExpINID
      ) usage ON cat.ExpINID = usage.ExpINID
      WHERE cat.ExpINType = N'مصروفات'
      ORDER BY ISNULL(usage.UsageCount, 0) DESC, cat.CatName
    `);
    
    // Add group to each category
    const categoriesWithGroups = result.recordset.map((cat: any) => ({
      ...cat,
      CategoryGroup: getCategoryGroup(cat.CatName),
    }));
    
    return NextResponse.json(categoriesWithGroups);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/categories] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
