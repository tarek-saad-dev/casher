import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { CreateSalePayload } from '@/lib/types';

// WhatsApp API configuration
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'http://localhost:3000/api/sales/notify';

// POST /api/sales — Create a new sale (head + details + payment + cash move)
export async function POST(req: NextRequest) {
  try {
    const body: CreateSalePayload = await req.json();

    // Validation
    if (!body.items || body.items.length === 0) {
      return NextResponse.json({ error: 'يجب إضافة خدمة واحدة على الأقل' }, { status: 400 });
    }

    // ──── Session enforcement ────
    const sessionUser = await getSession();
    const userID = sessionUser?.UserID ?? 0;

    const db = await getPool();

    // DEBUG: confirm DB
    const dbNameResult = await db.request().query("SELECT DB_NAME() AS dbName");
    const dbName = dbNameResult.recordset[0].dbName;
    console.log(`[pos-api] ──── SAVE SALE START ──── DB=${dbName}, UserID=${userID}`);

    // ──── Enforce active business day ────
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status = 1 ORDER BY ID DESC
    `);
    if (dayResult.recordset.length === 0) {
      console.error(`[pos-api]   ❌ REJECTED: no active business day`);
      return NextResponse.json({ error: 'لا يوجد يوم عمل مفتوح — لا يمكن إنشاء فاتورة' }, { status: 400 });
    }
    const activeDay = dayResult.recordset[0];
    const invDate = activeDay.NewDay; // Use business day date, NOT JS Date
    console.log(`[pos-api]   Active Day: ID=${activeDay.ID}, NewDay=${invDate}`);

    // ──── Enforce active shift for THIS user ────
    const shiftResult = await db.request()
      .input('shiftUserID', sql.Int, userID)
      .query(`
        SELECT TOP 1 ID, UserID, ShiftID FROM [dbo].[TblShiftMove]
        WHERE Status = 1 AND UserID = @shiftUserID
        ORDER BY ID DESC
      `);
    if (shiftResult.recordset.length === 0) {
      console.error(`[pos-api]   ❌ REJECTED: no active shift for UserID=${userID}`);
      return NextResponse.json({ error: 'لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن إنشاء فاتورة' }, { status: 400 });
    }
    const activeShift = shiftResult.recordset[0];
    const shiftMoveID = activeShift.ID;
    console.log(`[pos-api]   Active Shift: ID=${shiftMoveID}, UserID=${activeShift.UserID} (verified owner)`);

    // ──── Server-side discount validation ────
    const subTotal = Math.max(0, body.subTotal || 0);
    let disPercent = Math.max(0, Math.min(100, body.dis || 0));
    let disVal = Math.max(0, body.disVal || 0);
    if (disVal > subTotal) disVal = subTotal;
    const grandTotal = Math.max(0, subTotal - disVal);
    const payCash = Math.max(0, body.payCash || 0);
    const payVisa = Math.max(0, body.payVisa || 0);
    console.log(`[pos-api]   Discount: dis=${disPercent}%, disVal=${disVal}, subTotal=${subTotal}, grandTotal=${grandTotal}`);

    // Format invTime as "HH.mm"
    const now = new Date();
    const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
    const invType = 'مبيعات';
    const notesText = body.notes || 'مبيعات';

    // Build PayTime string matching existing format: "YYYY-MM-DD HH:MM:SS AM/PM"
    const payHours = now.getHours();
    const payAmPm = payHours >= 12 ? 'PM' : 'AM';
    const payH12 = payHours % 12 || 12;
    const payTimeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(payH12).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} ${payAmPm}`;

    // Begin serializable transaction
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    console.log(`[pos-api]   Transaction started (SERIALIZABLE)`);

    try {
      // ──── 1. Generate safe invID with TABLOCKX ────
      const invIdResult = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS newInvID
        FROM [dbo].[TblinvServHead] WITH (TABLOCKX)
        WHERE invType = N'مبيعات'
      `);
      const newInvID = invIdResult.recordset[0].newInvID;
      console.log(`[pos-api]   Generated invID=${newInvID} for invType=مبيعات`);

      // ──── 2. Insert TblinvServHead ────
      const headReq = new sql.Request(transaction);
      headReq
        .input('invID',           sql.Int,            newInvID)
        .input('invType',         sql.NVarChar(20),   invType)
        .input('invDate',         sql.Date,           invDate)
        .input('invTime',         sql.NVarChar(50),   invTime)
        .input('ClientID',        sql.Int,            body.clientId || null)
        .input('UserID',          sql.Int,            userID)
        .input('TotalQty',        sql.Decimal(10,2),  body.totalQty)
        .input('SubTotal',        sql.Decimal(10,2),  subTotal)
        .input('Dis',             sql.Decimal(6,2),   disPercent)
        .input('DisVal',          sql.Decimal(10,2),  disVal)
        .input('Tax',             sql.Decimal(6,2),   0)
        .input('TaxVal',          sql.Decimal(10,2),  0)
        .input('GrandTotal',      sql.Decimal(10,2),  grandTotal)
        .input('invNotes',        sql.NVarChar(50),   notesText.substring(0, 50))
        .input('TotalBonus',      sql.Decimal(10,2),  body.totalBonus)
        .input('ShiftMoveID',     sql.Int,            shiftMoveID)
        .input('Notes',           sql.NVarChar(100),  notesText.substring(0, 100))
        .input('isActive',        sql.NVarChar(5),    'no')
        .input('Notes2',          sql.NVarChar(sql.MAX), '')
        .input('Payment',         sql.Decimal(10,2),  grandTotal)
        .input('PayDue',          sql.Decimal(10,2),  0)
        .input('PayCash',         sql.Decimal(10,2),  payCash)
        .input('PayVisa',         sql.Decimal(10,2),  payVisa)
        .input('PaymentMethodID', sql.Int,            body.paymentMethodId);

      await headReq.query(`
        INSERT INTO [dbo].[TblinvServHead] (
          invID, invType, invDate, invTime, ClientID, UserID,
          TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
          invNotes, TotalBonus, ShiftMoveID,
          ReservDate, ReservTime, Notes,
          PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID, @UserID,
          @TotalQty, @SubTotal, @Dis, @DisVal, @Tax, @TaxVal, @GrandTotal,
          @invNotes, @TotalBonus, @ShiftMoveID,
          NULL, NULL, @Notes,
          @PayCash, @PayVisa, @isActive, @Notes2, @Payment, @PayDue, @PaymentMethodID
        )
      `);
      console.log(`[pos-api]   ✅ TblinvServHead inserted: invID=${newInvID}, ClientID=${body.clientId || 'NULL'}, SubTotal=${subTotal}, DisVal=${disVal}, GrandTotal=${grandTotal}, PayCash=${payCash}, PayVisa=${payVisa}, PaymentMethodID=${body.paymentMethodId}, UserID=${userID}`);

      // ──── 3. Insert TblinvServDetail rows ────
      let detailCount = 0;
      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        const detReq = new sql.Request(transaction);
        detReq
          .input('invID',           sql.Int,            newInvID)
          .input('invType',         sql.NVarChar(20),   invType)
          .input('EmpID',           sql.Int,            item.empId)
          .input('ProID',           sql.Int,            item.proId)
          .input('Dis',             sql.Decimal(8,2),   item.dis)
          .input('DisVal',          sql.Decimal(8,2),   item.disVal)
          .input('SPrice',          sql.Decimal(10,2),  item.sPrice)
          .input('SValue',          sql.Decimal(10,2),  item.sPrice * item.qty)
          .input('SPriceAfterDis',  sql.Decimal(10,2),  item.sPriceAfterDis)
          .input('PPrice',          sql.Decimal(10,2),  0)
          .input('PValue',          sql.Decimal(10,2),  0)
          .input('Qty',             sql.Decimal(8,2),   item.qty)
          .input('Notes',           sql.NVarChar(50),   (item.notes || '').substring(0, 50))
          .input('Bonus',           sql.Decimal(8,2),   item.bonus)
          .input('ReservDate',      sql.Date,           null);

        await detReq.query(`
          INSERT INTO [dbo].[TblinvServDetail] (
            invID, invType, EmpID, ProID,
            Dis, DisVal, SPrice, SValue, SPriceAfterDis,
            PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
          ) VALUES (
            @invID, @invType, @EmpID, @ProID,
            @Dis, @DisVal, @SPrice, @SValue, @SPriceAfterDis,
            @PPrice, @PValue, @Qty, NULL, @Notes, @Bonus, @ReservDate
          )
        `);
        detailCount++;
      }
      console.log(`[pos-api]   ✅ TblinvServDetail inserted: ${detailCount} row(s)`);

      // ──── 4. Insert TblinvServPayment ────
      const payReq = new sql.Request(transaction);
      payReq
        .input('invID',           sql.Int,            newInvID)
        .input('invType',         sql.NVarChar(20),   invType)
        .input('PayDate',         sql.Date,           invDate)
        .input('PayTime',         sql.NVarChar(50),   payTimeStr)
        .input('PayValue',        sql.Decimal(10,2),  grandTotal)
        .input('Notes',           sql.NVarChar(4000), notesText.substring(0, 4000))
        .input('PaymentMethodID', sql.Int,            body.paymentMethodId)
        .input('ShiftMoveID',     sql.Int,            shiftMoveID);

      await payReq.query(`
        INSERT INTO [dbo].[TblinvServPayment] (
          invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
        ) VALUES (
          @invID, @invType, @PayDate, @PayTime, @PayValue, @Notes, @PaymentMethodID, @ShiftMoveID
        )
      `);
      console.log(`[pos-api]   ✅ TblinvServPayment inserted: PayValue=${grandTotal}, PaymentMethodID=${body.paymentMethodId}, ShiftMoveID=${shiftMoveID}`);

      // ──── 5. TblCashMove insertion handled by trigger [InsCashMoveSales] ────
      // REMOVED: Duplicate INSERT removed to prevent double entries
      // Trigger InsCashMoveSales on TblinvServHead will automatically insert into TblCashMove
      console.log(`[pos-api]   ℹ️  TblCashMove will be inserted by trigger InsCashMoveSales`);

      // ──── 6. Commit ────
      await transaction.commit();
      console.log(`[pos-api]   ✅ COMMITTED — invID=${newInvID}, invType=${invType}`);
      console.log(`[pos-api] ──── SAVE SALE COMPLETE ────`);

      // ──── 7. Send WhatsApp notification (fire and forget) ────
      if (body.clientId) {
        try {
          // Get customer phone and name
          const customerResult = await db.request()
            .input('clientId', sql.Int, body.clientId)
            .query(`
              SELECT ClientName, Mobile1 
              FROM [dbo].[TblClients] 
              WHERE ClientID = @clientId
            `);
          
          if (customerResult.recordset.length > 0) {
            const customer = customerResult.recordset[0];
            const phone = customer.Mobile1;
            const customerName = customer.ClientName;
            
            if (phone) {
              // Send WhatsApp notification in background
              const whatsappPayload = {
                phone: phone,
                saleData: {
                  orderId: newInvID.toString(),
                  amount: grandTotal.toFixed(2),
                  currency: 'ج.م',
                  customerName: customerName || 'عميل',
                  date: invDate,
                  time: invTime,
                  paymentMethod: body.paymentMethodId === 1 ? 'كاش' : 'فيزا'
                },
                type: 'sale',
                token: process.env.WHATSAPP_API_TOKEN || 'your-secret-token-change-this'
              };
              
              // Fire and forget - don't wait for response
              fetch('http://localhost:3000/api/sales/notify', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-token': process.env.WHATSAPP_API_TOKEN || 'your-secret-token-change-this'
                },
                body: JSON.stringify(whatsappPayload)
              }).catch(err => {
                console.error(`[pos-api]   ⚠️ WhatsApp notification failed (non-critical): ${err.message}`);
              });
              
              console.log(`[pos-api]   📱 WhatsApp notification queued for: ${phone}`);
            }
          }
        } catch (whatsappErr) {
          // Non-critical error - log but don't fail the sale
          console.error(`[pos-api]   ⚠️ WhatsApp notification error (non-critical): ${whatsappErr instanceof Error ? whatsappErr.message : whatsappErr}`);
        }
      }

      return NextResponse.json({ invID: newInvID, invType }, { status: 201 });

    } catch (err) {
      const rollbackReason = err instanceof Error ? err.message : String(err);
      console.error(`[pos-api]   ❌ ROLLING BACK — reason: ${rollbackReason}`);
      try { await transaction.rollback(); console.log(`[pos-api]   Rollback successful`); } catch (rbErr) {
        console.error(`[pos-api]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`);
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : '';
    console.error(`[pos-api] ❌ POST /api/sales FAILED: ${message}`);
    if (stack) console.error(`[pos-api]   Stack: ${stack}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
