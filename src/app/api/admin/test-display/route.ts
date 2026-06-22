import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET() {
  try {
    const db = await getPool();
    
    // Get a few services to test display
    const services = await db.request().query(`
      SELECT TOP 5 ProID, ProName, ProNameAr, SPrice1
      FROM [dbo].[TblPro] 
      WHERE ProNameAr IS NOT NULL
      ORDER BY ProID DESC
    `);
    
    // Return with proper UTF-8 encoding headers
    return new NextResponse(
      JSON.stringify({
        success: true,
        services: services.recordset,
        encoding: 'UTF-8',
        test: 'اختبار العربية - Arabic Test'
      }, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Encoding': 'utf-8'
        }
      }
    );
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Test display error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
