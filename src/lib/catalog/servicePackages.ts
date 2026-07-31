import type { ConnectionPool } from 'mssql';
import { sql } from '@/lib/db';
import type {
  PackageItemInput,
  PackageItemRow,
  PackageWriteBody,
  ServicePackageRow,
} from '@/lib/catalog/servicePackages.types';
import { isPackageKind } from '@/lib/migrations/ensureServicePackages';

const PACKAGE_SELECT = `
  p.PackageID,
  p.NameEn,
  p.NameAr,
  p.PackageKind,
  p.PackagePrice,
  p.OriginalPrice,
  p.DurationMinutes,
  p.Bonus,
  p.ImageUrl,
  p.DescriptionAr,
  p.DescriptionEn,
  p.SortOrder,
  p.IsPopular,
  p.isDeleted,
  p.DepositAmount,
  p.IncludesTrial,
  p.SessionCount,
  p.NotesAr,
  p.CreatedAt,
  p.UpdatedAt,
  ISNULL(ic.ItemCount, 0) AS ItemCount
`;

function mapPackageRow(row: Record<string, unknown>): ServicePackageRow {
  return {
    PackageID: Number(row.PackageID),
    NameEn: String(row.NameEn ?? ''),
    NameAr: row.NameAr != null ? String(row.NameAr) : null,
    PackageKind: isPackageKind(row.PackageKind) ? row.PackageKind : 'regular',
    PackagePrice: Number(row.PackagePrice) || 0,
    OriginalPrice: row.OriginalPrice != null ? Number(row.OriginalPrice) : null,
    DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
    Bonus: Number(row.Bonus) || 0,
    ImageUrl: row.ImageUrl != null ? String(row.ImageUrl) : null,
    DescriptionAr: row.DescriptionAr != null ? String(row.DescriptionAr) : null,
    DescriptionEn: row.DescriptionEn != null ? String(row.DescriptionEn) : null,
    SortOrder: Number(row.SortOrder) || 0,
    IsPopular: Number(row.IsPopular) === 1 || row.IsPopular === true,
    isDeleted: Number(row.isDeleted) === 1 || row.isDeleted === true,
    DepositAmount: row.DepositAmount != null ? Number(row.DepositAmount) : null,
    IncludesTrial: Number(row.IncludesTrial) === 1 || row.IncludesTrial === true,
    SessionCount: row.SessionCount != null ? Number(row.SessionCount) : null,
    NotesAr: row.NotesAr != null ? String(row.NotesAr) : null,
    CreatedAt: row.CreatedAt != null ? String(row.CreatedAt) : null,
    UpdatedAt: row.UpdatedAt != null ? String(row.UpdatedAt) : null,
    ItemCount: row.ItemCount != null ? Number(row.ItemCount) : 0,
  };
}

function mapItemRow(row: Record<string, unknown>): PackageItemRow {
  return {
    PackageItemID: Number(row.PackageItemID),
    PackageID: Number(row.PackageID),
    ProID: Number(row.ProID),
    Qty: Number(row.Qty) || 1,
    SortOrder: Number(row.SortOrder) || 0,
    IsOptional: Number(row.IsOptional) === 1 || row.IsOptional === true,
    ProName: row.ProName != null ? String(row.ProName) : null,
    ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
    SPrice1: row.SPrice1 != null ? Number(row.SPrice1) : null,
    DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
  };
}

