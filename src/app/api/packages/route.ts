import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  createServicePackage,
  listServicePackages,
  validatePackageBody,
} from '@/lib/catalog/servicePackages';
import { ensureServicePackagesTables } from '@/lib/migrations/ensureServicePackages';

// GET /api/packages?kind=regular|groom&active=true
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind') ?? undefined;
    const activeOnly = searchParams.get('active') === 'true';

    const db = await getPool();
    const ready = await ensureServicePackagesTables(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جداول الباكدجات غير متوفرة — شغّل db/migrations/create-service-packages.sql' },
        { status: 503 },
      );
    }

    const packages = await listServicePackages(db, { kind, activeOnly });
    return NextResponse.json(packages);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/packages] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/packages
export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/admin/packages');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const validated = validatePackageBody(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const db = await getPool();
    const ready = await ensureServicePackagesTables(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جداول الباكدجات غير متوفرة — شغّل db/migrations/create-service-packages.sql' },
        { status: 503 },
      );
    }

    const created = await createServicePackage(db, validated.data);
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/packages] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
