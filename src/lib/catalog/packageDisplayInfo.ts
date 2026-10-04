/**
 * Read-only package presentation data (names, prices, included services) for
 * /operations cards and receipts. Never used for pricing or accounting.
 */
import 'server-only';
import { getPool } from '@/lib/db';
import type { PackageReceiptDisplay } from '@/lib/pos/groomPackageCart';

export type PackageDisplayInfo = PackageReceiptDisplay & {
  packageId: number;
  packageKind: string;
  nameEn: string;
  packagePrice: number;
  durationMinutes: number | null;
};

export async function loadPackageDisplayInfo(
  packageIds: number[],
): Promise<Map<number, PackageDisplayInfo>> {
  const ids = [...new Set(packageIds.filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map<number, PackageDisplayInfo>();
  if (!ids.length) return out;

  const db = await getPool();
  const idList = ids.join(',');
  const [pkgRes, itemRes] = await Promise.all([
    db.request().query(`
      SELECT PackageID, PackageKind, NameEn, NameAr, PackagePrice, OriginalPrice, DurationMinutes
      FROM dbo.TblServicePackage
      WHERE PackageID IN (${idList})
    `),
    db.request().query(`
      SELECT i.PackageID, i.ProID, i.SortOrder, i.IsOptional, p.ProName, p.SPrice1
      FROM dbo.TblServicePackageItem i
      JOIN dbo.TblPro p ON p.ProID = i.ProID
      WHERE i.PackageID IN (${idList})
      ORDER BY i.PackageID, i.SortOrder, i.PackageItemID
    `),
  ]);

  for (const row of pkgRes.recordset) {
    const packageId = Number(row.PackageID);
    const nameEn = String(row.NameEn ?? '').trim();
    out.set(packageId, {
      packageId,
      packageKind: String(row.PackageKind ?? ''),
      nameEn,
      nameAr: String(row.NameAr ?? '').trim() || nameEn,
      packagePrice: Number(row.PackagePrice) || 0,
      originalPrice: row.OriginalPrice == null ? null : Number(row.OriginalPrice),
      durationMinutes: row.DurationMinutes == null ? null : Number(row.DurationMinutes),
      items: [],
    });
  }
  for (const row of itemRes.recordset) {
    const info = out.get(Number(row.PackageID));
    if (!info || row.IsOptional) continue;
    info.items.push({
      proId: Number(row.ProID),
      label: String(row.ProName ?? '').trim() || `#${row.ProID}`,
      listPrice: Number(row.SPrice1) || 0,
    });
  }
  return out;
}
