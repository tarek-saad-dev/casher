import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// POST /api/audit/unspecified-payment-methods/fix-all
// Bulk fix ALL unspecified payment methods to 'كاش' (Cash)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = await req.json();
    const reason = body.reason || 'تم التصحيح التلقائي - تحويل جميع طرق الدفع غير المحددة إلى كاش';
    
    const db = await getPool();
    
    // Get the Cash payment method ID
    const pmResult = await db.request()
      .query(`SELECT PaymentID FROM dbo.TblPaymentMethods WHERE PaymentMethod = N'كاش'`);
    
    if (pmResult.recordset.length === 0) {
      return NextResponse.json({ error: 'طريقة الدفع "كاش" غير موجودة في النظام' }, { status: 400 });
    }
    
    const cashPaymentMethodId = pmResult.recordset[0].PaymentID;
    
    // Find all transactions with unspecified payment methods
    const unspecifiedQuery = await db.request().query(`
      SELECT 
        CM.ID,
        CM.PaymentMethodID,
        CM.invType,
        CM.GrandTolal,
        CM.invDate,
        CM.Notes
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
         OR PM.PaymentMethod IS NULL 
         OR PM.PaymentMethod = '' 
         OR PM.PaymentMethod = N'غير محدد'
    `);
    
    const transactionsToFix = unspecifiedQuery.recordset;
    
    if (transactionsToFix.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'لا توجد معاملات غير محددة للتحديث',
        updatedCount: 0 
      });
    }
    
    // Perform updates in transaction
    const transaction = new sql.Transaction(db);
    await transaction.begin();
    
    try {
      const updatedIds: number[] = [];
      const errors: { id: number; error: string }[] = [];
      
      for (const tx of transactionsToFix) {
        try {
          // Build edit history entry
          const editEntry = {
            editedAt: new Date().toISOString(),
            editedBy: session.UserName || session.UserID?.toString() || 'system',
            userId: session.UserID,
            action: 'AUTO_PAYMENT_METHOD_FIX_TO_CASH',
            reason,
            changes: {
              paymentMethodId: { old: tx.PaymentMethodID, new: cashPaymentMethodId },
              paymentMethodName: { old: 'غير محدد', new: 'كاش' }
            }
          };
          
          // Parse existing history from Notes
          let editHistory: any[] = [];
          if (tx.Notes && tx.Notes.includes('EditHistory')) {
            try {
              const match = tx.Notes.match(/EditHistory:\s*(\[.*\])/);
              if (match) {
                editHistory = JSON.parse(match[1]);
              }
            } catch { /* ignore parse errors */ }
          }
          
          editHistory.push(editEntry);
          
          // Prepare new notes with edit history
          const baseNotes = tx.Notes?.replace(/\s*\[?EditHistory:.*\]?\s*$/, '').trim() || '';
          const newNotes = baseNotes 
            ? `${baseNotes} [EditHistory: ${JSON.stringify(editHistory)}]`
            : `[EditHistory: ${JSON.stringify(editHistory)}]`;
          
          // Update the transaction to use Cash
          await new sql.Request(transaction)
            .input('id', sql.Int, tx.ID)
            .input('paymentMethodId', sql.Int, cashPaymentMethodId)
            .input('notes', sql.NVarChar(sql.MAX), newNotes)
            .query(`
              UPDATE dbo.TblCashMove
              SET 
                PaymentMethodID = @paymentMethodId,
                Notes = @notes
              WHERE ID = @id
            `);
          
          updatedIds.push(tx.ID);
          
        } catch (innerErr) {
          errors.push({ 
            id: tx.ID, 
            error: innerErr instanceof Error ? innerErr.message : 'Unknown error' 
          });
        }
      }
      
      await transaction.commit();
      
      // Log the action
      console.log(`[fix-all] User ${session.UserID} (${session.UserName}) fixed ${updatedIds.length} transactions to Cash payment method. Reason: ${reason}`);
      
      return NextResponse.json({
        success: true,
        updatedCount: updatedIds.length,
        updatedIds,
        paymentMethodId: cashPaymentMethodId,
        paymentMethodName: 'كاش',
        errors: errors.length > 0 ? errors : undefined,
        message: `تم تحديث ${updatedIds.length} معاملة إلى طريقة الدفع "كاش"`
      });
      
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/audit/unspecified-payment-methods/fix-all] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/audit/unspecified-payment-methods/fix-all/preview
// Preview what would be fixed without actually fixing
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const db = await getPool();
    
    // Count all transactions with unspecified payment methods
    const countResult = await db.request().query(`
      SELECT 
        COUNT(*) AS totalCount,
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN 1 ELSE 0 END) AS revenueCount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN 1 ELSE 0 END) AS expenseCount,
        SUM(CM.GrandTolal) AS totalAmount,
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN CM.GrandTolal ELSE 0 END) AS revenueAmount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN CM.GrandTolal ELSE 0 END) AS expenseAmount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
         OR PM.PaymentMethod IS NULL 
         OR PM.PaymentMethod = '' 
         OR PM.PaymentMethod = N'غير محدد'
    `);
    
    const stats = countResult.recordset[0];
    
    // Get sample of transactions that would be affected
    const sampleResult = await db.request().query(`
      SELECT TOP 10
        CM.ID,
        CM.invID,
        CM.invDate,
        CM.invType,
        CM.GrandTolal,
        ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
        ISNULL(U.UserName, N'غير معروف') AS UserName
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      LEFT JOIN dbo.TblExpINCat CAT ON CM.ExpINID = CAT.ExpINID
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      WHERE CM.PaymentMethodID IS NULL 
         OR PM.PaymentMethod IS NULL 
         OR PM.PaymentMethod = '' 
         OR PM.PaymentMethod = N'غير محدد'
      ORDER BY CM.invDate DESC
    `);
    
    return NextResponse.json({
      preview: true,
      wouldFix: {
        totalCount: stats.totalCount,
        revenueCount: stats.revenueCount,
        expenseCount: stats.expenseCount,
        totalAmount: stats.totalAmount,
        revenueAmount: stats.revenueAmount,
        expenseAmount: stats.expenseAmount
      },
      sampleTransactions: sampleResult.recordset,
      message: `سيتم تحديث ${stats.totalCount} معاملة إلى طريقة الدفع "كاش"`
    });
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/audit/unspecified-payment-methods/fix-all] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
