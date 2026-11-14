/**
 * Real SQL paid booking-handoff recovery acceptance.
 *
 * Called only by salon-booking-e2e-staging.ts after a brand-new synthetic
 * staging tenant exists. NEVER run against production or a CUT tenant.
 * Manually inserts a disposable paid invoice (not an actual payment),
 * verifies the reconciliation policy, then deletes *every* synthetic row.
 */
import sql from 'mssql';

type Args = {
  pool: sql.ConnectionPool;
  tenantId: string;
  branchId: number;
  empId: number;
  originalBookingId: number;
  actorUserId: number;
  serviceId: number;
  servicePrice: number;
};

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
  console.log('PASS: ' + label);
}

export async function runHandoffRecoveryStaging(a: Args): Promise<void> {
  const who = await a.pool.request().query(
    "SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName"
  );
  check(who.recordset[0]?.dbName === 'last132_agent' &&
    String(who.recordset[0]?.loginName).toLowerCase() === 'drvo_agent',
    'Paid invoice reconciliation is isolated to staging database and staging login');
  const owner = await a.pool.request()
    .input('tenant', sql.UniqueIdentifier, a.tenantId)
    .input('branch', sql.Int, a.branchId)
    .input('emp', sql.Int, a.empId)
    .query(
      "SELECT TOP 1 e.EmpID FROM dbo.TblEmp e " +
      "INNER JOIN dbo.Location l ON l.TenantId=e.TenantId " +
      "WHERE e.TenantId=@tenant AND e.EmpID=@emp AND l.LegacyBranchId=@branch"
    );
  check(owner.recordset.length === 1, 'Financial test branch and employee belong to disposable tenant');
  const { allocateInvID } = await import('../../src/lib/db');
  const { upsertEmployeeHandoff, markHandoffCharged } =
    await import('../../src/lib/booking/cashierHandoff');

  let bookingId: number | null = null;
  let handoffId: number | null = null;
  let invoiceId: number | null = null;
  try {
    const inserted = await a.pool.request()
      .input('id', sql.Int, a.originalBookingId)
      .input('code', sql.NVarChar(40), 'QA-PAID-' + Math.random().toString(36).slice(2, 10))
      .query(
        "INSERT INTO dbo.Bookings " +
        "(ClientID,AssignedEmpID,BookingDate,StartTime,EndTime,Status,Source," +
        "BookingCode,CreatedByUserID,BranchID,PublicWorkDate,PublicDayOffset,AbsoluteStartUtc,AbsoluteEndUtc) " +
        "OUTPUT INSERTED.BookingID " +
        "SELECT ClientID,AssignedEmpID,BookingDate,StartTime,EndTime,N'confirmed',Source," +
        "@code,CreatedByUserID,BranchID,PublicWorkDate,PublicDayOffset,AbsoluteStartUtc,AbsoluteEndUtc " +
        "FROM dbo.Bookings WHERE BookingID=@id"
      );
    bookingId = Number(inserted.recordset[0]?.BookingID);
    check(Number.isSafeInteger(bookingId) && bookingId > 0,
      'Disposable second booking is created inside staging tenant');

    await a.pool.request().input('copy', sql.Int, a.originalBookingId)
      .input('new', sql.Int, bookingId)
      .query(
        "INSERT INTO dbo.BookingServices (BookingID,ProID,EmpID,Qty,Price,DurationMinutes) " +
        "SELECT @new,ProID,EmpID,Qty,Price,DurationMinutes FROM dbo.BookingServices WHERE BookingID=@copy"
      );
    const booked = await a.pool.request()
      .input('id', sql.Int, bookingId)
      .input('defaultEmployee', sql.Int, a.empId)
      .query(
        "SELECT ProID,ISNULL(EmpID,@defaultEmployee) AS EmpID,Qty " +
        "FROM dbo.BookingServices WHERE BookingID=@id ORDER BY BookingServiceID"
      );
    const rows = booked.recordset as Array<{ ProID:number; EmpID:number; Qty:number }>;
    const qty = rows.filter(row => row.ProID === a.serviceId)
      .reduce((n, row) => n + Number(row.Qty), 0);
    check(qty > 0 && Number.isSafeInteger(qty), 'Disposable booking has real reserved services');
    const h = await upsertEmployeeHandoff({
      bookingId, empId: a.empId, tenantId: a.tenantId,
      services: [{proId: a.serviceId,qty,source: 'booked'}],
    });
    check(h.ok, 'Staging booking is submitted to cashier without charging');
    if (!h.ok) throw new Error('Unexpected handoff rejection');
    handoffId = h.handoffId;

    const pm = await a.pool.request()
      .query("SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods ORDER BY PaymentID");
    const methodId = Number(pm.recordset[0]?.PaymentID);
    check(Number.isSafeInteger(methodId) && methodId > 0, 'Staging payment method exists');
    const client = await a.pool.request().input('id', sql.Int, bookingId)
      .query('SELECT ClientID FROM dbo.Bookings WHERE BookingID=@id');
    const clientId = Number(client.recordset[0]?.ClientID);
    check(clientId > 0, 'Synthetic invoice belongs to the booked customer');

    const price = Number(a.servicePrice);
    const total = Math.round(price * qty * 100) / 100;
    check(Number.isFinite(total) && total > 0, 'Synthetic invoice has a positive total');
    const today = new Date().toISOString().slice(0, 10);
    const invType = 'مبيعات';
    const tx = new sql.Transaction(a.pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      invoiceId = await allocateInvID(tx, 'TblinvServHead', invType, 5000);
      const marker = 'STAGING RECOVERY\nCUT_HANDOFF:' + handoffId + '|';
      await new sql.Request(tx)
        .input('id', sql.Int, invoiceId)
        .input('type', sql.NVarChar(20), invType)
        .input('date', sql.Date, today)
        .input('client', sql.Int, clientId)
        .input('user', sql.Int, a.actorUserId)
        .input('qty', sql.Decimal(10,2), qty)
        .input('total', sql.Decimal(10,2), total)
        .input('method', sql.Int, methodId)
        .input('branch', sql.Int, a.branchId)
        .input('notes2', sql.NVarChar(sql.MAX), marker)
        .query(
          "INSERT INTO dbo.TblinvServHead (" +
          "invID,invType,invDate,invTime,ClientID,UserID,TotalQty,SubTotal," +
          "Dis,DisVal,Tax,TaxVal,GrandTotal,invNotes,TotalBonus,ShiftMoveID," +
          "ReservDate,ReservTime,Notes,PayCash,PayVisa,isActive,Notes2," +
          "Payment,PayDue,PaymentMethodID,BranchID,BusinessDayID) " +
          "VALUES (@id,@type,@date,N'12:00',@client,@user,@qty,@total," +
          "0,0,0,0,@total,N'STAGING ONLY',0,NULL,NULL,NULL,N'STAGING ONLY'," +
          "@total,0,N'no',@notes2,@total,0,@method,@branch,NULL)"
        );
      for (const r of rows) {
        await new sql.Request(tx)
          .input('id', sql.Int, invoiceId)
          .input('type', sql.NVarChar(20), invType)
          .input('emp', sql.Int, r.EmpID)
          .input('pro', sql.Int, r.ProID)
          .input('qty', sql.Decimal(8,2), r.Qty)
          .input('price', sql.Decimal(10,2), price)
          .input('total', sql.Decimal(10,2), price * r.Qty)
          .query(
            "INSERT INTO dbo.TblinvServDetail (" +
            "invID,invType,EmpID,ProID,Dis,DisVal,SPrice,SValue,SPriceAfterDis," +
            "PPrice,PValue,Qty,ProType,Notes,Bonus,ReservDate) " +
            "VALUES (@id,@type,@emp,@pro,0,0,@price,@total,@total," +
            "0,0,@qty,NULL,N'STAGING ONLY',0,NULL)"
          );
      }
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch { /* transaction already rolled back */ }
      throw error;
    }
    check(Number.isInteger(invoiceId) && invoiceId > 0, 'Synthetic POS invoice inserted');

    // Important negative gates: a fake handoff reference or an unpaid invoice
    // must not change the booking status or handoff status.
    const wrongBranch = await markHandoffCharged({
      handoffId, branchId: a.branchId + 100000, tenantId: a.tenantId,
      invId: invoiceId, invType,
    });
    check(!wrongBranch, 'Different branch cannot claim another branch invoice');
    const wrongTenant = await markHandoffCharged({
      handoffId, branchId: a.branchId,
      tenantId: '00000000-0000-0000-0000-000000000000', invId: invoiceId, invType,
    });
    check(!wrongTenant, 'Different tenant cannot link a paid invoice');
    const noPayment = await markHandoffCharged({
      handoffId, branchId: a.branchId, tenantId: a.tenantId, invId: invoiceId, invType,
    });
    check(!noPayment, 'Invoice header alone does not mark a booking as charged');

    const payment = await a.pool.request()
      .input('id', sql.Int, invoiceId)
      .input('type', sql.NVarChar(20), invType)
      .input('date', sql.Date, today)
      .input('total', sql.Decimal(10,2), total)
      .input('method', sql.Int, methodId)
      .query(
        "INSERT INTO dbo.TblinvServPayment " +
        "(invID,invType,PayDate,PayTime,PayValue,Notes,PaymentMethodID,ShiftMoveID) " +
        "VALUES (@id,@type,@date,N'12:00',@total,N'STAGING ONLY',@method,NULL)"
      );
    check(payment.rowsAffected[0] === 1, 'Synthetic invoice has one paid allocation');
    const linked = await markHandoffCharged({
      handoffId, branchId: a.branchId, tenantId: a.tenantId, invId: invoiceId, invType,
    });
    check(linked, 'Paid invoice synchronizes the existing booking and cashier handoff');
    const replay = await markHandoffCharged({
      handoffId, branchId: a.branchId, tenantId: a.tenantId, invId: invoiceId, invType,
    });
    check(replay, 'Retry of the same invoice is idempotent');
    const persisted = await a.pool.request().input('bid',sql.Int,bookingId)
      .input('id',sql.Int,invoiceId).input('h',sql.Int,handoffId)
      .query(
        "SELECT b.Status,b.ConvertedInvID,h.Status AS HStatus,h.ChargedInvID " +
        "FROM dbo.Bookings b JOIN dbo.TblBookingCashierHandoff h ON h.BookingID=b.BookingID " +
        "WHERE b.BookingID=@bid AND h.HandoffID=@h"
      );
    const state = persisted.recordset[0];
    check(state?.Status === 'completed' && state.ConvertedInvID === invoiceId &&
      state.HStatus === 'charged' && state.ChargedInvID === invoiceId,
      'One committed invoice updates both booking and handoff exactly once');
    console.log('SALON_PAID_HANDOFF_RECOVERY_STAGING_PASS');
  } finally {
    // Recover even if the test failed midway. Delete only IDs created here
    // and only after verifying the dedicated tenant again.
    const whoAgain = await a.pool.request().query("SELECT DB_NAME() AS name");
    check(whoAgain.recordset[0]?.name === 'last132_agent', 'Cleanup remains on staging');
    if (bookingId != null) {
      await a.pool.request()
        .input('bid',sql.Int,bookingId)
        .query("UPDATE dbo.Bookings SET ConvertedInvID=NULL,ConvertedInvType=NULL WHERE BookingID=@bid");
    }
    if (handoffId != null) {
      await a.pool.request().input('id',sql.Int,handoffId)
        .query("DELETE FROM dbo.TblBookingCashierHandoff WHERE HandoffID=@id");
    }
    if (invoiceId != null) {
      await a.pool.request().input('id',sql.Int,invoiceId)
        .input('type',sql.NVarChar(20),'مبيعات')
        .query(
          "IF OBJECT_ID(N'dbo.TblCashMove',N'U') IS NOT NULL " +
          "DELETE FROM dbo.TblCashMove WHERE InvID=@id AND invType=@type; " +
          "IF OBJECT_ID(N'dbo.TblLoyaltyPointLedger',N'U') IS NOT NULL " +
          "DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID=@id; " +
          "DELETE FROM dbo.TblinvServPayment WHERE invID=@id AND invType=@type; " +
          "DELETE FROM dbo.TblinvServDetail WHERE invID=@id AND invType=@type; " +
          "DELETE FROM dbo.TblinvServHead WHERE invID=@id AND invType=@type;"
        );
    }
    if (bookingId != null) {
      await a.pool.request().input('bid',sql.Int,bookingId)
        .query("DELETE FROM dbo.BookingServices WHERE BookingID=@bid; DELETE FROM dbo.Bookings WHERE BookingID=@bid");
    }
  }
}
