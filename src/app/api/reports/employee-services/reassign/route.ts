import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * PATCH /api/reports/employee-services/reassign
 * Reassign an invoice's service lines from one employee to another.
 *
 * Body: { invoiceId: number, invoiceType: string, oldEmpId: number, newEmpId: number }
 *
 * Updates EmpID in TblinvServDetail inside a TX + durable target recalc enqueue.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();
    const { invoiceId, invoiceType, oldEmpId, newEmpId } = body;

    if (!invoiceId || !invoiceType || !oldEmpId || !newEmpId) {
      return NextResponse.json(
        { error: 'البيانات المطلوبة ناقصة: invoiceId, invoiceType, oldEmpId, newEmpId' },
        { status: 400 },
      );
    }

    if (oldEmpId === newEmpId) {
      return NextResponse.json(
        { error: 'الموظف الجديد هو نفسه الحالي' },
        { status: 400 },
      );
    }

    const db = await getPool();

    const empCheck = await db
      .request()
      .input('newEmpId', sql.Int, newEmpId)
      .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @newEmpId`);

    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف الجديد غير موجود' }, { status: 404 });
    }

    const transaction = new sql.Transaction(db);
    await transaction.begin();

    let targetRecalcScopes: import('@/lib/payroll/employee-target/employee-target-recalc-scope').TargetRecalcScope[] =
      [];
    let rowsAffected = 0;

    try {
      const head = await new sql.Request(transaction)
        .input('invoiceId', sql.Int, invoiceId)
        .input('invoiceType', sql.NVarChar(50), invoiceType)
        .query(`
          SELECT CONVERT(char(10), invDate, 126) AS workDate
          FROM dbo.TblinvServHead
          WHERE invID = @invoiceId AND invType = @invoiceType
        `);

      if (head.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });
      }

      const workDate = String((head.recordset[0] as { workDate: string }).workDate);

      const beforeDetails = await new sql.Request(transaction)
        .input('invoiceId', sql.Int, invoiceId)
        .input('invoiceType', sql.NVarChar(50), invoiceType)
        .query(`
          SELECT EmpID FROM dbo.TblinvServDetail
          WHERE invID = @invoiceId AND invType = @invoiceType AND EmpID IS NOT NULL
        `);

      const result = await new sql.Request(transaction)
        .input('invoiceId', sql.Int, invoiceId)
        .input('invoiceType', sql.NVarChar(50), invoiceType)
        .input('oldEmpId', sql.Int, oldEmpId)
        .input('newEmpId', sql.Int, newEmpId)
        .query(`
          UPDATE dbo.TblinvServDetail
          SET EmpID = @newEmpId
          WHERE invID = @invoiceId
            AND invType = @invoiceType
            AND EmpID = @oldEmpId
        `);

      rowsAffected = result.rowsAffected[0] ?? 0;
      if (rowsAffected === 0) {
        await transaction.rollback();
        return NextResponse.json(
          { error: 'لم يتم العثور على سطور مطابقة للتحديث' },
          { status: 404 },
        );
      }

      const afterDetails = await new sql.Request(transaction)
        .input('invoiceId', sql.Int, invoiceId)
        .input('invoiceType', sql.NVarChar(50), invoiceType)
        .query(`
          SELECT EmpID FROM dbo.TblinvServDetail
          WHERE invID = @invoiceId AND invType = @invoiceType AND EmpID IS NOT NULL
        `);

      // Only مبيعات feeds daily-target sales KPI
      if (String(invoiceType) === 'مبيعات') {
        const { enqueueTargetRecalcFromInvoiceSnapshots } = await import(
          '@/lib/payroll/employee-target/employee-target-invoice-sync'
        );
        targetRecalcScopes = await enqueueTargetRecalcFromInvoiceSnapshots({
          transaction,
          beforeSnapshot: {
            header: { invDate: workDate },
            details: beforeDetails.recordset,
          },
          afterSnapshot: {
            header: { invDate: workDate },
            details: afterDetails.recordset,
          },
          reason: 'employee_reassign',
          sourceType: 'TblinvServDetail',
          sourceRef: String(invoiceId),
        });
      }

      await transaction.commit();
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {
        /* ignore */
      }
      throw err;
    }

    if (targetRecalcScopes.length > 0) {
      const { tryProcessAfterInvoiceCommit } = await import(
        '@/lib/payroll/employee-target/employee-target-invoice-sync'
      );
      void tryProcessAfterInvoiceCommit({
        scopes: targetRecalcScopes,
        actorUserId: session?.UserID ?? null,
      });
    }

    const newEmpName = empCheck.recordset[0].EmpName;

    return NextResponse.json({
      success: true,
      rowsAffected,
      newEmpId,
      newEmpName,
      message: `تم نقل ${rowsAffected} خدمة من الفاتورة #${invoiceId} إلى ${newEmpName}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/reports/employee-services/reassign] PATCH error:', message);
    return NextResponse.json({ error: 'تعذّر إعادة تعيين الموظف على الفاتورة' }, { status: 500 });
  }
}
