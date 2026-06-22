import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET() {
  try {
    const db = await getPool();
    
    // Check existing categories
    const categories = await db.request().query('SELECT CatID, CatName FROM [dbo].[TblCat] ORDER BY CatID');
    
    return NextResponse.json({ 
      success: true, 
      categories: categories.recordset,
      count: categories.recordset.length
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Check categories error:', message);
    return NextResponse.json({ 
      error: message 
    }, { status: 500 });
  }
}
