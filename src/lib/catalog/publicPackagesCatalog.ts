import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool } from '@/lib/db';
import {
  getPackageItems,
  getServicePackageById,
  listServicePackages,
} from '@/lib/catalog/servicePackages';
import type { PackageItemRow, ServicePackageRow } from '@/lib/catalog/servicePackages.types';
import {
  ensureServicePackagesTables,
  isPackageKind,
  type PackageKind,
} from '@/lib/migrations/ensureServicePackages';
import {
  sanitizePublicDescription,
  sanitizePublicImageUrl,
} from '@/lib/booking/publicBookingServicePolicy';

export const PUBLIC_PACKAGES_CONTRACT_VERSION = 'public-packages-v1';
export const PUBLIC_PACKAGES_CURRENCY = 'EGP' as const;

export type PublicPackageItemWire = {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  qty: number;
  optional: boolean;
  listPrice: number | null;
  durationMinutes: number | null;
};

export type PublicPackageWire = {
  packageId: number;
  kind: PackageKind;
  nameAr: string;
  nameEn: string;
  name: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  price: number;
  originalPrice: number | null;
  savings: number | null;
  durationMinutes: number | null;
  imageUrl: string | null;
  popular: boolean;
  sortOrder: number;
  includes: PublicPackageItemWire[];
  /** Groom-only fields (null for regular) */
  groom: {
    depositAmount: number | null;
    includesTrial: boolean;
    sessionCount: number | null;
    notesAr: string | null;
  } | null;
};

export type PublicPackagesCatalogResponse = {
  ok: true;
  currency: typeof PUBLIC_PACKAGES_CURRENCY;
  regular: PublicPackageWire[];
  groom: PublicPackageWire[];
  /** Flat list: regular then groom, each sorted by sortOrder */
  packages: PublicPackageWire[];
  meta: {
    regularCount: number;
    groomCount: number;
    totalCount: number;
    generatedAt: string;
    contractVersion: string;
  };
};

function itemDisplayNames(item: PackageItemRow): { nameAr: string; nameEn: string; name: string } {
  const nameEn = (item.ProName ?? '').trim();
  const nameAr = (item.ProNameAr ?? '').trim() || nameEn;
  return {
    nameAr: nameAr || nameEn || `خدمة #${item.ProID}`,
    nameEn: nameEn || nameAr || `Service #${item.ProID}`,
    name: nameAr || nameEn || `خدمة #${item.ProID}`,
  };
}

function mapItemWire(item: PackageItemRow): PublicPackageItemWire {
  const names = itemDisplayNames(item);
  return {
    serviceId: item.ProID,
    nameAr: names.nameAr,
    nameEn: names.nameEn,
    name: names.name,
    qty: item.Qty,
    optional: item.IsOptional,
    listPrice: item.SPrice1,
    durationMinutes: item.DurationMinutes,
  };
}

function mapPackageWire(pkg: ServicePackageRow, items: PackageItemRow[]): PublicPackageWire {
  const nameEn = (pkg.NameEn ?? '').trim();
  const nameAr = (pkg.NameAr ?? '').trim() || nameEn;
  const price = Number(pkg.PackagePrice) || 0;
  const original =
    pkg.OriginalPrice != null && Number.isFinite(Number(pkg.OriginalPrice))
      ? Number(pkg.OriginalPrice)
      : null;
  const savings =
    original != null && original > price ? Math.round((original - price) * 100) / 100 : null;

  return {
    packageId: pkg.PackageID,
    kind: pkg.PackageKind,
    nameAr: nameAr || nameEn,
    nameEn: nameEn || nameAr,
    name: nameAr || nameEn,
    descriptionAr: sanitizePublicDescription(pkg.DescriptionAr),
    descriptionEn: sanitizePublicDescription(pkg.DescriptionEn),
    price,
    originalPrice: original,
    savings,
    durationMinutes: pkg.DurationMinutes,
    imageUrl: sanitizePublicImageUrl(pkg.ImageUrl),
    popular: Boolean(pkg.IsPopular),
    sortOrder: pkg.SortOrder,
    includes: items
      .slice()
      .sort((a, b) => a.SortOrder - b.SortOrder || a.PackageItemID - b.PackageItemID)
      .map(mapItemWire),
    groom:
      pkg.PackageKind === 'groom'
        ? {
            depositAmount: pkg.DepositAmount,
            includesTrial: Boolean(pkg.IncludesTrial),
            sessionCount: pkg.SessionCount,
            notesAr: sanitizePublicDescription(pkg.NotesAr),
          }
        : null,
  };
}

async function loadItemsByPackageIds(
  db: ConnectionPool,
  packageIds: number[],
): Promise<Map<number, PackageItemRow[]>> {
  const map = new Map<number, PackageItemRow[]>();
  if (packageIds.length === 0) return map;

  // Bound batch — packages catalogs are small; load per-id is fine and avoids dynamic IN risks
  await Promise.all(
    packageIds.map(async (id) => {
      map.set(id, await getPackageItems(db, id));
    }),
  );
  return map;
}

export async function getPublicPackagesCatalog(opts: {
  kind?: string | null;
} = {}): Promise<PublicPackagesCatalogResponse> {
  const db = await getPool();
  const ready = await ensureServicePackagesTables(db);
  if (!ready) {
    return {
      ok: true,
      currency: PUBLIC_PACKAGES_CURRENCY,
      regular: [],
      groom: [],
      packages: [],
      meta: {
        regularCount: 0,
        groomCount: 0,
        totalCount: 0,
        generatedAt: new Date().toISOString(),
        contractVersion: PUBLIC_PACKAGES_CONTRACT_VERSION,
      },
    };
  }

  const kindFilter = opts.kind && isPackageKind(opts.kind) ? opts.kind : undefined;
  const rows = await listServicePackages(db, {
    kind: kindFilter,
    activeOnly: true,
  });

  const itemsMap = await loadItemsByPackageIds(
    db,
    rows.map((r) => r.PackageID),
  );

  const wires = rows.map((r) => mapPackageWire(r, itemsMap.get(r.PackageID) ?? []));
  const regular = wires.filter((p) => p.kind === 'regular');
  const groom = wires.filter((p) => p.kind === 'groom');
  const packages = [...regular, ...groom];

  return {
    ok: true,
    currency: PUBLIC_PACKAGES_CURRENCY,
    regular,
    groom,
    packages,
    meta: {
      regularCount: regular.length,
      groomCount: groom.length,
      totalCount: packages.length,
      generatedAt: new Date().toISOString(),
      contractVersion: PUBLIC_PACKAGES_CONTRACT_VERSION,
    },
  };
}

export async function getPublicPackageById(
  packageId: number,
): Promise<PublicPackageWire | null> {
  const db = await getPool();
  const ready = await ensureServicePackagesTables(db);
  if (!ready) return null;

  const pkg = await getServicePackageById(db, packageId);
  if (!pkg || pkg.isDeleted) return null;

  return mapPackageWire(pkg, pkg.items ?? []);
}
