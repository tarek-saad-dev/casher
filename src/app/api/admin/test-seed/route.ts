import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST() {
  try {
    const db = await getPool();
    
    // Test with just one service first
    const result = await db.request()
      .input('ProName', 'Hair Cut')
      .input('ProNameAr', 'حلاقة شعر')
      .input('SPrice1', 50)
      .input('Bonus', 0)
      .input('CatID', 8)
      .input('isDeleted', 0)
      .query(`
        INSERT INTO [dbo].[TblPro] (ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted)
        VALUES (@ProName, @ProNameAr, @SPrice1, @Bonus, @CatID, @isDeleted)
      `);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Test service inserted successfully'
    });
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Test seed error:', message);
    return NextResponse.json({ 
      error: message,
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}
