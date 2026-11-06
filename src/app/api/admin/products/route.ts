import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  createRetailProduct,
  listRetailProducts,
} from '@/lib/inventory/productCatalog.service';
import { InventoryDomainError } from '@/lib/inventory/inventoryMutation.service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const products = await listRetailProducts({
      tenantId: auth.tenantId,
      q: searchParams.get('q'),
      catId: searchParams.get('catId') ? Number(searchParams.get('catId')) : null,
      brand: searchParams.get('brand'),
      activeOnly: searchParams.get('active') === 'true',
    });
    return NextResponse.json({ products });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const product = await createRetailProduct(auth.tenantId, {
      productCode: String(body.productCode || body.ProductCode || ''),
      barcode: body.barcode ?? body.Barcode ?? null,
      nameAr: String(body.nameAr || body.ProNameAr || body.name || ''),
      nameEn: body.nameEn ?? body.ProName ?? null,
      catId: body.catId ?? body.CatID ?? null,
      brand: body.brand ?? null,
      description: body.description ?? null,
      imageUrl: body.imageUrl ?? body.ImageUrl ?? null,
      stockUnit: body.stockUnit ?? null,
      unitsPerPack: body.unitsPerPack ?? null,
      supplierRef: body.supplierRef ?? null,
      purchaseCost: body.purchaseCost ?? body.PPrice ?? 0,
      sellingPrice: Number(body.sellingPrice ?? body.SPrice1 ?? 0),
      suggestedRetailPrice: body.suggestedRetailPrice ?? null,
      minStockThreshold: body.minStockThreshold ?? null,
      isActive: body.isActive !== false,
    });
    return NextResponse.json({ product }, { status: 201 });
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
