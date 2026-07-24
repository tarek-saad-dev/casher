import { getPool } from '@/lib/db';
import { ensureTblProImageUrlColumn, tblProImageUrlSelect } from '@/lib/migrations/ensureServiceImageUrl';
import {
  ensureTblCatSortOrderColumn,
  tblCatSortOrderSelect,
} from '@/lib/migrations/ensureCategorySortOrder';
import type {
  ServiceCatalogCategory,
  ServiceCatalogItem,
  ServiceCatalogMeta,
  ServiceCatalogQuery,
  ServiceCatalogResponse,
  ServiceCatalogRow,
  ServiceCatalogTypeFilter,
} from '@/lib/catalog/serviceCatalog.types';

const UNCATEGORIZED_NAME = 'بدون قسم';
/** Uncategorized always last */
const UNCATEGORIZED_SORT = 999999;

export function normalizeCatalogQuery(
  input: ServiceCatalogQuery = {},
): Required<ServiceCatalogQuery> {
  const type: ServiceCatalogTypeFilter =
    input.type === 'pro' || input.type === 'all' || input.type === 'serv'
      ? input.type
      : 'serv';

  const categoryId =
    typeof input.categoryId === 'number' && Number.isFinite(input.categoryId)
      ? input.categoryId
      : null;

  const search = input.search?.trim() ? input.search.trim() : null;

  return {
    activeOnly: input.activeOnly !== false,
    type,
    categoryId,
    search,
    includeEmpty: input.includeEmpty === true,
  };
}

function toServiceItem(row: ServiceCatalogRow): ServiceCatalogItem {
  return {
    id: Number(row.ProID),
    nameEn: String(row.ProName ?? '').trim(),
    nameAr: row.ProNameAr?.trim() ? String(row.ProNameAr).trim() : null,
    price: Number(row.SPrice1) || 0,
    bonus: Number(row.Bonus) || 0,
    durationMinutes:
      row.DurationMinutes == null || row.DurationMinutes === undefined
        ? null
        : Number(row.DurationMinutes),
    imageUrl: row.ImageUrl?.trim() ? String(row.ImageUrl).trim() : null,
    isActive: !(row.isDeleted === true || row.isDeleted === 1),
    salesCount: Number(row.SalesCount) || 0,
    categoryId: row.CatID == null ? null : Number(row.CatID),
  };
}

function matchesSearch(item: ServiceCatalogItem, search: string): boolean {
  const q = search.toLowerCase();
  return (
    item.nameEn.toLowerCase().includes(q) ||
    (item.nameAr?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Pure: group flat SQL rows into categories → services.
 * Categories ordered by sortOrder ASC (then name); services by salesCount desc then nameEn.
 */
export function groupServicesByCategory(
  rows: ServiceCatalogRow[],
  query: ServiceCatalogQuery = {},
): ServiceCatalogCategory[] {
  const opts = normalizeCatalogQuery(query);
  const map = new Map<string, ServiceCatalogCategory>();

  for (const row of rows) {
    if (opts.activeOnly && (row.isDeleted === true || row.isDeleted === 1)) {
      continue;
    }

    const catType = (row.CatType ?? '').toLowerCase() || null;
    if (opts.type === 'serv') {
      if (catType === 'pro') continue;
    } else if (opts.type === 'pro') {
      if (catType !== 'pro') continue;
    }

    if (opts.categoryId != null) {
      const rowCat = row.CatID == null ? null : Number(row.CatID);
      if (rowCat !== opts.categoryId) continue;
    }

    const item = toServiceItem(row);
    if (opts.search && !matchesSearch(item, opts.search)) continue;

    const catId = row.CatID == null ? null : Number(row.CatID);
    const key = catId == null ? 'uncategorized' : String(catId);

    if (!map.has(key)) {
      map.set(key, {
        id: catId,
        name: row.CatName?.trim() || UNCATEGORIZED_NAME,
        type: catType,
        sortOrder: catId == null ? UNCATEGORIZED_SORT : Number(row.SortOrder) || 0,
        serviceCount: 0,
        services: [],
      });
    }

    map.get(key)!.services.push(item);
  }

  const categories = Array.from(map.values());

  for (const cat of categories) {
    cat.services.sort((a, b) => {
      const salesDiff = b.salesCount - a.salesCount;
      if (salesDiff !== 0) return salesDiff;
      return a.nameEn.localeCompare(b.nameEn, 'en', { sensitivity: 'base' });
    });
    cat.serviceCount = cat.services.length;
  }

  categories.sort((a, b) => {
    const orderDiff = a.sortOrder - b.sortOrder;
    if (orderDiff !== 0) return orderDiff;
    if (a.id == null && b.id != null) return 1;
    if (a.id != null && b.id == null) return -1;
    return a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' });
  });

  if (opts.includeEmpty) return categories;
  return categories.filter((c) => c.serviceCount > 0);
}

export function buildCatalogMeta(
  categories: ServiceCatalogCategory[],
  query: ServiceCatalogQuery = {},
): ServiceCatalogMeta {
  const opts = normalizeCatalogQuery(query);
  return {
    categoryCount: categories.length,
    serviceCount: categories.reduce((sum, c) => sum + c.serviceCount, 0),
    filters: {
      activeOnly: opts.activeOnly,
      type: opts.type,
      categoryId: opts.categoryId,
      search: opts.search,
      includeEmpty: opts.includeEmpty,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function fetchServiceCatalog(
  query: ServiceCatalogQuery = {},
): Promise<ServiceCatalogResponse> {
  const opts = normalizeCatalogQuery(query);
  const db = await getPool();
  const hasImageUrl = await ensureTblProImageUrlColumn(db);
  const hasSortOrder = await ensureTblCatSortOrderColumn(db);
  const imageUrlCol = tblProImageUrlSelect(hasImageUrl);
  const sortOrderCol = tblCatSortOrderSelect(hasSortOrder);

  const orderBySort = hasSortOrder
    ? 'ISNULL(c.SortOrder, 999999)'
    : '999999';

  const result = await db.request().query(`
    SELECT
      p.ProID,
      p.ProName,
      p.ProNameAr,
      p.SPrice1,
      ISNULL(p.Bonus, 0) AS Bonus,
      p.DurationMinutes,
      ${imageUrlCol},
      ISNULL(p.isDeleted, 0) AS isDeleted,
      ISNULL(pop.SalesCount, 0) AS SalesCount,
      p.CatID,
      c.CatName,
      c.CatType,
      ${sortOrderCol}
    FROM [dbo].[TblPro] p
    LEFT JOIN [dbo].[TblCat] c ON p.CatID = c.CatID
    LEFT JOIN (
      SELECT ProID, COUNT(*) AS SalesCount
      FROM [dbo].[TblinvServDetail]
      GROUP BY ProID
    ) pop ON p.ProID = pop.ProID
    ORDER BY ${orderBySort}, c.CatName, ISNULL(pop.SalesCount, 0) DESC, p.ProName
  `);

  const categories = groupServicesByCategory(
    result.recordset as ServiceCatalogRow[],
    opts,
  );

  return {
    ok: true,
    meta: buildCatalogMeta(categories, opts),
    categories,
  };
}
