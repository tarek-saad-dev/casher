import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { ReverseSalePointsPayload } from '@/lib/types';

export const runtime = 'nodejs';

// POST /api/loyalty/reverse-sale
// Body: { invId: number, invType: string, notes: string }
export async function POST(req: NextRequest) {
  try {
    const body: ReverseSalePointsPayload = await req.json();
    const { invId, invType, notes } = body;

    // Validation
    if (!invId || typeof invId !== 'number' || invId <= 0) {
      return NextResponse.json(
        { error: 'رقم الفاتورة مطلوب ويجب أن يكون رقماً صحيحاً' },
        { status: 400 }
      );
    }

    if (!invType || typeof invType !== 'string' || invType.trim().length === 0) {
      return NextResponse.json(
        { error: 'نوع الفاتورة مطلوب' },
        { status: 400 }
      );
    }

    if (!notes || notes.trim().length === 0) {
      return NextResponse.json(
        { error: 'الملاحظات مطلوبة عند عكس النقاط' },
        { status: 400 }
      );
    }

    // Get current user from session
    const session = await getSession();
    const userId = session?.UserID || 0;

    const db = await getPool();

    // Check if invoice exists
    const invoiceCheck = await db.request()
      .input('invId', sql.Int, invId)
      .input('invType', sql.NVarChar(20), invType.trim())
      .query(`
        SELECT invID, ClientID, GrandTotal
        FROM [dbo].[TblinvServHead]
        WHERE invID = @invId AND invType = @invType
      `);

    if (invoiceCheck.recordset.length === 0) {
      return NextResponse.json(
        { error: 'الفاتورة غير موجودة' },
        { status: 404 }
      );
    }

    const invoice = invoiceCheck.recordset[0];

    // Check if there are points to reverse
    const ledgerCheck = await db.request()
      .input('invId', sql.Int, invId)
      .input('invType', sql.NVarChar(20), invType.trim())
      .query(`
        SELECT COUNT(*) as count
        FROM [dbo].[TblLoyaltyPointLedger] l
        INNER JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientLoyaltyID = l.ClientLoyaltyID
        WHERE l.SourceInvID = @invId 
          AND l.SourceInvType = @invType
          AND l.MovementType = 'EARN_SALE'
      `);

    const hasEarnedPoints = ledgerCheck.recordset[0]?.count > 0;

    // Begin transaction
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      // Execute the stored procedure
      const result = await new sql.Request(transaction)
        .input('invID', sql.Int, invId)
        .input('invType', sql.NVarChar(20), invType.trim())
        .input('UserID', sql.Int, userId)
        .input('Notes', sql.NVarChar(500), notes.trim())
        .query(`
          EXEC [dbo].[sp_Loyalty_ReverseSalePoints]
            @invID = @invID,
            @invType = @invType,
            @UserID = @UserID,
            @Notes = @Notes
        `);

      // Get the client's updated loyalty data if applicable
      let updatedLoyalty = null;
      let reversalLedger = null;

      if (invoice.ClientID) {
        const loyaltyResult = await new sql.Request(transaction)
          .input('clientId', sql.Int, invoice.ClientID)
          .query(`
            SELECT 
              cl.ClientLoyaltyID,
              cl.PointsBalance,
              cl.LifetimeEarnedPoints,
              lt.TierCode,
              lt.TierNameAr
            FROM [dbo].[TblClientLoyalty] cl
            LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
            WHERE cl.ClientID = @clientId
          `);
        
        updatedLoyalty = loyaltyResult.recordset[0] || null;

        // Get the reversal ledger entry
        const ledgerResult = await new sql.Request(transaction)
          .input('invId', sql.Int, invId)
          .input('invType', sql.NVarChar(20), invType.trim())
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
            WHERE l.SourceInvID = @invId 
              AND l.SourceInvType = @invType
              AND l.MovementType = 'REVERSAL'
            ORDER BY l.CreatedAt DESC, l.LedgerID DESC
          `);
        
        reversalLedger = ledgerResult.recordset[0] || null;
      }

      await transaction.commit();

      return NextResponse.json({
        success: true,
        message: hasEarnedPoints 
          ? 'تم عكس نقاط الفاتورة بنجاح'
          : 'تم تنفيذ العملية (لم يكن هناك نقاط لعكسها)',
        invoice: {
          invId,
          invType,
          clientId: invoice.ClientID,
          grandTotal: invoice.GrandTotal
        },
        loyalty: updatedLoyalty,
        ledgerEntry: reversalLedger,
        wasReversed: hasEarnedPoints
      });

    } catch (err: unknown) {
      await transaction.rollback();
      throw err;
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/reverse-sale] POST error:', message);
    
    // Check for specific stored procedure errors
    if (message.includes('already reversed')) {
      return NextResponse.json(
        { error: 'تم عكس نقاط هذه الفاتورة مسبقاً' },
        { status: 400 }
      );
    }
    
    if (message.includes('not found')) {
      return NextResponse.json(
        { error: 'لا توجد نقاط مكتسبة لهذه الفاتورة للعكس' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: 'فشل في عكس نقاط الفاتورة', details: message },
      { status: 500 }
    );
  }
}
