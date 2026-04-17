import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { SaveBudgetLinePayload } from '@/lib/types';

// PUT /api/budget/[id]/lines/[lineId] — Update a budget line
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const { id, lineId } = await params;
    const budgetMonthID = parseInt(id);
    const lineID = parseInt(lineId);
    if (isNaN(budgetMonthID) || isNaN(lineID)) {
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

    await db.request()
      .input('lineId', sql.Int, lineID)
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
        UPDATE [dbo].[TblBudgetMonthLine]
        SET LineType = @lineType,
            ExpINID = @expINID,
            EmpID = @empID,
            LineName = @lineName,
            PlannedAmount = @plannedAmount,
            WarningThresholdPct = @warningPct,
            HardCapAmount = @hardCap,
            SortOrder = @sortOrder,
            Notes = @notes,
            IsActive = @isActive
        WHERE ID = @lineId AND BudgetMonthID = @bmId
      `);

    console.log(`[budget] Updated BudgetLine: ID=${lineID}`);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/lines] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/budget/[id]/lines/[lineId] — Delete a budget line
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const { id, lineId } = await params;
    const budgetMonthID = parseInt(id);
    const lineID = parseInt(lineId);
    if (isNaN(budgetMonthID) || isNaN(lineID)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    await db.request()
      .input('lineId', sql.Int, lineID)
      .input('bmId', sql.Int, budgetMonthID)
      .query(`
        DELETE FROM [dbo].[TblBudgetMonthLine]
        WHERE ID = @lineId AND BudgetMonthID = @bmId
      `);

    console.log(`[budget] Deleted BudgetLine: ID=${lineID}`);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/lines] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
