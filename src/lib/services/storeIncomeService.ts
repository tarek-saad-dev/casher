import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import {
  STORE_OTHER_BUSINESS_INCOME_CATEGORY,
  storeIncomeCategoryName,
  type StoreIncomeKind,
} from '@/lib/accounting/storeIncome';

async function resolveIncomeCategoryTenantId(
  transaction: sql.Transaction,
  preferredTenantId?: string | null,
): Promise<string> {
  const preferred = String(preferredTenantId ?? '').trim();
  if (preferred) return preferred;

  const result = await new sql.Request(transaction).query(`
    SELECT TOP 1 CAST(TenantId AS nvarchar(36)) AS TenantId
    FROM dbo.TblExpINCat
    WHERE ExpINType = N'ايرادات'
      AND TenantId IS NOT NULL
    GROUP BY TenantId
    ORDER BY COUNT(*) DESC
  `);
  const tenantId = String(result.recordset[0]?.TenantId ?? '').trim();
  if (!tenantId) {
    throw new Error('تعذر تحديد TenantId لتصنيفات الإيراد');
  }
  return tenantId;
}

export async function ensureStoreIncomeCategory(
  transaction: sql.Transaction,
  kind: StoreIncomeKind,
  preferredTenantId?: string | null,
): Promise<{ expInId: number; categoryName: string }> {
  const categoryName = storeIncomeCategoryName(kind);
  const tenantId = await resolveIncomeCategoryTenantId(transaction, preferredTenantId);

  const findResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), categoryName)
    .input('expType', sql.NVarChar(50), 'ايرادات')
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TOP 1 ExpINID, ISNULL(IsActive, 1) AS IsActive
      FROM dbo.TblExpINCat
      WHERE CatName = @catName
        AND ExpINType = @expType
        AND TenantId = @tenantId
      ORDER BY ExpINID ASC
    `);

  if (findResult.recordset.length > 0) {
    const row = findResult.recordset[0] as { ExpINID: number; IsActive: boolean | number };
    const expInId = Number(row.ExpINID);
    if (!row.IsActive) {
      await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .query(`UPDATE dbo.TblExpINCat SET IsActive = 1 WHERE ExpINID = @expInId`);
    }
    // Store income must never be employee-mapped.
    await new sql.Request(transaction)
      .input('expInId', sql.Int, expInId)
      .query(`
        UPDATE dbo.TblExpCatEmpMap
        SET IsActive = 0
        WHERE ExpINID = @expInId AND ISNULL(IsActive, 1) = 1
      `);
    return { expInId, categoryName };
  }

  // Fallback: same name on any tenant (legacy single-tenant rows)
  const legacy = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), categoryName)
    .input('expType', sql.NVarChar(50), 'ايرادات')
    .query(`
      SELECT TOP 1 ExpINID, ISNULL(IsActive, 1) AS IsActive
      FROM dbo.TblExpINCat
      WHERE CatName = @catName AND ExpINType = @expType
      ORDER BY ExpINID ASC
    `);
  if (legacy.recordset.length > 0) {
    const row = legacy.recordset[0] as { ExpINID: number; IsActive: boolean | number };
    const expInId = Number(row.ExpINID);
    if (!row.IsActive) {
      await new sql.Request(transaction)
        .input('expInId', sql.Int, expInId)
        .query(`UPDATE dbo.TblExpINCat SET IsActive = 1 WHERE ExpINID = @expInId`);
    }
    await new sql.Request(transaction)
      .input('expInId', sql.Int, expInId)
      .query(`
        UPDATE dbo.TblExpCatEmpMap
        SET IsActive = 0
        WHERE ExpINID = @expInId AND ISNULL(IsActive, 1) = 1
      `);
    return { expInId, categoryName };
  }

  const insertResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), categoryName)
    .input('expType', sql.NVarChar(50), 'ايرادات')
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (@tenantId, @catName, @expType)
    `);

  return {
    expInId: Number(insertResult.recordset[0].ExpINID),
    categoryName,
  };
}

/** Ensure both store categories exist (for meta / picker). */
export async function ensureStoreIncomeCategories(
  preferredTenantId?: string | null,
): Promise<void> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  try {
    await ensureStoreIncomeCategory(transaction, 'other_business_income', preferredTenantId);
    await ensureStoreIncomeCategory(transaction, 'non_revenue_cash_in', preferredTenantId);
    await transaction.commit();
  } catch (err) {
    try { await transaction.rollback(); } catch { /* ignore */ }
    throw err;
  }
}

