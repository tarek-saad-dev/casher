import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

/**
 * PATCH /api/reports/employee-services/reassign
 * Reassign an invoice's service lines from one employee to another.
 *
 * Body: { invoiceId: number, invoiceType: string, oldEmpId: number, newEmpId: number }
 *
 * This updates EmpID in TblinvServDetail for the given invoice + old employee.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoiceId, invoiceType, oldEmpId, newEmpId } = body;

    if (!invoiceId || !invoiceType || !oldEmpId || !newEmpId) {
      return NextResponse.json(
        { error: 'البيانات المطلوبة ناقصة: invoiceId, invoiceType, oldEmpId, newEmpId' },
        { status: 400 }
      );
    }

    if (oldEmpId === newEmpId) {
      return NextResponse.json(
        { error: 'الموظف الجديد هو نفسه الحالي' },
        { status: 400 }
      );
    }

    const db = await getPool();

    // Verify the new employee exists
    const empCheck = await db.request()
      .input('newEmpId', sql.Int, newEmpId)
      .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @newEmpId`);

    if (empCheck.recordset.length === 0) {
      return NextResponse.json(
        { error: 'الموظف الجديد غير موجود' },
        { status: 404 }
      );
    }

    // Update the detail rows
    const result = await db.request()
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

    const rowsAffected = result.rowsAffected[0] ?? 0;

    if (rowsAffected === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على سطور مطابقة للتحديث' },
        { status: 404 }
      );
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
