import 'server-only';
import { getPool, sql } from '@/lib/db';
import { InventoryDomainError } from './inventoryMutation.service';
import { isStockTrackedProduct } from './productTracking';

export type RetailProductInput = {
  productCode: string;
  barcode?: string | null;
  nameAr: string;
  nameEn?: string | null;
  catId?: number | null;
  brand?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  stockUnit?: string | null;
  unitsPerPack?: number | null;
  supplierRef?: string | null;
  purchaseCost?: number | null;
  sellingPrice: number;
  suggestedRetailPrice?: number | null;
  minStockThreshold?: number | null;
  isActive?: boolean;
};

export type RetailProduct = {
  productId: number;
  productCode: string | null;
  barcode: string | null;
  nameAr: string;
  nameEn: string | null;
  catId: number | null;
  catName: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  stockUnit: string | null;
  unitsPerPack: number | null;
  supplierRef: string | null;
  purchaseCost: number;
  sellingPrice: number;
  suggestedRetailPrice: number | null;
  minStockThreshold: number | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  trackStock: boolean;
};

function normalizeCode(code: string): string {
  return String(code || '').trim();
}

function assertValidProductCode(code: string): string {
  const c = normalizeCode(code);
  if (!c) {
    throw new InventoryDomainError('PRODUCT_CODE_REQUIRED', 'كود المنتج مطلوب', 400);
  }
  if (c.length > 40) {
    throw new InventoryDomainError('PRODUCT_CODE_TOO_LONG', 'كود المنتج طويل جداً', 400);
  }
  // Preserve alphanumeric + punctuation (LH.5097, ML147#, LK0068). Never coerce to number.
  if (!/^[\w.#\-/+]+$/u.test(c) && !/^[\p{L}\p{N}.#\-/+]+$/u.test(c)) {
    throw new InventoryDomainError('PRODUCT_CODE_INVALID', 'كود المنتج يحتوي رموزاً غير مسموحة', 400);
  }
  return c;
}

function mapRow(r: Record<string, unknown>): RetailProduct {
  const proType = r.proType == null ? null : String(r.proType);
  const catType = r.catType == null ? null : String(r.catType);
  return {
    productId: Number(r.productId),
    productCode: r.productCode == null ? null : String(r.productCode),
    barcode: r.barcode == null ? null : String(r.barcode),
    nameAr: String(r.nameAr ?? r.nameEn ?? ''),
    nameEn: r.nameEn == null ? null : String(r.nameEn),
    catId: r.catId == null ? null : Number(r.catId),
    catName: r.catName == null ? null : String(r.catName),
    brand: r.brand == null ? null : String(r.brand),
    description: r.description == null ? null : String(r.description),
    imageUrl: r.imageUrl == null ? null : String(r.imageUrl),
    stockUnit: r.stockUnit == null ? null : String(r.stockUnit),
    unitsPerPack: r.unitsPerPack == null ? null : Number(r.unitsPerPack),
    supplierRef: r.supplierRef == null ? null : String(r.supplierRef),
    purchaseCost: Number(r.purchaseCost ?? 0),
    sellingPrice: Number(r.sellingPrice ?? 0),
    suggestedRetailPrice:
      r.suggestedRetailPrice == null ? null : Number(r.suggestedRetailPrice),
    minStockThreshold: r.minStockThreshold == null ? null : Number(r.minStockThreshold),
    isActive: !(Number(r.isDeleted) === 1),
    createdAt: r.createdAt ? new Date(r.createdAt as string | Date).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt as string | Date).toISOString() : null,
    trackStock: isStockTrackedProduct({
      proId: Number(r.productId),
      proType,
      catType,
    }),
  };
}

