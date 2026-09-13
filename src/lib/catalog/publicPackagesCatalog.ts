import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool, sql } from '@/lib/db';
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
import {
  GROOM_OPTIONAL_GROUP_META,
  resolveGroomOptionalGroup,
  type GroomOptionalGroup,
} from '@/lib/catalog/groomOptionalAddons';

export const PUBLIC_PACKAGES_CONTRACT_VERSION = 'public-packages-v2';
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
  /** Present on optional items when group can be resolved */
  group?: GroomOptionalGroup | null;
};

export type PublicGroomOptionalItemWire = {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  group: GroomOptionalGroup;
  active: boolean;
  /** True when this ProID is already a required (non-optional) package include */
  alreadyIncluded: boolean;
  /** True when linked as IsOptional on this package and selectable */
  availableAsOptional: boolean;
  mutuallyExclusiveGroup: GroomOptionalGroup | null;
  durationMinutes: number | null;
};

export type PublicGroomOptionalGroupWire = {
  key: GroomOptionalGroup;
  labelEn: string;
  labelAr: string;
  multiSelect: boolean;
  mutuallyExclusive: boolean;
  items: PublicGroomOptionalItemWire[];
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
    optionalExtras: PublicGroomOptionalItemWire[];
    optionalGroups: PublicGroomOptionalGroupWire[];
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

type ServiceMeta = {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  DurationMinutes: number | null;
  CatName: string | null;
  isDeleted: boolean;
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

function serviceDisplayNames(svc: ServiceMeta): { nameAr: string; nameEn: string; name: string } {
  const nameEn = (svc.ProName ?? '').trim();
  const nameAr = (svc.ProNameAr ?? '').trim() || nameEn;
  return {
    nameAr: nameAr || nameEn || `خدمة #${svc.ProID}`,
    nameEn: nameEn || nameAr || `Service #${svc.ProID}`,
    name: nameAr || nameEn || `خدمة #${svc.ProID}`,
  };
}

function mapItemWire(
  item: PackageItemRow,
  group: GroomOptionalGroup | null = null,
): PublicPackageItemWire {
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
    ...(item.IsOptional ? { group } : {}),
  };
}

async function loadServiceMetaByIds(
  db: ConnectionPool,
  proIds: number[],
): Promise<Map<number, ServiceMeta>> {
  const map = new Map<number, ServiceMeta>();
  const unique = [...new Set(proIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return map;

  // Small catalogs — load individually to avoid dynamic IN construction issues
  await Promise.all(
    unique.map(async (proId) => {
      const result = await db
        .request()
        .input('ProID', sql.Int, proId)
        .query(`
          SELECT
            p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
            ISNULL(p.isDeleted, 0) AS isDeleted,
            c.CatName
          FROM dbo.TblPro p
          LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
          WHERE p.ProID = @ProID
        `);
      const row = result.recordset[0] as Record<string, unknown> | undefined;
      if (!row) return;
      map.set(proId, {
        ProID: Number(row.ProID),
        ProName: String(row.ProName ?? ''),
        ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
        SPrice1: Number(row.SPrice1) || 0,
        DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
        CatName: row.CatName != null ? String(row.CatName) : null,
        isDeleted: Number(row.isDeleted) === 1,
      });
    }),
  );
  return map;
}

function buildGroomOptionalExtras(
  items: PackageItemRow[],
  serviceMeta: Map<number, ServiceMeta>,
): {
  optionalExtras: PublicGroomOptionalItemWire[];
  optionalGroups: PublicGroomOptionalGroupWire[];
  includes: PublicPackageItemWire[];
} {
  const requiredIds = new Set(items.filter((i) => !i.IsOptional).map((i) => i.ProID));
  const optionalItems = items.filter((i) => i.IsOptional);

  const includes = items
    .slice()
    .sort((a, b) => a.SortOrder - b.SortOrder || a.PackageItemID - b.PackageItemID)
    .map((item) => {
      const meta = serviceMeta.get(item.ProID);
      const group = item.IsOptional
        ? resolveGroomOptionalGroup({
            proId: item.ProID,
            catName: meta?.CatName ?? null,
          })
        : null;
      return mapItemWire(item, group);
    });

  // Build extras from optional links + required-included fixed addons (alreadyIncluded)
  const extrasById = new Map<number, PublicGroomOptionalItemWire>();

  for (const item of optionalItems) {
    const meta = serviceMeta.get(item.ProID);
    const group =
      resolveGroomOptionalGroup({
        proId: item.ProID,
        catName: meta?.CatName ?? null,
      }) ?? 'groom_addons';
    const names = meta ? serviceDisplayNames(meta) : itemDisplayNames(item);
    const alreadyIncluded = requiredIds.has(item.ProID);
    extrasById.set(item.ProID, {
      serviceId: item.ProID,
      nameAr: names.nameAr,
      nameEn: names.nameEn,
      name: names.name,
      price: meta?.SPrice1 ?? item.SPrice1 ?? 0,
      group,
      active: meta ? !meta.isDeleted : true,
      alreadyIncluded,
      availableAsOptional: !alreadyIncluded,
      mutuallyExclusiveGroup: group === 'home_visit' ? 'home_visit' : null,
      durationMinutes: meta?.DurationMinutes ?? item.DurationMinutes,
    });
  }

  // Surface required protein/pedicure as alreadyIncluded so Complete clients can hide them
  for (const item of items.filter((i) => !i.IsOptional)) {
    const meta = serviceMeta.get(item.ProID);
    const group = resolveGroomOptionalGroup({
      proId: item.ProID,
      catName: meta?.CatName ?? null,
    });
    if (group !== 'groom_addons') continue;
    if (extrasById.has(item.ProID)) continue;
    const names = meta ? serviceDisplayNames(meta) : itemDisplayNames(item);
    extrasById.set(item.ProID, {
      serviceId: item.ProID,
      nameAr: names.nameAr,
      nameEn: names.nameEn,
      name: names.name,
      price: meta?.SPrice1 ?? item.SPrice1 ?? 0,
      group,
      active: meta ? !meta.isDeleted : true,
      alreadyIncluded: true,
      availableAsOptional: false,
      mutuallyExclusiveGroup: null,
      durationMinutes: meta?.DurationMinutes ?? item.DurationMinutes,
    });
  }

  const optionalExtras = [...extrasById.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.serviceId - b.serviceId,
  );

  const optionalGroups: PublicGroomOptionalGroupWire[] = (
    Object.keys(GROOM_OPTIONAL_GROUP_META) as GroomOptionalGroup[]
  )
    .map((key) => {
      const meta = GROOM_OPTIONAL_GROUP_META[key];
      return {
        key,
        labelEn: meta.labelEn,
        labelAr: meta.labelAr,
        multiSelect: meta.multiSelect,
        mutuallyExclusive: meta.mutuallyExclusive,
        items: optionalExtras.filter((i) => i.group === key),
      };
    })
    .filter((g) => g.items.length > 0);

  return { optionalExtras, optionalGroups, includes };
}

function mapPackageWire(
  pkg: ServicePackageRow,
  items: PackageItemRow[],
  serviceMeta: Map<number, ServiceMeta>,
): PublicPackageWire {
  const nameEn = (pkg.NameEn ?? '').trim();
  const nameAr = (pkg.NameAr ?? '').trim() || nameEn;
  const price = Number(pkg.PackagePrice) || 0;
  const original =
    pkg.OriginalPrice != null && Number.isFinite(Number(pkg.OriginalPrice))
      ? Number(pkg.OriginalPrice)
      : null;
  const savings =
    original != null && original > price ? Math.round((original - price) * 100) / 100 : null;

  const groomExtras =
    pkg.PackageKind === 'groom'
      ? buildGroomOptionalExtras(items, serviceMeta)
      : null;

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
    includes:
      groomExtras?.includes ??
      items
        .slice()
        .sort((a, b) => a.SortOrder - b.SortOrder || a.PackageItemID - b.PackageItemID)
        .map((item) => mapItemWire(item)),
    groom:
      pkg.PackageKind === 'groom'
        ? {
            depositAmount: pkg.DepositAmount,
            includesTrial: Boolean(pkg.IncludesTrial),
            sessionCount: pkg.SessionCount,
            notesAr: sanitizePublicDescription(pkg.NotesAr),
            optionalExtras: groomExtras?.optionalExtras ?? [],
            optionalGroups: groomExtras?.optionalGroups ?? [],
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

  const allProIds = [...itemsMap.values()].flat().map((i) => i.ProID);
  const serviceMeta = await loadServiceMetaByIds(db, allProIds);

  const wires = rows.map((r) =>
    mapPackageWire(r, itemsMap.get(r.PackageID) ?? [], serviceMeta),
  );
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

  const items = pkg.items ?? [];
  const serviceMeta = await loadServiceMetaByIds(
    db,
    items.map((i) => i.ProID),
  );
  return mapPackageWire(pkg, items, serviceMeta);
}

/** Load active home-visit ProIDs (for POS / sales exclusivity enforcement). */
export async function listHomeVisitProIds(db?: ConnectionPool): Promise<number[]> {
  const pool = db ?? (await getPool());
  const { GROOM_HOME_VISIT_CATEGORY_NAME } = await import('@/lib/catalog/groomOptionalAddons');
  const result = await pool
    .request()
    .input('CatName', sql.NVarChar(200), GROOM_HOME_VISIT_CATEGORY_NAME)
    .query(`
      SELECT p.ProID
      FROM dbo.TblPro p
      INNER JOIN dbo.TblCat c ON c.CatID = p.CatID
      WHERE ISNULL(p.isDeleted, 0) = 0
        AND c.CatName = @CatName
      ORDER BY p.ProID
    `);
  return (result.recordset as Array<{ ProID: number }>).map((r) => Number(r.ProID));
}
