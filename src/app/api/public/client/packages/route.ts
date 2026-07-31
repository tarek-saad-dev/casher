// ============================================
// GET /api/public/client/packages
// Client website — regular + groom packages catalog
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getPublicPackagesCatalog } from '@/lib/catalog/publicPackagesCatalog';
import { isPackageKind } from '@/lib/migrations/ensureServicePackages';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/public/client/packages
 *
 * Query:
 * - kind=regular|groom (optional) — filter one type; response still has regular/groom keys
 *
 * Response:
 * {
 *   ok: true,
 *   currency: "EGP",
 *   regular: PublicPackage[],
 *   groom: PublicPackage[],
 *   packages: PublicPackage[],  // flat: regular then groom
 *   meta: { regularCount, groomCount, totalCount, generatedAt, contractVersion }
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kindParam = searchParams.get('kind');

    if (kindParam && !isPackageKind(kindParam)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Invalid kind — use regular or groom',
          code: 'INVALID_KIND',
        },
        { status: 400, headers: corsHeaders },
      );
    }

    const catalog = await getPublicPackagesCatalog({ kind: kindParam });
    return NextResponse.json(catalog, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/public/client/packages] GET error:', message);
    return NextResponse.json(
      { ok: false, error: 'Failed to load packages', code: 'PACKAGES_UNAVAILABLE' },
      { status: 500, headers: corsHeaders },
    );
  }
}
