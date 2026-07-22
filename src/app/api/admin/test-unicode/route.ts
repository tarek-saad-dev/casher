import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool } from '@/lib/db';

export async function GET() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();
    
    // Test with a specific service to check Unicode storage
    const result = await db.request()
      .input('ProName', 'Hair Cut')
      .query(`
        SELECT ProID, ProName, ProNameAr, 
               LEN(ProNameAr) as Length,
               UNICODE(SUBSTRING(ProNameAr, 1, 1)) as FirstCharUnicode
        FROM [dbo].[TblPro] 
        WHERE ProName = @ProName
      `);
    
    if (result.recordset.length > 0) {
      const service = result.recordset[0];
      
      // Test inserting a new record with explicit N prefix
      await db.request()
        .input('ProName', 'Test Arabic')
        .input('ProNameAr', 'اختبار عربي')
        .query(`
          INSERT INTO [dbo].[TblPro] (ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted)
          VALUES (@ProName, @ProNameAr, 99, 0, 8, 0)
        `);
      
      // Check the inserted record
      const testResult = await db.request()
        .input('ProName', 'Test Arabic')
        .query(`
          SELECT ProID, ProName, ProNameAr, 
                 LEN(ProNameAr) as Length,
                 UNICODE(SUBSTRING(ProNameAr, 1, 1)) as FirstCharUnicode
          FROM [dbo].[TblPro] 
          WHERE ProName = @ProName
        `);
      
      return NextResponse.json({ 
        success: true, 
        originalService: result.recordset[0],
        testService: testResult.recordset[0],
        message: 'Check the ProNameAr field values'
      });
    }
    
    return NextResponse.json({ 
      success: false, 
      message: 'Service not found'
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Test Unicode error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
