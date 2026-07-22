import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool } from '@/lib/db';

export async function GET() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();
    
    // Check recent services with their Arabic names
    const services = await db.request().query(`
      SELECT TOP 10 ProID, ProName, ProNameAr, CatID 
      FROM [dbo].[TblPro] 
      ORDER BY ProID DESC
    `);
    
    return NextResponse.json({ 
      success: true, 
      services: services.recordset,
      count: services.recordset.length
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Check services error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
