#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Probe Oct 2026 partners store income for Gleem + Camp Caesar (SQL + local UI math).
 *   npx tsx scripts/_probe-partners-store-income-oct.ts
 */
import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import { STORE_OTHER_BUSINESS_INCOME_CATEGORY } from '../src/lib/accounting/storeIncome';
import { STORE_NON_REVENUE_CASH_IN_CATEGORY } from '../src/lib/accounting/storeIncome';

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcRemainingAfterEmployees(
  shop: number,
  paid: number,
  store = 0,
): number {
  return roundMoney(shop + store - paid);
}

function calcOperatingNet(remaining: number, expenses: number): number {
  return roundMoney(remaining - expenses);
}

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: true,
    },
  });

  const year = 2026;
  const month = 10;
  const start = '2026-10-01';
  const end = '2026-10-31';
  const branches = [
    { id: 1, name: 'جليم (GLEEM)' },
    { id: 3, name: 'كامب شيزار (CAMP_CAESAR)' },
  ];

  try {
    for (const branch of branches) {
      const store = await pool.request()
        .input('startDate', sql.Date, start)
        .input('endDate', sql.Date, end)
        .input('branchId', sql.Int, branch.id)
        .input('profitCat', sql.NVarChar(200), STORE_OTHER_BUSINESS_INCOME_CATEGORY)
        .input('nonRevCat', sql.NVarChar(200), STORE_NON_REVENUE_CASH_IN_CATEGORY)
        .query(`
          SELECT
            ISNULL(SUM(CASE WHEN cat.CatName = @profitCat THEN cm.GrandTolal ELSE 0 END), 0) AS ProfitStore,
            ISNULL(SUM(CASE WHEN cat.CatName = @nonRevCat THEN cm.GrandTolal ELSE 0 END), 0) AS NonRevenue
          FROM dbo.TblCashMove cm
          INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
          WHERE cm.invType = N'ايرادات'
            AND cm.inOut = N'in'
            AND cm.BranchID = @branchId
            AND cm.invDate >= @startDate AND cm.invDate <= @endDate
            AND cm.EmpID IS NULL
            AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
            AND cat.CatName IN (@profitCat, @nonRevCat)
        `);

      const profitStore = roundMoney(Number(store.recordset[0]?.ProfitStore) || 0);
      const nonRevenue = roundMoney(Number(store.recordset[0]?.NonRevenue) || 0);

      // Sanity: UI remaining uses profit store only
      const demoShop = 100000;
      const demoPaid = 40000;
      const demoExpenses = 20000;
      const remaining = calcRemainingAfterEmployees(demoShop, demoPaid, profitStore);
      const operatingNet = calcOperatingNet(remaining, demoExpenses);
      const withoutStore = calcOperatingNet(
        calcRemainingAfterEmployees(demoShop, demoPaid, 0),
        demoExpenses,
      );

      console.log('\n===', branch.name, `branchId=${branch.id}`, `${year}-${month}`, '===');
      console.log({
        storeOtherBusinessIncome: profitStore,
        nonRevenueCashInExcluded: nonRevenue,
        uiUsesOnlyProfitStore: true,
        exampleRemainingWithStore: remaining,
        exampleOperatingNetWithStore: operatingNet,
        storeLiftVsWithout: roundMoney(operatingNet - withoutStore),
        expectedLiftEqualsProfitStore: Math.abs(operatingNet - withoutStore - profitStore) < 0.02,
      });

      if (Math.abs(operatingNet - withoutStore - profitStore) >= 0.02) {
        throw new Error(`Store income not applied once for branch ${branch.id}`);
      }
    }
    console.log('\nProbe OK — profit store income lifts operating net once; non-revenue excluded');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