const PRODUCT_SELECT = `
  SELECT
    p.ProID AS productId,
    p.ProductCode AS productCode,
    p.Barcode AS barcode,
    ISNULL(NULLIF(LTRIM(RTRIM(p.ProNameAr)), N''), p.ProName) AS nameAr,
    CASE
      WHEN NULLIF(LTRIM(RTRIM(p.ProNameAr)), N'') IS NOT NULL
           AND NULLIF(LTRIM(RTRIM(p.ProName)), N'') IS NOT NULL
           AND LTRIM(RTRIM(p.ProNameAr)) <> LTRIM(RTRIM(p.ProName))
        THEN p.ProName
      ELSE NULL
    END AS nameEn,
    p.CatID AS catId,
    c.CatName AS catName,
    c.CatType AS catType,
    p.ProType AS proType,
    p.Brand AS brand,
    p.Description AS description,
    p.ImageUrl AS imageUrl,
    p.StockUnit AS stockUnit,
    p.UnitsPerPack AS unitsPerPack,
    p.SupplierRef AS supplierRef,
    ISNULL(p.PPrice, 0) AS purchaseCost,
    ISNULL(p.SPrice1, 0) AS sellingPrice,
    p.SuggestedRetailPrice AS suggestedRetailPrice,
    p.MinStockThreshold AS minStockThreshold,
    p.isDeleted AS isDeleted,
    p.CreatedAt AS createdAt,
    p.UpdatedAt AS updatedAt
  FROM dbo.TblPro p
  LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID AND c.TenantId = p.TenantId
`;

export async function listRetailProducts(args: {
  tenantId: string;
  q?: string | null;
  catId?: number | null;
  brand?: string | null;
  activeOnly?: boolean;
  stockTrackedOnly?: boolean;
}): Promise<RetailProduct[]> {
  const db = await getPool();
  const req = db
    .request()
    .input('tenantId', sql.UniqueIdentifier, args.tenantId)
    .input('q', sql.NVarChar(100), args.q?.trim() || null)
    .input('catId', sql.Int, args.catId ?? null)
    .input('brand', sql.NVarChar(100), args.brand?.trim() || null);

  const result = await req.query(`
    ${PRODUCT_SELECT}
    WHERE p.TenantId = @tenantId
      AND (
        LOWER(ISNULL(c.CatType, N'')) = N'pro'
        OR LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
      )
      AND (@q IS NULL OR
           p.ProductCode LIKE N'%' + @q + N'%' OR
           p.Barcode LIKE N'%' + @q + N'%' OR
           p.ProName LIKE N'%' + @q + N'%' OR
           p.ProNameAr LIKE N'%' + @q + N'%' OR
           p.Brand LIKE N'%' + @q + N'%')
      AND (@catId IS NULL OR p.CatID = @catId)
      AND (@brand IS NULL OR p.Brand = @brand)
      ${args.activeOnly ? 'AND (p.isDeleted = 0 OR p.isDeleted IS NULL)' : ''}
    ORDER BY ISNULL(p.ProNameAr, p.ProName)
  `);

  return result.recordset.map((r: Record<string, unknown>) => mapRow(r));
}

export async function getRetailProduct(
  tenantId: string,
  productId: number,
): Promise<RetailProduct | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('productId', sql.Int, productId)
    .query(`
      ${PRODUCT_SELECT}
      WHERE p.TenantId = @tenantId AND p.ProID = @productId
    `);
  if (!result.recordset[0]) return null;
  return mapRow(result.recordset[0]);
}

async function assertUniqueProductCode(
  tenantId: string,
  productCode: string,
  excludeProId?: number,
): Promise<void> {
  const db = await getPool();
  const result = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('code', sql.NVarChar(40), productCode)
    .input('exclude', sql.Int, excludeProId ?? null)
    .query(`
      SELECT TOP 1 ProID
      FROM dbo.TblPro
      WHERE TenantId = @tenantId
        AND ProductCode = @code
        AND (@exclude IS NULL OR ProID <> @exclude)
    `);
  if (result.recordset[0]) {
    throw new InventoryDomainError(
      'DUPLICATE_PRODUCT_CODE',
      `كود المنتج ${productCode} مستخدم مسبقاً`,
      409,
    );
  }
}

