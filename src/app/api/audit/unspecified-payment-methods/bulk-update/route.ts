import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

interface BulkUpdatePayload {
  ids: number[];
  paymentMethodId: number;
  reason?: string;
}

interface SingleUpdatePayload {
  id: number;
  paymentMethodId: number;
  reason?: string;
}

// POST /api/audit/unspecified-payment-methods/bulk-update
// Supports both bulk and single updates
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = await req.json();
    
    // Determine if bulk or single update
    const isBulkUpdate = Array.isArray(body.ids) && body.ids.length > 0;
    const isSingleUpdate = typeof body.id === 'number';
    
    if (!isBulkUpdate && !isSingleUpdate) {
      return NextResponse.json({ 
        error: 'يجب توفير معرفات المعاملات (ids للتحديث المجمع أو id للتحديث الفردي)' 
      }, { status: 400 });
    }
    
    const paymentMethodId = body.paymentMethodId;
    if (typeof paymentMethodId !== 'number' || paymentMethodId <= 0) {
      return NextResponse.json({ error: 'يجب اختيار طريقة دفع صالحة' }, { status: 400 });
    }
    
    const reason = body.reason || 'تم التصحيح عبر أداة تدقيق طرق الدفع';
    const db = await getPool();
    
    // Validate payment method exists
    const pmCheck = await db.request()
      .input('paymentMethodId', sql.Int, paymentMethodId)
      .query('SELECT PaymentMethod FROM dbo.TblPaymentMethods WHERE PaymentID = @paymentMethodId');
    
    if (pmCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'طريقة الدفع المحددة غير موجودة' }, { status: 400 });
    }
    
    const paymentMethodName = pmCheck.recordset[0].PaymentMethod;
    
    // Get transaction IDs to update
    const idsToUpdate = isBulkUpdate ? body.ids : [body.id];
    
    // Get current state of transactions for audit log
    const currentStateQuery = await db.request()
      .input('ids', sql.VarChar(sql.MAX), idsToUpdate.join(','))
      .query(`
        SELECT ID, PaymentMethodID, invType, GrandTolal, invDate, Notes
        FROM dbo.TblCashMove
        WHERE ID IN (${idsToUpdate.join(',')})
      `);
    
    const currentTransactions = currentStateQuery.recordset;
    
    if (currentTransactions.length === 0) {
      return NextResponse.json({ error: 'لم يتم العثور على المعاملات المحددة' }, { status: 404 });
    }
    
    // Perform update in transaction
    const transaction = new sql.Transaction(db);
    await transaction.begin();
    
    try {
      const updatedIds: number[] = [];
      const errors: { id: number; error: string }[] = [];
      
      for (const tx of currentTransactions) {
        try {
          // Build edit history entry
          const editEntry = {
            editedAt: new Date().toISOString(),
            editedBy: session.UserName || session.UserID?.toString() || 'system',
            userId: session.UserID,
            action: 'PAYMENT_METHOD_FIX',
            reason,
            changes: {
              paymentMethodId: { old: tx.PaymentMethodID, new: paymentMethodId }
            }
          };
          
          // Parse existing history
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
          
          // Update the transaction
          await new sql.Request(transaction)
            .input('id', sql.Int, tx.ID)
            .input('paymentMethodId', sql.Int, paymentMethodId)
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
      
      // Log the bulk update action
      console.log(`[bulk-update] User ${session.UserID} (${session.UserName}) updated ${updatedIds.length} transactions with PaymentMethodID=${paymentMethodId}. Reason: ${reason}`);
      
      return NextResponse.json({
        success: true,
        updatedCount: updatedIds.length,
        updatedIds,
        paymentMethodId,
        paymentMethodName,
        errors: errors.length > 0 ? errors : undefined,
        message: `تم تحديث ${updatedIds.length} معاملة باستخدام طريقة الدفع: ${paymentMethodName}`
      });
      
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/audit/unspecified-payment-methods/bulk-update] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
