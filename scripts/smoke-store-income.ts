#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Smoke: ensure store income categories + show per-branch cash/P&L impact.
 * Creates categories if missing. Does NOT insert CashMoves.
 *
 *   npx tsx scripts/smoke-store-income.ts
 */
import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import {
  STORE_NON_REVENUE_CASH_IN_CATEGORY,
  STORE_OTHER_BUSINESS_INCOME_CATEGORY,
} from '../src/lib/accounting/storeIncome';
import { classifyCategoryForFinancialAudit } from '../src/lib/accounting/financialReportClassificationAudit';
import {
  computeCleanNetProfit,
  createEmptyClassifiedTotals,
} from '../src/lib/accounting/financialReportClassification';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const config: sql.config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || 'HawaiRestaurant',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    trustServerCertificate: true,
  },
};

async function resolveTenantId(pool: sql.ConnectionPool): Promise<string> {
  const r = await pool.request().query(`
    SELECT TOP 1 CAST(TenantId AS nvarchar(36)) AS TenantId
    FROM dbo.TblExpINCat
    WHERE ExpINType = N'ايرادات' AND TenantId IS NOT NULL
    GROUP BY TenantId
    ORDER BY COUNT(*) DESC
  `);
  const tenantId = String(r.recordset[0]?.TenantId ?? '').trim();
  if (!tenantId) throw new Error('No TenantId on TblExpINCat');
  return tenantId;
}

async function ensureCategory(pool: sql.ConnectionPool, catName: string): Promise<number> {
  const tenantId = await resolveTenantId(pool);
  const found = await pool.request()
    .input('catName', sql.NVarChar(200), catName)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TOP 1 ExpINID, ISNULL(IsActive, 1) AS IsActive
      FROM dbo.TblExpINCat
      WHERE CatName = @catName AND ExpINType = N'ايرادات' AND TenantId = @tenantId
      ORDER BY ExpINID ASC
    `);
  if (found.recordset.length > 0) {
    const id = Number(found.recordset[0].ExpINID);
    if (!found.recordset[0].IsActive) {
      await pool.request().input('id', sql.Int, id)
        .query(`UPDATE dbo.TblExpINCat SET IsActive = 1 WHERE ExpINID = @id`);
    }
    await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.TblExpCatEmpMap SET IsActive = 0
      WHERE ExpINID = @id AND ISNULL(IsActive, 1) = 1
    `);
    return id;
  }
  const legacy = await pool.request()
    .input('catName', sql.NVarChar(200), catName)
    .query(`
      SELECT TOP 1 ExpINID FROM dbo.TblExpINCat
      WHERE CatName = @catName AND ExpINType = N'ايرادات'
      ORDER BY ExpINID ASC
    `);
  if (legacy.recordset.length > 0) return Number(legacy.recordset[0].ExpINID);

  const inserted = await pool.request()
    .input('catName', sql.NVarChar(200), catName)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (@tenantId, @catName, N'ايرادات')
    `);
  return Number(inserted.recordset[0].ExpINID);
}

async function main() {
  const pool = await sql.connect(config);
  try {
    const profitId = await ensureCategory(pool, STORE_OTHER_BUSINESS_INCOME_CATEGORY);
    const cashId = await ensureCategory(pool, STORE_NON_REVENUE_CASH_IN_CATEGORY);
    console.log('Ensured categories:', {
      [STORE_OTHER_BUSINESS_INCOME_CATEGORY]: profitId,
      [STORE_NON_REVENUE_CASH_IN_CATEGORY]: cashId,
    });

    for (const [name, id] of [
      [STORE_OTHER_BUSINESS_INCOME_CATEGORY, profitId],
      [STORE_NON_REVENUE_CASH_IN_CATEGORY, cashId],
    ] as const) {
      const classed = classifyCategoryForFinancialAudit({
        expInId: id,
        categoryName: name,
        expInType: 'ايرادات',
        txnKind: null,
        mappedEmpId: null,
      });
      console.log({
        cat: name,
        expInId: id,
        revenueClass: classed.revenueClass,
        countsAsRealRevenue: classed.countsAsRealRevenue,
      });
    }

    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const end = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    const byBranch = await pool.request()
      .input('startDate', sql.Date, start)
      .input('endDate', sql.Date, end)
      .input('profitCat', sql.NVarChar(200), STORE_OTHER_BUSINESS_INCOME_CATEGORY)
      .input('cashCat', sql.NVarChar(200), STORE_NON_REVENUE_CASH_IN_CATEGORY)
      .query(`
        SELECT
          cm.BranchID,
          ISNULL(b.BranchName, CAST(cm.BranchID AS nvarchar(20))) AS BranchName,
          SUM(CASE WHEN cat.CatName = @profitCat THEN cm.GrandTolal ELSE 0 END) AS ProfitStoreIncome,
          SUM(CASE WHEN cat.CatName = @cashCat THEN cm.GrandTolal ELSE 0 END) AS NonRevenueCashIn
        FROM dbo.TblCashMove cm
        INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
        LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
        WHERE cm.invType = N'ايرادات'
          AND cm.inOut = N'in'
          AND cm.EmpID IS NULL
          AND cm.invDate >= @startDate AND cm.invDate <= @endDate
          AND cat.CatName IN (@profitCat, @cashCat)
        GROUP BY cm.BranchID, b.BranchName
        ORDER BY cm.BranchID
      `);

    console.log(`\nMTD ${start}..${end} store income by branch:`);
    if (byBranch.recordset.length === 0) {
      console.log('(none yet — categories ready; first posting will hit treasury + classified buckets)');
      // Demonstrate expected deltas for a hypothetical 100/50 posting
      const demo = createEmptyClassifiedTotals();
      demo.otherBusinessIncome = 100;
      demo.nonRevenueCashIn = 50;
      demo.cleanNetProfit = computeCleanNetProfit(demo);
      console.log('Example deltas for +100 ربحي / +50 غير ربحي:', {
        treasuryCashInDelta: 150,
        cleanNetProfitDelta: demo.cleanNetProfit,
        employeeDuesImpact: 0,
      });
    }
    for (const row of byBranch.recordset as Array<{
      BranchID: number;
      BranchName: string;
      ProfitStoreIncome: number;
      NonRevenueCashIn: number;
    }>) {
      const profit = Number(row.ProfitStoreIncome) || 0;
      const cashOnly = Number(row.NonRevenueCashIn) || 0;
      const totals = createEmptyClassifiedTotals();
      totals.otherBusinessIncome = profit;
      totals.nonRevenueCashIn = cashOnly;
      totals.cleanNetProfit = computeCleanNetProfit(totals);
      console.log({
        branchId: row.BranchID,
        branch: row.BranchName,
        treasuryCashInDelta: profit + cashOnly,
        cleanNetProfitDelta: totals.cleanNetProfit,
        otherBusinessIncome: profit,
        nonRevenueCashIn: cashOnly,
      });
    }

    console.log('\nSmoke OK');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
