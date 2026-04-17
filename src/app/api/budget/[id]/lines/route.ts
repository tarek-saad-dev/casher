import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { SaveBudgetLinePayload } from '@/lib/types';

// POST /api/budget/[id]/lines — Add a new budget line
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const budgetMonthID = parseInt(id);
    if (isNaN(budgetMonthID)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const body: SaveBudgetLinePayload = await req.json();

    if (!body.lineName?.trim()) {
      return NextResponse.json({ error: 'يجب إدخال اسم البند' }, { status: 400 });
    }
    if (!body.plannedAmount || body.plannedAmount <= 0) {
      return NextResponse.json({ error: 'يجب إدخال مبلغ مخطط أكبر من صفر' }, { status: 400 });
    }

    const db = await getPool();

    // Verify budget month exists
    const bmCheck = await db.request()
      .input('bmId', sql.Int, budgetMonthID)
      .query(`SELECT BudgetMonthID FROM [dbo].[TblBudgetMonth] WHERE BudgetMonthID = @bmId`);
    if (bmCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الميزانية غير موجودة' }, { status: 404 });
    }

    const insertResult = await db.request()
      .input('bmId', sql.Int, budgetMonthID)
      .input('lineType', sql.NVarChar(30), body.lineType || 'other')
      .input('expINID', sql.Int, body.expINID || null)
      .input('empID', sql.Int, body.empID || null)
      .input('lineName', sql.NVarChar(100), body.lineName.trim().substring(0, 100))
      .input('plannedAmount', sql.Decimal(18, 2), body.plannedAmount)
      .input('warningPct', sql.Decimal(5, 2), body.warningThresholdPct ?? 80)
      .input('hardCap', sql.Decimal(18, 2), body.hardCapAmount || null)
      .input('sortOrder', sql.Int, body.sortOrder || null)
      .input('notes', sql.NVarChar(250), (body.notes || '').substring(0, 250))
      .input('isActive', sql.Bit, body.isActive !== false ? 1 : 0)
      .query(`
        INSERT INTO [dbo].[TblBudgetMonthLine]
          (BudgetMonthID, LineType, ExpINID, EmpID, LineName,
           PlannedAmount, WarningThresholdPct, HardCapAmount,
           SortOrder, Notes, IsActive)
        OUTPUT INSERTED.ID
        VALUES
          (@bmId, @lineType, @expINID, @empID, @lineName,
           @plannedAmount, @warningPct, @hardCap,
           @sortOrder, @notes, @isActive)
      `);

    const newID = insertResult.recordset[0].ID;
    console.log(`[budget] Created BudgetLine: ID=${newID}, BudgetMonthID=${budgetMonthID}, "${body.lineName}"`);

    return NextResponse.json({ ID: newID }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/[id]/lines] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