export async function createRetailProduct(
  tenantId: string,
  input: RetailProductInput,
): Promise<RetailProduct> {
  const code = assertValidProductCode(input.productCode);
  const nameAr = String(input.nameAr || '').trim();
  if (!nameAr) {
    throw new InventoryDomainError('NAME_REQUIRED', 'اسم المنتج بالعربية مطلوب', 400);
  }
  const selling = Number(input.sellingPrice);
  if (!Number.isFinite(selling) || selling < 0) {
    throw new InventoryDomainError('PRICE_INVALID', 'سعر البيع غير صالح', 400);
  }

  await assertUniqueProductCode(tenantId, code);

  const db = await getPool();
  const nameEn = (input.nameEn || '').trim() || null;
  // ProName is required historically — store Arabic as primary display, English optional.
  const proName = nameEn || nameAr;

  const result = await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('productCode', sql.NVarChar(40), code)
    .input('barcode', sql.NVarChar(50), (input.barcode || '').trim() || null)
    .input('proName', sql.NVarChar(200), proName)
    .input('proNameAr', sql.NVarChar(200), nameAr)
    .input('catId', sql.Int, input.catId ?? null)
    .input('brand', sql.NVarChar(100), (input.brand || '').trim() || null)
    .input('description', sql.NVarChar(500), (input.description || '').trim() || null)
    .input('imageUrl', sql.NVarChar(1000), (input.imageUrl || '').trim() || null)
    .input('stockUnit', sql.NVarChar(30), (input.stockUnit || '').trim() || null)
    .input('unitsPerPack', sql.Decimal(10, 2), input.unitsPerPack ?? null)
    .input('supplierRef', sql.NVarChar(200), (input.supplierRef || '').trim() || null)
    .input('pPrice', sql.Decimal(10, 2), input.purchaseCost ?? 0)
    .input('sPrice1', sql.Decimal(10, 2), selling)
    .input('suggested', sql.Decimal(10, 2), input.suggestedRetailPrice ?? null)
    .input('minStock', sql.Decimal(10, 2), input.minStockThreshold ?? null)
    .input('isDeleted', sql.Bit, input.isActive === false ? 1 : 0)
    .query(`
      INSERT INTO dbo.TblPro (
        TenantId, ProductCode, Barcode, ProName, ProNameAr, CatID, ProType,
        Brand, Description, ImageUrl, StockUnit, UnitsPerPack, SupplierRef,
        PPrice, SPrice1, SuggestedRetailPrice, MinStockThreshold,
        Bonus, Qty, isDeleted, CreatedAt, UpdatedAt
      )
      OUTPUT INSERTED.ProID
      VALUES (
        @tenantId, @productCode, @barcode, @proName, @proNameAr, @catId, N'pro',
        @brand, @description, @imageUrl, @stockUnit, @unitsPerPack, @supplierRef,
        @pPrice, @sPrice1, @suggested, @minStock,
        0, NULL, @isDeleted, SYSUTCDATETIME(), SYSUTCDATETIME()
      )
    `);

  const productId = Number(result.recordset[0].ProID);
  // Catalog starts at zero stock in every branch — no TblBranchInventory seed, no TblPro.Qty write.
  const created = await getRetailProduct(tenantId, productId);
  if (!created) {
    throw new InventoryDomainError('CREATE_FAILED', 'فشل إنشاء المنتج', 500);
  }
  return created;
}