export async function findDuplicateStoreIncome(
  transaction: sql.Transaction,
  params: {
    branchId: number;
    invDate: string;
    expInId: number;
    amount: number;
    paymentMethodId: number;
  },
): Promise<{ ID: number; invID: number } | null> {
  const result = await new sql.Request(transaction)
    .input('branchId', sql.Int, params.branchId)
    .input('invDate', sql.Date, params.invDate)
    .input('expInId', sql.Int, params.expInId)
    .input('amount', sql.Decimal(10, 2), params.amount)
    .input('paymentMethodId', sql.Int, params.paymentMethodId)
    .query(`
      SELECT TOP 1 ID, invID
      FROM dbo.TblCashMove
      WHERE invType = N'ايرادات'
        AND BranchID = @branchId
        AND invDate = @invDate
        AND ExpINID = @expInId
        AND GrandTolal = @amount
        AND PaymentMethodID = @paymentMethodId
        AND EmpID IS NULL
      ORDER BY ID DESC
    `);

  if (result.recordset.length === 0) return null;
  const row = result.recordset[0] as { ID: number; invID: number };
  return { ID: Number(row.ID), invID: Number(row.invID) };
}

export type StoreOtherBusinessIncomeTransaction = {
  id: number;
  categoryId: number | null;
  categoryName: string;
  date: string;
  time: string | null;
  notes: string | null;
  paymentMethod: string | null;
  amount: number;
};

function formatSqlDate(invDate: Date | string): string {
  if (invDate instanceof Date && !Number.isNaN(invDate.getTime())) {
    return invDate.toISOString().split('T')[0];
  }
  const value = String(invDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return '';
}

function formatSqlTime(invTime: unknown): string | null {
  if (invTime == null || invTime === '') return null;
  const value = String(invTime).trim();
  const match = value.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  return match ? match[1] : value;
}

/**
 * Profit-affecting store income only («إيراد آخر للمحل»).
 * Used by partners legacy totals so classified path does not double-count
 * (classified adds otherBusinessIncome separately).
 */
export async function sumStoreOtherBusinessIncomeForMonth(
  year: number,
  month: number,
  branchId: number,
): Promise<number> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();
  const result = await db.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('branchId', sql.Int, branchId)
    .input('catName', sql.NVarChar(200), STORE_OTHER_BUSINESS_INCOME_CATEGORY)
    .query(`
      SELECT ISNULL(SUM(cm.GrandTolal), 0) AS Total
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      WHERE cm.invType = N'ايرادات'
        AND cm.inOut = N'in'
        AND cm.BranchID = @branchId
        AND cm.invDate >= @startDate AND cm.invDate <= @endDate
        AND cm.EmpID IS NULL
        AND cat.CatName = @catName
        AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
    `);

  return roundMoney(Number(result.recordset[0]?.Total) || 0);
}

/** Detail rows for partners report expand — same filter as the sum (profit store income only). */
export async function listStoreOtherBusinessIncomeForMonth(
  year: number,
  month: number,
  branchId: number,
): Promise<StoreOtherBusinessIncomeTransaction[]> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();
  const result = await db.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('branchId', sql.Int, branchId)
    .input('catName', sql.NVarChar(200), STORE_OTHER_BUSINESS_INCOME_CATEGORY)
    .query(`
      SELECT
        cm.ID AS id,
        cm.ExpINID AS categoryId,
        cat.CatName AS categoryName,
        cm.invDate,
        cm.invTime,
        cm.Notes AS notes,
        ISNULL(pm.PaymentMethod, N'') AS paymentMethod,
        cm.GrandTolal AS amount
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      LEFT JOIN dbo.TblPaymentMethods pm ON cm.PaymentMethodID = pm.PaymentID
      WHERE cm.invType = N'ايرادات'
        AND cm.inOut = N'in'
        AND cm.BranchID = @branchId
        AND cm.invDate >= @startDate AND cm.invDate <= @endDate
        AND cm.EmpID IS NULL
        AND cat.CatName = @catName
        AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
      ORDER BY cm.invDate DESC, cm.invTime DESC, cm.ID DESC
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
    id: Number(row.id),
    categoryId: row.categoryId != null ? Number(row.categoryId) : null,
    categoryName: String(row.categoryName ?? STORE_OTHER_BUSINESS_INCOME_CATEGORY),
    date: formatSqlDate(row.invDate),
    time: formatSqlTime(row.invTime),
    notes: row.notes?.trim() || null,
    paymentMethod: row.paymentMethod?.trim() || null,
    amount: roundMoney(Number(row.amount) || 0),
  }));
}
