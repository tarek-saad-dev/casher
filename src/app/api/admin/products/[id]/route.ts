import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  getRetailProduct,
  updateRetailProduct,
} from '@/lib/inventory/productCatalog.service';
import { InventoryDomainError } from '@/lib/inventory/inventoryMutation.service';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const productId = Number((await params).id);
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }
    const product = await getRetailProduct(auth.tenantId, productId);
    if (!product) {
      return NextResponse.json({ error: 'المنتج غير موجود' }, { status: 404 });
    }

    const db = await getPool();
    const stock = await db
      .request()
      .input('proId', sql.Int, productId)
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .query(`
        SELECT
          b.BranchID AS branchId,
          b.BranchName AS branchName,
          b.BranchCode AS branchCode,
          CAST(ISNULL(bi.QtyOnHand, 0) AS DECIMAL(10,2)) AS qtyOnHand,
          bi.ReorderLevel AS reorderLevel,
          bi.LastMovementAt AS lastMovementAt
        FROM dbo.TblBranch b
        INNER JOIN dbo.Location loc
          ON loc.LegacyBranchId = b.BranchID
         AND loc.TenantId = @tenantId
         AND loc.Status = N'active'
        LEFT JOIN dbo.TblBranchInventory bi
          ON bi.BranchID = b.BranchID AND bi.ProID = @proId
        WHERE ISNULL(b.IsActive, 1) = 1
        ORDER BY b.BranchName
      `);

    const movements = await db
      .request()
      .input('proId', sql.Int, productId)
      .query(`
        SELECT TOP 100
          MovementID AS movementId,
          BranchID AS branchId,
          QuantityDelta AS quantityDelta,
          QuantityBefore AS quantityBefore,
          QuantityAfter AS quantityAfter,
          MovementType AS movementType,
          ReferenceType AS referenceType,
          ReferenceID AS referenceId,
          Reason AS reason,
          UserID AS userId,
          CreatedAt AS createdAt
        FROM dbo.TblInventoryMovement
        WHERE ProID = @proId
        ORDER BY MovementID DESC
      `);

    return NextResponse.json({
      product,
      stockByBranch: stock.recordset,
      movements: movements.recordset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const productId = Number((await params).id);
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }
    const body = await req.json();
    const product = await updateRetailProduct(auth.tenantId, productId, {
      productCode: body.productCode,
      barcode: body.barcode,
      nameAr: body.nameAr ?? body.ProNameAr,
      nameEn: body.nameEn ?? body.ProName,
      catId: body.catId ?? body.CatID,
      brand: body.brand,
      description: body.description,
      imageUrl: body.imageUrl ?? body.ImageUrl,
      stockUnit: body.stockUnit,
      unitsPerPack: body.unitsPerPack,
      supplierRef: body.supplierRef,
      purchaseCost: body.purchaseCost ?? body.PPrice,
      sellingPrice: body.sellingPrice ?? body.SPrice1,
      suggestedRetailPrice: body.suggestedRetailPrice,
      minStockThreshold: body.minStockThreshold,
      isActive: body.isActive,
    });
    return NextResponse.json({ product });
  } catch (err: unknown) {
    if (err instanceof InventoryDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return PUT(req, ctx);
}