export async function updateRetailProduct(
  tenantId: string,
  productId: number,
  input: Partial<RetailProductInput> & { isActive?: boolean },
): Promise<RetailProduct> {
  const existing = await getRetailProduct(tenantId, productId);
  if (!existing) {
    throw new InventoryDomainError('PRODUCT_NOT_FOUND', 'المنتج غير موجود', 404);
  }

  let code = existing.productCode;
  if (input.productCode != null) {
    code = assertValidProductCode(input.productCode);
    await assertUniqueProductCode(tenantId, code, productId);
  }

  const nameAr = input.nameAr != null ? String(input.nameAr).trim() : existing.nameAr;
  if (!nameAr) {
    throw new InventoryDomainError('NAME_REQUIRED', 'اسم المنتج بالعربية مطلوب', 400);
  }
  const nameEn =
    input.nameEn !== undefined
      ? (input.nameEn || '').trim() || null
      : existing.nameEn;
  const proName = nameEn || nameAr;
  const selling =
    input.sellingPrice != null ? Number(input.sellingPrice) : existing.sellingPrice;
  if (!Number.isFinite(selling) || selling < 0) {
    throw new InventoryDomainError('PRICE_INVALID', 'سعر البيع غير صالح', 400);
  }

  const isDeleted =
    input.isActive === undefined ? (existing.isActive ? 0 : 1) : input.isActive ? 0 : 1;

  const db = await getPool();
  await db
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('productId', sql.Int, productId)
    .input('productCode', sql.NVarChar(40), code)
    .input(
      'barcode',
      sql.NVarChar(50),
      input.barcode !== undefined
        ? (input.barcode || '').trim() || null
        : existing.barcode,
    )
    .input('proName', sql.NVarChar(200), proName)
    .input('proNameAr', sql.NVarChar(200), nameAr)
    .input(
      'catId',
      sql.Int,
      input.catId !== undefined ? input.catId : existing.catId,
    )
    .input(
      'brand',
      sql.NVarChar(100),
      input.brand !== undefined
        ? (input.brand || '').trim() || null
        : existing.brand,
    )
    .input(
      'description',
      sql.NVarChar(500),
      input.description !== undefined
        ? (input.description || '').trim() || null
        : existing.description,
    )
    .input(
      'imageUrl',
      sql.NVarChar(1000),
      input.imageUrl !== undefined
        ? (input.imageUrl || '').trim() || null
        : existing.imageUrl,
    )
    .input(
      'stockUnit',
      sql.NVarChar(30),
      input.stockUnit !== undefined
        ? (input.stockUnit || '').trim() || null
        : existing.stockUnit,
    )
    .input(
      'unitsPerPack',
      sql.Decimal(10, 2),
      input.unitsPerPack !== undefined ? input.unitsPerPack : existing.unitsPerPack,
    )
    .input(
      'supplierRef',
      sql.NVarChar(200),
      input.supplierRef !== undefined
        ? (input.supplierRef || '').trim() || null
        : existing.supplierRef,
    )
    .input(
      'pPrice',
      sql.Decimal(10, 2),
      input.purchaseCost !== undefined ? input.purchaseCost ?? 0 : existing.purchaseCost,
    )
    .input('sPrice1', sql.Decimal(10, 2), selling)
    .input(
      'suggested',
      sql.Decimal(10, 2),
      input.suggestedRetailPrice !== undefined
        ? input.suggestedRetailPrice
        : existing.suggestedRetailPrice,
    )
    .input(
      'minStock',
      sql.Decimal(10, 2),
      input.minStockThreshold !== undefined
        ? input.minStockThreshold
        : existing.minStockThreshold,
    )
    .input('isDeleted', sql.Bit, isDeleted)
    .query(`
      UPDATE dbo.TblPro
      SET ProductCode = @productCode,
          Barcode = @barcode,
          ProName = @proName,
          ProNameAr = @proNameAr,
          CatID = @catId,
          ProType = N'pro',
          Brand = @brand,
          Description = @description,
          ImageUrl = @imageUrl,
          StockUnit = @stockUnit,
          UnitsPerPack = @unitsPerPack,
          SupplierRef = @supplierRef,
          PPrice = @pPrice,
          SPrice1 = @sPrice1,
          SuggestedRetailPrice = @suggested,
          MinStockThreshold = @minStock,
          isDeleted = @isDeleted,
          UpdatedAt = SYSUTCDATETIME()
      WHERE ProID = @productId AND TenantId = @tenantId
    `);

  const updated = await getRetailProduct(tenantId, productId);
  if (!updated) {
    throw new InventoryDomainError('PRODUCT_NOT_FOUND', 'المنتج غير موجود', 404);
  }
  return updated;
}

