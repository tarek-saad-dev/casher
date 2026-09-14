import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getPublicPackagesCatalog } from '@/lib/catalog/publicPackagesCatalog';

/**
 * GET /api/pos/groom-packages
 * Staff catalog for POS — reuses public package wire (DB source of truth).
 */
export async function GET() {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const catalog = await getPublicPackagesCatalog({ kind: 'groom' });
    return NextResponse.json({
      ok: true,
      currency: catalog.currency,
      packages: catalog.groom,
      meta: catalog.meta,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/groom-packages] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
