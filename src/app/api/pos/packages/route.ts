import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getPublicPackagesCatalog } from '@/lib/catalog/publicPackagesCatalog';

/**
 * GET /api/pos/packages
 * Staff catalog for POS — every active package (regular + groom), DB source of truth.
 */
export async function GET() {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const catalog = await getPublicPackagesCatalog();
    return NextResponse.json({
      ok: true,
      currency: catalog.currency,
      packages: catalog.packages,
      meta: catalog.meta,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/packages] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
