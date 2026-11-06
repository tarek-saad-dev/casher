import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch';
import { getInventoryStockPolicy } from '@/lib/inventory/stockPolicy.service';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    const policy = await getInventoryStockPolicy(auth.tenantId);

    const kpis = await db
      .request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        DECLARE @monthStart DATE = DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1);

        ;WITH tracked AS (
          SELECT p.ProID, ISNULL(p.PPrice, 0) AS PPrice, ISNULL(p.MinStockThreshold, 0) AS MinStock
          FROM dbo.TblPro p
          LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID AND c.TenantId = p.TenantId
          WHERE p.TenantId = @tenantId
            AND (p.isDeleted = 0 OR p.isDeleted IS NULL)
            AND (
              LOWER(ISNULL(c.CatType, N'')) = N'pro'
              OR LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
            )
        )
        SELECT
          (SELECT COUNT(*) FROM tracked) AS activeProducts,
          (
            SELECT CAST(ISNULL(SUM(ISNULL(bi.QtyOnHand, 0)), 0) AS DECIMAL(18,2))
            FROM tracked t
            LEFT JOIN dbo.TblBranchInventory bi
              ON bi.ProID = t.ProID AND bi.BranchID = @branchId
          ) AS unitsAvailableBranch,
          (
            SELECT CAST(ISNULL(SUM(ISNULL(bi.QtyOnHand, 0) * t.PPrice), 0) AS DECIMAL(18,2))
            FROM tracked t
            LEFT JOIN dbo.TblBranchInventory bi
              ON bi.ProID = t.ProID AND bi.BranchID = @branchId
          ) AS inventoryValueAtCostBranch,
          (
            SELECT COUNT(*)
            FROM tracked t
            LEFT JOIN dbo.TblBranchInventory bi
              ON bi.ProID = t.ProID AND bi.BranchID = @branchId
            WHERE ISNULL(bi.QtyOnHand, 0) <= 0
          ) AS outOfStock,
          (
            SELECT COUNT(*)
            FROM tracked t
            LEFT JOIN dbo.TblBranchInventory bi
              ON bi.ProID = t.ProID AND bi.BranchID = @branchId
            WHERE ISNULL(bi.QtyOnHand, 0) > 0
              AND ISNULL(bi.QtyOnHand, 0) <= COALESCE(bi.ReorderLevel, NULLIF(t.MinStock, 0), 0)
              AND COALESCE(bi.ReorderLevel, NULLIF(t.MinStock, 0), 0) > 0
          ) AS lowStock,
          (
            SELECT CAST(ISNULL(SUM(d.SValue), 0) AS DECIMAL(18,2))
            FROM dbo.TblinvServDetail d
            INNER JOIN dbo.TblinvServHead h ON h.invID = d.invID AND h.invType = d.invType
            INNER JOIN tracked t ON t.ProID = d.ProID
            WHERE h.BranchID = @branchId
              AND h.invDate >= @monthStart
              AND h.invType = N'مبيعات'
          ) AS productSalesThisMonth,
          (
            SELECT CAST(ISNULL(SUM(
              d.SValue - (ISNULL(d.UnitCostSnapshot, t.PPrice) * ISNULL(d.Qty, 1))
            ), 0) AS DECIMAL(18,2))
            FROM dbo.TblinvServDetail d
            INNER JOIN dbo.TblinvServHead h ON h.invID = d.invID AND h.invType = d.invType
            INNER JOIN tracked t ON t.ProID = d.ProID
            WHERE h.BranchID = @branchId
              AND h.invDate >= @monthStart
              AND h.invType = N'مبيعات'
          ) AS productGrossProfitThisMonth
      `);

    const companyWide = await db
      .request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .query(`
        SELECT
          CAST(ISNULL(SUM(ISNULL(bi.QtyOnHand, 0)), 0) AS DECIMAL(18,2)) AS unitsAvailableCompany,
          CAST(ISNULL(SUM(ISNULL(bi.QtyOnHand, 0) * ISNULL(p.PPrice, 0)), 0) AS DECIMAL(18,2)) AS inventoryValueAtCostCompany
        FROM dbo.TblPro p
        LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID AND c.TenantId = p.TenantId
        LEFT JOIN dbo.TblBranchInventory bi ON bi.ProID = p.ProID
        INNER JOIN dbo.Location loc
          ON loc.LegacyBranchId = bi.BranchID
         AND loc.TenantId = @tenantId
         AND loc.Status = N'active'
        WHERE p.TenantId = @tenantId
          AND (p.isDeleted = 0 OR p.isDeleted IS NULL)
          AND (
            LOWER(ISNULL(c.CatType, N'')) = N'pro'
            OR LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
          )
      `);

    const row = kpis.recordset[0] || {};
    const company = companyWide.recordset[0] || {};

    return NextResponse.json({
      branchId: branch.branchId,
      branchName: branch.branchName,
      branchCode: branch.branchCode,
      policy,
      kpis: {
        activeProducts: Number(row.activeProducts || 0),
        unitsAvailable: Number(row.unitsAvailableBranch || 0),
        unitsAvailableCompany: Number(company.unitsAvailableCompany || 0),
        inventoryValueAtCost: Number(row.inventoryValueAtCostBranch || 0),
        inventoryValueAtCostCompany: Number(company.inventoryValueAtCostCompany || 0),
        lowStock: Number(row.lowStock || 0),
        outOfStock: Number(row.outOfStock || 0),
        productSalesThisMonth: Number(row.productSalesThisMonth || 0),
        productGrossProfitThisMonth: Number(row.productGrossProfitThisMonth || 0),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