/** Supplier catalog reference for Phase 10 import validation (no opening qty). */
export const SUPPLIER_CATALOG_REFERENCE = [
  { code: 'LH.5097', consumerPrice: 500, netSupplierCost: 250, unit: 'card' },
  { code: 'LH.5094', consumerPrice: 500, netSupplierCost: 250, unit: 'card' },
  { code: 'LN.1085', consumerPrice: 425, netSupplierCost: 215, unit: 'card' },
  { code: 'LN.1084', consumerPrice: 350, netSupplierCost: 175, unit: 'card' },
  { code: 'ML147#', consumerPrice: 160, netSupplierCost: 81, unit: 'piece' },
  { code: 'ML148#', consumerPrice: 160, netSupplierCost: 81, unit: 'piece' },
  { code: 'LBST75', consumerPrice: 99, netSupplierCost: 74.25, unit: 'piece' },
  { code: 'L156M', consumerPrice: 46, netSupplierCost: 34.5, unit: 'piece' },
  { code: 'SR666P', consumerPrice: 85, netSupplierCost: 63.75, unit: 'piece' },
  { code: 'L199T', consumerPrice: 160, netSupplierCost: 81, unit: 'piece' },
  { code: 'LCIAS01', consumerPrice: 200, netSupplierCost: 100, unit: 'piece' },
  { code: 'LSG01', consumerPrice: 120, netSupplierCost: 62, unit: 'piece' },
  { code: 'LSH01', consumerPrice: 180, netSupplierCost: 93, unit: 'piece' },
  { code: 'LHC01', consumerPrice: 150, netSupplierCost: 75, unit: 'piece' },
  { code: 'LK0068', consumerPrice: 230, netSupplierCost: 118, unit: 'piece' },
  { code: 'LK0051', consumerPrice: 215, netSupplierCost: 109, unit: 'piece' },
  { code: 'LK0112', consumerPrice: 265, netSupplierCost: 134, unit: 'piece' },
  { code: 'LK0044', consumerPrice: 295, netSupplierCost: 147, unit: 'piece' },
  { code: 'LK0228', consumerPrice: 235, netSupplierCost: 121, unit: 'piece' },
] as const;

export type ImportPreviewRow = {
  code: string;
  nameAr: string;
  consumerPrice: number;
  netSupplierCost: number;
  unit: string;
  status: 'new' | 'existing' | 'invalid' | 'duplicate';
  existingProductId?: number;
  message?: string;
  proposedChanges?: Partial<RetailProductInput>;
};