export async function listServicePackages(
  db: ConnectionPool,
  opts: { kind?: string; activeOnly?: boolean } = {},
): Promise<ServicePackageRow[]> {
  const request = db.request();
  const conditions: string[] = [];

  if (opts.kind && isPackageKind(opts.kind)) {
    conditions.push('p.PackageKind = @kind');
    request.input('kind', sql.NVarChar(20), opts.kind);
  }
  if (opts.activeOnly) {
    conditions.push('p.isDeleted = 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await request.query(`
    SELECT ${PACKAGE_SELECT}
    FROM dbo.TblServicePackage p
    LEFT JOIN (
      SELECT PackageID, COUNT(*) AS ItemCount
      FROM dbo.TblServicePackageItem
      GROUP BY PackageID
    ) ic ON ic.PackageID = p.PackageID
    ${where}
    ORDER BY p.PackageKind, p.SortOrder, p.PackageID
  `);

  return (result.recordset as Record<string, unknown>[]).map(mapPackageRow);
}

export async function getServicePackageById(
  db: ConnectionPool,
  packageId: number,
): Promise<ServicePackageRow | null> {
  const result = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .query(`
      SELECT ${PACKAGE_SELECT}
      FROM dbo.TblServicePackage p
      LEFT JOIN (
        SELECT PackageID, COUNT(*) AS ItemCount
        FROM dbo.TblServicePackageItem
        GROUP BY PackageID
      ) ic ON ic.PackageID = p.PackageID
      WHERE p.PackageID = @PackageID
    `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const pkg = mapPackageRow(row);
  pkg.items = await getPackageItems(db, packageId);
  return pkg;
}

export async function getPackageItems(
  db: ConnectionPool,
  packageId: number,
): Promise<PackageItemRow[]> {
  const result = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .query(`
      SELECT
        i.PackageItemID,
        i.PackageID,
        i.ProID,
        i.Qty,
        i.SortOrder,
        i.IsOptional,
        pro.ProName,
        pro.ProNameAr,
        pro.SPrice1,
        pro.DurationMinutes
      FROM dbo.TblServicePackageItem i
      LEFT JOIN dbo.TblPro pro ON pro.ProID = i.ProID
      WHERE i.PackageID = @PackageID
      ORDER BY i.SortOrder, i.PackageItemID
    `);

  return (result.recordset as Record<string, unknown>[]).map(mapItemRow);
}

function normalizeItems(items: PackageItemInput[] | undefined): PackageItemInput[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<number>();
  const out: PackageItemInput[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const proId = Number(raw?.ProID);
    if (!Number.isFinite(proId) || proId <= 0 || seen.has(proId)) continue;
    seen.add(proId);
    out.push({
      ProID: proId,
      Qty: Math.max(0.01, Number(raw.Qty) || 1),
      SortOrder: Number.isFinite(Number(raw.SortOrder)) ? Number(raw.SortOrder) : (i + 1) * 10,
      IsOptional: Boolean(raw.IsOptional),
    });
  }
  return out;
}

export function validatePackageBody(body: unknown): { ok: true; data: PackageWriteBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'بيانات غير صالحة' };
  }
  const b = body as Record<string, unknown>;
  const NameEn = String(b.NameEn ?? '').trim();
  if (!NameEn) return { ok: false, error: 'اسم الباكدج (إنجليزي) مطلوب' };

  if (!isPackageKind(b.PackageKind)) {
    return { ok: false, error: 'نوع الباكدج غير صالح — اختر عادية أو عريس' };
  }

  const PackagePrice = Number(b.PackagePrice);
  if (!Number.isFinite(PackagePrice) || PackagePrice < 0) {
    return { ok: false, error: 'سعر الباكدج مطلوب ويجب أن يكون رقم موجب' };
  }

  const OriginalPrice =
    b.OriginalPrice === null || b.OriginalPrice === undefined || b.OriginalPrice === ''
      ? null
      : Number(b.OriginalPrice);
  if (OriginalPrice != null && (!Number.isFinite(OriginalPrice) || OriginalPrice < 0)) {
    return { ok: false, error: 'السعر الأصلي غير صالح' };
  }

  const DurationMinutes =
    b.DurationMinutes === null || b.DurationMinutes === undefined || b.DurationMinutes === ''
      ? null
      : Number(b.DurationMinutes);
  if (DurationMinutes != null && (!Number.isFinite(DurationMinutes) || DurationMinutes < 0)) {
    return { ok: false, error: 'المدة غير صالحة' };
  }

  const DepositAmount =
    b.DepositAmount === null || b.DepositAmount === undefined || b.DepositAmount === ''
      ? null
      : Number(b.DepositAmount);
  if (DepositAmount != null && (!Number.isFinite(DepositAmount) || DepositAmount < 0)) {
    return { ok: false, error: 'مبلغ العربون غير صالح' };
  }

  const SessionCount =
    b.SessionCount === null || b.SessionCount === undefined || b.SessionCount === ''
      ? null
      : Number(b.SessionCount);
  if (SessionCount != null && (!Number.isFinite(SessionCount) || SessionCount < 0)) {
    return { ok: false, error: 'عدد الجلسات غير صالح' };
  }

  return {
    ok: true,
    data: {
      NameEn,
      NameAr: String(b.NameAr ?? '').trim() || null,
      PackageKind: b.PackageKind,
      PackagePrice,
      OriginalPrice,
      DurationMinutes,
      Bonus: Number(b.Bonus) || 0,
      ImageUrl: String(b.ImageUrl ?? '').trim() || null,
      DescriptionAr: String(b.DescriptionAr ?? '').trim() || null,
      DescriptionEn: String(b.DescriptionEn ?? '').trim() || null,
      SortOrder: Number.isFinite(Number(b.SortOrder)) ? Number(b.SortOrder) : 0,
      IsPopular: Boolean(b.IsPopular),
      isActive: b.isActive === undefined ? true : Boolean(b.isActive),
      DepositAmount: b.PackageKind === 'groom' ? DepositAmount : null,
      IncludesTrial: b.PackageKind === 'groom' ? Boolean(b.IncludesTrial) : false,
      SessionCount: b.PackageKind === 'groom' ? SessionCount : null,
      NotesAr: b.PackageKind === 'groom' ? (String(b.NotesAr ?? '').trim() || null) : null,
      items: normalizeItems(b.items as PackageItemInput[] | undefined),
    },
  };
}

async function replacePackageItems(
  db: ConnectionPool,
  packageId: number,
  items: PackageItemInput[],
): Promise<void> {
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('PackageID', sql.Int, packageId)
      .query(`DELETE FROM dbo.TblServicePackageItem WHERE PackageID = @PackageID`);

    for (const item of items) {
      await new sql.Request(tx)
        .input('PackageID', sql.Int, packageId)
        .input('ProID', sql.Int, item.ProID)
        .input('Qty', sql.Decimal(10, 2), item.Qty ?? 1)
        .input('SortOrder', sql.Int, item.SortOrder ?? 0)
        .input('IsOptional', sql.Bit, item.IsOptional ? 1 : 0)
        .query(`
          INSERT INTO dbo.TblServicePackageItem (PackageID, ProID, Qty, SortOrder, IsOptional)
          VALUES (@PackageID, @ProID, @Qty, @SortOrder, @IsOptional)
        `);
    }
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function createServicePackage(
  db: ConnectionPool,
  data: PackageWriteBody,
): Promise<ServicePackageRow> {
  const result = await db
    .request()
    .input('NameEn', sql.NVarChar(200), data.NameEn)
    .input('NameAr', sql.NVarChar(200), data.NameAr)
    .input('PackageKind', sql.NVarChar(20), data.PackageKind)
    .input('PackagePrice', sql.Decimal(10, 2), data.PackagePrice)
    .input('OriginalPrice', sql.Decimal(10, 2), data.OriginalPrice)
    .input('DurationMinutes', sql.Int, data.DurationMinutes)
    .input('Bonus', sql.Decimal(10, 2), data.Bonus ?? 0)
    .input('ImageUrl', sql.NVarChar(1000), data.ImageUrl)
    .input('DescriptionAr', sql.NVarChar(500), data.DescriptionAr)
    .input('DescriptionEn', sql.NVarChar(500), data.DescriptionEn)
    .input('SortOrder', sql.Int, data.SortOrder ?? 0)
    .input('IsPopular', sql.Bit, data.IsPopular ? 1 : 0)
    .input('isDeleted', sql.Bit, data.isActive === false ? 1 : 0)
    .input('DepositAmount', sql.Decimal(10, 2), data.DepositAmount)
    .input('IncludesTrial', sql.Bit, data.IncludesTrial ? 1 : 0)
    .input('SessionCount', sql.Int, data.SessionCount)
    .input('NotesAr', sql.NVarChar(500), data.NotesAr)
    .query(`
      INSERT INTO dbo.TblServicePackage (
        NameEn, NameAr, PackageKind, PackagePrice, OriginalPrice, DurationMinutes,
        Bonus, ImageUrl, DescriptionAr, DescriptionEn, SortOrder, IsPopular, isDeleted,
        DepositAmount, IncludesTrial, SessionCount, NotesAr
      )
      VALUES (
        @NameEn, @NameAr, @PackageKind, @PackagePrice, @OriginalPrice, @DurationMinutes,
        @Bonus, @ImageUrl, @DescriptionAr, @DescriptionEn, @SortOrder, @IsPopular, @isDeleted,
        @DepositAmount, @IncludesTrial, @SessionCount, @NotesAr
      );

      SELECT CAST(SCOPE_IDENTITY() AS INT) AS PackageID;
    `);

  const packageId = Number(result.recordset[0].PackageID);
  if (data.items?.length) {
    await replacePackageItems(db, packageId, data.items);
  }

  const created = await getServicePackageById(db, packageId);
  if (!created) throw new Error('فشل إنشاء الباكدج');
  return created;
}

export async function updateServicePackage(
  db: ConnectionPool,
  packageId: number,
  data: PackageWriteBody,
): Promise<ServicePackageRow | null> {
  const result = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .input('NameEn', sql.NVarChar(200), data.NameEn)
    .input('NameAr', sql.NVarChar(200), data.NameAr)
    .input('PackageKind', sql.NVarChar(20), data.PackageKind)
    .input('PackagePrice', sql.Decimal(10, 2), data.PackagePrice)
    .input('OriginalPrice', sql.Decimal(10, 2), data.OriginalPrice)
    .input('DurationMinutes', sql.Int, data.DurationMinutes)
    .input('Bonus', sql.Decimal(10, 2), data.Bonus ?? 0)
    .input('ImageUrl', sql.NVarChar(1000), data.ImageUrl)
    .input('DescriptionAr', sql.NVarChar(500), data.DescriptionAr)
    .input('DescriptionEn', sql.NVarChar(500), data.DescriptionEn)
    .input('SortOrder', sql.Int, data.SortOrder ?? 0)
    .input('IsPopular', sql.Bit, data.IsPopular ? 1 : 0)
    .input('isDeleted', sql.Bit, data.isActive === false ? 1 : 0)
    .input('DepositAmount', sql.Decimal(10, 2), data.DepositAmount)
    .input('IncludesTrial', sql.Bit, data.IncludesTrial ? 1 : 0)
    .input('SessionCount', sql.Int, data.SessionCount)
    .input('NotesAr', sql.NVarChar(500), data.NotesAr)
    .query(`
      UPDATE dbo.TblServicePackage
      SET
        NameEn = @NameEn,
        NameAr = @NameAr,
        PackageKind = @PackageKind,
        PackagePrice = @PackagePrice,
        OriginalPrice = @OriginalPrice,
        DurationMinutes = @DurationMinutes,
        Bonus = @Bonus,
        ImageUrl = @ImageUrl,
        DescriptionAr = @DescriptionAr,
        DescriptionEn = @DescriptionEn,
        SortOrder = @SortOrder,
        IsPopular = @IsPopular,
        isDeleted = @isDeleted,
        DepositAmount = @DepositAmount,
        IncludesTrial = @IncludesTrial,
        SessionCount = @SessionCount,
        NotesAr = @NotesAr,
        UpdatedAt = SYSDATETIME()
      WHERE PackageID = @PackageID;

      SELECT @@ROWCOUNT AS affected;
    `);

  if (Number(result.recordset[0]?.affected) === 0) return null;

  if (data.items !== undefined) {
    await replacePackageItems(db, packageId, data.items ?? []);
  }

  return getServicePackageById(db, packageId);
}

export async function softDeleteServicePackage(
  db: ConnectionPool,
  packageId: number,
): Promise<boolean> {
  const result = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .query(`
      UPDATE dbo.TblServicePackage
      SET isDeleted = 1, UpdatedAt = SYSDATETIME()
      WHERE PackageID = @PackageID;
      SELECT @@ROWCOUNT AS affected;
    `);
  return Number(result.recordset[0]?.affected) > 0;
}

export async function restoreServicePackage(
  db: ConnectionPool,
  packageId: number,
): Promise<boolean> {
  const result = await db
    .request()
    .input('PackageID', sql.Int, packageId)
    .query(`
      UPDATE dbo.TblServicePackage
      SET isDeleted = 0, UpdatedAt = SYSDATETIME()
      WHERE PackageID = @PackageID;
      SELECT @@ROWCOUNT AS affected;
    `);
  return Number(result.recordset[0]?.affected) > 0;
}
