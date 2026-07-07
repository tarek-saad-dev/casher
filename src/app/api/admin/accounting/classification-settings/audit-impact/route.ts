import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import {
  classifyCashMove,
  emptySettingsBundle,
} from '@/lib/accounting/cashMoveClassification';
import { loadClassificationSettings } from '@/lib/accounting/accountingSettingsService';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom') ?? undefined;
    const dateTo = searchParams.get('dateTo') ?? undefined;
    const limit = Math.min(Number(searchParams.get('limit') ?? 500), 2000);

    if (dateFrom && !DATE_RE.test(dateFrom)) {
      return NextResponse.json({ error: 'dateFrom غير صالح' }, { status: 400 });
    }
    if (dateTo && !DATE_RE.test(dateTo)) {
      return NextResponse.json({ error: 'dateTo غير صالح' }, { status: 400 });
    }

    const pool = await getPool();
    const where: string[] = [];
    const req = pool.request();
    if (dateFrom) { where.push('cm.invDate >= @dateFrom'); req.input('dateFrom', sql.Date, dateFrom); }
    if (dateTo) { where.push('cm.invDate <= @dateTo'); req.input('dateTo', sql.Date, dateTo); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    req.input('limit', sql.Int, limit);
    const data = await req.query(`
      SELECT TOP (@limit)
        cm.ID AS CashMoveID, cm.invDate, cm.GrandTolal AS amount, cm.inOut, cm.invType,
        cm.ExpINID, cat.CatName AS categoryName, cm.Notes AS notes, cm.EmpID,
        ISNULL(cm.IsPayrollDeduction,0) AS IsPayrollDeduction,
        ISNULL(cm.IsEmployeePayrollIncome,0) AS IsEmployeePayrollIncome
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      ${whereClause}
      ORDER BY cm.invDate DESC, cm.ID DESC
    `);

    const settings = await loadClassificationSettings();
    const empty = emptySettingsBundle();

    let beforeReview = 0;
    let afterReview = 0;
    const fixedRows: Array<{ cashMoveId: number; categoryName: string | null; before: boolean; after: boolean }> = [];
    const remainingRisky: Array<{ cashMoveId: number; categoryName: string | null; reason: string }> = [];

    for (const row of data.recordset) {
      const input = {
        cashMoveId: row.CashMoveID,
        invDate: String(row.invDate).slice(0, 10),
        amount: Number(row.amount),
        inOut: row.inOut,
        invType: row.invType,
        expInId: row.ExpINID,
        categoryName: row.categoryName,
        notes: row.notes,
        empId: row.EmpID,
        isPayrollDeduction: row.IsPayrollDeduction === 1,
        isEmployeePayrollIncome: row.IsEmployeePayrollIncome === 1,
        linkedPayrollTxn: null,
        empIdFromCategoryMap: null,
      };
      const before = classifyCashMove(input, empty);
      const after = classifyCashMove(input, settings);
      if (before.needsReview) beforeReview += 1;
      if (after.needsReview) afterReview += 1;
      if (before.needsReview && !after.needsReview) {
        fixedRows.push({
          cashMoveId: before.cashMoveId,
          categoryName: before.categoryName,
          before: before.needsReview,
          after: after.needsReview,
        });
      }
      if (after.needsReview) {
        remainingRisky.push({
          cashMoveId: after.cashMoveId,
          categoryName: after.categoryName,
          reason: after.reason,
        });
      }
    }

    return NextResponse.json({
      sampleSize: data.recordset.length,
      beforeNeedsReview: beforeReview,
      afterNeedsReview: afterReview,
      fixedByAdminMappings: fixedRows.length,
      fixedRows: fixedRows.slice(0, 50),
      remainingRisky: remainingRisky.slice(0, 50),
      settingsLoaded: settings.loaded,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}
