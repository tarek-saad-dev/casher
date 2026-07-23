import 'server-only';

import { getPool, sql } from '@/lib/db';
import { roundMoney } from '@/lib/reportMonthUtils';
import { isExcludedPartnersExpenseCategory } from '@/lib/reports/partnersExpenseCategories';
import type { PartnersExpenseCategoryTransaction } from '@/lib/types/partners-report';

export type { PartnersExpenseCategoryTransaction };

function formatSqlDate(invDate: Date | string): string {
  if (invDate instanceof Date && !Number.isNaN(invDate.getTime())) {
    return invDate.toISOString().split('T')[0];
  }

  const value = String(invDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return '';
}

function formatSqlTime(invTime: unknown): string | null {
  if (invTime == null || invTime === '') return null;

  const value = String(invTime).trim();
  const match = value.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  return match ? match[1] : value;
}

export async function getPartnersExpenseCategoryTransactions(
  year: number,
  month: number,
  categoryId: number | null,
  categoryName: string,
  branchId: number,
): Promise<PartnersExpenseCategoryTransaction[]> {
  if (isExcludedPartnersExpenseCategory(categoryName)) {
    throw new Error('هذه الفئة مستبعدة من تقرير الشركاء');
  }

  const db = await getPool();
  const request = db.request()
    .input('year', sql.Int, year)
    .input('month', sql.Int, month)
    .input('branchId', sql.Int, branchId)
    .input('categoryName', sql.NVarChar, categoryName);

  const categoryFilter =
    categoryId !== null
      ? 'cm.ExpINID = @categoryId'
      : "cm.ExpINID IS NULL AND ISNULL(cat.CatName, N'غير مصنف') = @categoryName";

  if (categoryId !== null) {
    request.input('categoryId', sql.Int, categoryId);
  }

  const result = await request.query(`
    SELECT
      cm.ID AS id,
      cm.ExpINID AS categoryId,
      ISNULL(cat.CatName, N'غير مصنف') AS categoryName,
      cm.invDate,
      cm.invTime,
      cm.Notes AS notes,
      ISNULL(pm.PaymentMethod, N'') AS paymentMethod,
      cm.GrandTolal AS amount
    FROM [dbo].[TblCashMove] cm
    LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
    LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
    WHERE cm.invType = N'مصروفات'
      AND cm.inOut = N'out'
      AND YEAR(cm.invDate) = @year
      AND MONTH(cm.invDate) = @month
      AND cm.BranchID = @branchId
      AND ${categoryFilter}
    ORDER BY cm.invDate DESC, cm.invTime DESC
  `);

  return result.recordset.map((row: {
    id: number;
    categoryId: number | null;
    categoryName: string;
    invDate: Date | string;
    invTime: unknown;
    notes: string | null;
    paymentMethod: string;
    amount: number;
  }) => ({
    id: row.id,
    categoryId: row.categoryId ?? null,
    categoryName: row.categoryName,
    date: formatSqlDate(row.invDate),
    time: formatSqlTime(row.invTime),
    notes: row.notes?.trim() || null,
    paymentMethod: row.paymentMethod?.trim() || null,
    amount: roundMoney(row.amount ?? 0),
  }));
}
