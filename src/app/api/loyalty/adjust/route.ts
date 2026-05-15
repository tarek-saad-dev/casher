import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { AdjustPointsPayload } from '@/lib/types';

export const runtime = 'nodejs';

// POST /api/loyalty/adjust
// Body: { clientId: number, pointsDelta: number, notes: string }
export async function POST(req: NextRequest) {
  try {
    const body: AdjustPointsPayload = await req.json();
    const { clientId, pointsDelta, notes } = body;

    // Validation
    if (!clientId || typeof clientId !== 'number' || clientId <= 0) {
      return NextResponse.json(
        { error: 'معرف العميل مطلوب ويجب أن يكون رقماً صحيحاً' },
        { status: 400 }
      );
    }

    if (typeof pointsDelta !== 'number' || pointsDelta === 0) {
      return NextResponse.json(
        { error: 'عدد النقاط مطلوب ويجب أن يكون رقماً غير صفر' },
        { status: 400 }
      );
    }

    if (!notes || notes.trim().length === 0) {
      return NextResponse.json(
        { error: 'الملاحظات مطلوبة عند التعديل اليدوي' },
        { status: 400 }
      );
    }

    // Get current user from session
    const session = await getSession();
    const userId = session?.UserID || 0;

    const db = await getPool();

    // Begin transaction
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      // Check if client has loyalty account
      const loyaltyCheck = await new sql.Request(transaction)
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT ClientLoyaltyID, PointsBalance
          FROM [dbo].[TblClientLoyalty]
          WHERE ClientID = @clientId
        `);

      // If deducting points, check balance
      if (pointsDelta < 0) {
        const currentBalance = loyaltyCheck.recordset[0]?.PointsBalance || 0;
        if (Math.abs(pointsDelta) > currentBalance) {
          await transaction.rollback();
          return NextResponse.json(
            { error: 'رصيد النقاط غير كافٍ للخصم', currentBalance },
            { status: 400 }
          );
        }
      }

      // Execute the stored procedure
      const result = await new sql.Request(transaction)
        .input('ClientID', sql.Int, clientId)
        .input('PointsDelta', sql.Decimal(10, 2), pointsDelta)
        .input('UserID', sql.Int, userId)
        .input('Notes', sql.NVarChar(500), notes.trim())
        .query(`
          EXEC [dbo].[sp_Loyalty_AdjustPoints]
            @ClientID = @ClientID,
            @PointsDelta = @PointsDelta,
            @UserID = @UserID,
            @Notes = @Notes
        `);

      // Get the updated loyalty data
      const updatedLoyalty = await new sql.Request(transaction)
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT 
            cl.ClientLoyaltyID,
            cl.PointsBalance,
            cl.LifetimeEarnedPoints,
            cl.LifetimeAdjustedPoints,
            lt.TierCode,
            lt.TierNameAr
          FROM [dbo].[TblClientLoyalty] cl
          LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
          WHERE cl.ClientID = @clientId
        `);

      // Get the latest ledger entry
      const latestLedger = await new sql.Request(transaction)
        .input('clientId', sql.Int, clientId)
        .query(`
          SELECT TOP 1
            l.LedgerID,
            l.MovementType,
            l.PointsDelta,
            l.PointsBefore,
            l.PointsAfter,
            l.Notes,
            l.CreatedAt
          FROM [dbo].[TblLoyaltyPointLedger] l
          INNER JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientLoyaltyID = l.ClientLoyaltyID
          WHERE cl.ClientID = @clientId
          ORDER BY l.CreatedAt DESC, l.LedgerID DESC
        `);

      await transaction.commit();

      return NextResponse.json({
        success: true,
        message: pointsDelta > 0 
          ? `تم إضافة ${pointsDelta} نقطة بنجاح` 
          : `تم خصم ${Math.abs(pointsDelta)} نقطة بنجاح`,
        loyalty: updatedLoyalty.recordset[0] || null,
        ledgerEntry: latestLedger.recordset[0] || null
      });

    } catch (err: unknown) {
      await transaction.rollback();
      throw err;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/adjust] POST error:', message);
    
    // Check for specific stored procedure errors
    if (message.includes('Insufficient points')) {
      return NextResponse.json(
        { error: 'رصيد النقاط غير كافٍ للخصم' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'فشل في تعديل النقاط', details: message },
      { status: 500 }
    );
  }
}