export async function previewSupplierCatalogImport(args: {
  tenantId: string;
  rows: Array<{
    code: string;
    nameAr?: string;
    consumerPrice?: number;
    netSupplierCost?: number;
    unit?: string;
  }>;
}): Promise<ImportPreviewRow[]> {
  const seen = new Set<string>();
  const existing = await listRetailProducts({
    tenantId: args.tenantId,
    stockTrackedOnly: true,
  });
  const byCode = new Map(
    existing
      .filter((p) => p.productCode)
      .map((p) => [p.productCode!.toLowerCase(), p]),
  );
  const refByCode = new Map(
    SUPPLIER_CATALOG_REFERENCE.map((r) => [r.code.toLowerCase(), r]),
  );

  const out: ImportPreviewRow[] = [];
  for (const row of args.rows) {
    const code = normalizeCode(row.code);
    const key = code.toLowerCase();
    if (!code) {
      out.push({
        code: '',
        nameAr: row.nameAr || '',
        consumerPrice: Number(row.consumerPrice) || 0,
        netSupplierCost: Number(row.netSupplierCost) || 0,
        unit: row.unit || '',
        status: 'invalid',
        message: 'كود فارغ',
      });
      continue;
    }
    if (seen.has(key)) {
      out.push({
        code,
        nameAr: row.nameAr || '',
        consumerPrice: Number(row.consumerPrice) || 0,
        netSupplierCost: Number(row.netSupplierCost) || 0,
        unit: row.unit || '',
        status: 'duplicate',
        message: 'مكرر داخل ملف الاستيراد',
      });
      continue;
    }
    seen.add(key);

    const ref = refByCode.get(key);
    if (ref) {
      const priceOk = Number(row.consumerPrice) === ref.consumerPrice;
      const costOk = Number(row.netSupplierCost) === ref.netSupplierCost;
      if (
        row.consumerPrice != null &&
        row.netSupplierCost != null &&
        (!priceOk || !costOk)
      ) {
        out.push({
          code,
          nameAr: row.nameAr || code,
          consumerPrice: Number(row.consumerPrice),
          netSupplierCost: Number(row.netSupplierCost),
          unit: row.unit || ref.unit,
          status: 'invalid',
          message: `لا يطابق المرجع: سعر المستهلك ${ref.consumerPrice} / تكلفة ${ref.netSupplierCost}`,
        });
        continue;
      }
    }

    const match = byCode.get(key);
    const consumerPrice =
      row.consumerPrice != null
        ? Number(row.consumerPrice)
        : ref?.consumerPrice ?? 0;
    const netSupplierCost =
      row.netSupplierCost != null
        ? Number(row.netSupplierCost)
        : ref?.netSupplierCost ?? 0;
    const unit = row.unit || ref?.unit || 'piece';
    const nameAr = (row.nameAr || '').trim() || code;

    if (match) {
      out.push({
        code,
        nameAr,
        consumerPrice,
        netSupplierCost,
        unit,
        status: 'existing',
        existingProductId: match.productId,
        message: 'منتج موجود — يتطلب تأكيداً صريحاً للتحديث',
        proposedChanges: {
          productCode: code,
          nameAr,
          purchaseCost: netSupplierCost,
          sellingPrice: match.sellingPrice,
          suggestedRetailPrice: consumerPrice,
          stockUnit: unit,
        },
      });
    } else {
      out.push({
        code,
        nameAr,
        consumerPrice,
        netSupplierCost,
        unit,
        status: 'new',
        proposedChanges: {
          productCode: code,
          nameAr,
          purchaseCost: netSupplierCost,
          sellingPrice: consumerPrice,
          suggestedRetailPrice: consumerPrice,
          stockUnit: unit,
        },
      });
    }
  }
  return out;
}

export async function commitSupplierCatalogImport(args: {
  tenantId: string;
  rows: ImportPreviewRow[];
  updateExisting: boolean;
}): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of args.rows) {
    if (row.status === 'invalid' || row.status === 'duplicate') {
      skipped += 1;
      continue;
    }
    if (row.status === 'existing') {
      if (!args.updateExisting || !row.existingProductId || !row.proposedChanges) {
        skipped += 1;
        continue;
      }
      await updateRetailProduct(args.tenantId, row.existingProductId, row.proposedChanges);
      updated += 1;
      continue;
    }
    if (row.status === 'new' && row.proposedChanges) {
      await createRetailProduct(args.tenantId, {
        productCode: row.proposedChanges.productCode!,
        nameAr: row.proposedChanges.nameAr!,
        sellingPrice: Number(row.proposedChanges.sellingPrice),
        purchaseCost: row.proposedChanges.purchaseCost,
        suggestedRetailPrice: row.proposedChanges.suggestedRetailPrice,
        stockUnit: row.proposedChanges.stockUnit,
      });
      created += 1;
    }
  }
  return { created, updated, skipped };
}
