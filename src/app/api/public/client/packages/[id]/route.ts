// ============================================
// GET /api/public/client/packages/[id]
// Client website — single package detail
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getPublicPackageById } from '@/lib/catalog/publicPackagesCatalog';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

type RouteCtx = { params: Promise<{ id: string }> };

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/public/client/packages/:id
 */
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const packageId = parseInt(id, 10);
    if (isNaN(packageId) || packageId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid package id', code: 'INVALID_ID' },
        { status: 400, headers: corsHeaders },
      );
    }

    const pkg = await getPublicPackageById(packageId);
    if (!pkg) {
      return NextResponse.json(
        { ok: false, error: 'Package not found', code: 'NOT_FOUND' },
        { status: 404, headers: corsHeaders },
      );
    }

    return NextResponse.json(
      { ok: true, currency: 'EGP', package: pkg },
      { headers: corsHeaders },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/public/client/packages/[id]] GET error:', message);
    return NextResponse.json(
      { ok: false, error: 'Failed to load package', code: 'PACKAGE_UNAVAILABLE' },
      { status: 500, headers: corsHeaders },
    );
  }
}
