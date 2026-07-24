import { NextRequest, NextResponse } from 'next/server';
import {
  fetchServiceCatalog,
  normalizeCatalogQuery,
} from '@/lib/catalog/serviceCatalog';
import type { ServiceCatalogTypeFilter } from '@/lib/catalog/serviceCatalog.types';

export const runtime = 'nodejs';

/**
 * GET /api/services/catalog
 *
 * Nested catalog: categories → services (nameEn + nameAr).
 *
 * Query params:
 *   active=true|false     default true (exclude soft-deleted)
 *   type=serv|pro|all     default serv (salon services; excludes product categories)
 *   categoryId=N          filter one category
 *   search=text           match nameEn or nameAr
 *   includeEmpty=true     keep categories with zero matching services
 *
 * Example:
 *   GET /api/services/catalog
 *   GET /api/services/catalog?type=serv&search=cut
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const activeParam = searchParams.get('active');
    const typeParam = searchParams.get('type');
    const categoryIdRaw = searchParams.get('categoryId');
    const search = searchParams.get('search');
    const includeEmptyParam = searchParams.get('includeEmpty');

    let categoryId: number | null = null;
    if (categoryIdRaw != null && categoryIdRaw !== '') {
      const n = Number(categoryIdRaw);
      if (!Number.isFinite(n)) {
        return NextResponse.json(
          { ok: false, error: 'categoryId غير صالح' },
          { status: 400 },
        );
      }
      categoryId = n;
    }

    let type: ServiceCatalogTypeFilter | undefined;
    if (typeParam != null && typeParam !== '') {
      if (typeParam !== 'serv' && typeParam !== 'pro' && typeParam !== 'all') {
        return NextResponse.json(
          { ok: false, error: 'type يجب أن يكون serv أو pro أو all' },
          { status: 400 },
        );
      }
      type = typeParam;
    }

    const catalog = await fetchServiceCatalog(
      normalizeCatalogQuery({
        activeOnly: activeParam === 'false' ? false : true,
        type,
        categoryId,
        search,
        includeEmpty: includeEmptyParam === 'true',
      }),
    );

    return NextResponse.json(catalog);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/catalog] GET error:', message);
    return NextResponse.json(
      { ok: false, error: 'فشل تحميل كتالوج الخدمات' },
      { status: 500 },
    );
  }
}
