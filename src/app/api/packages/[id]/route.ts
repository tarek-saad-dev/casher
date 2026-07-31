import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  getServicePackageById,
  softDeleteServicePackage,
  updateServicePackage,
  validatePackageBody,
} from '@/lib/catalog/servicePackages';
import { ensureServicePackagesTables } from '@/lib/migrations/ensureServicePackages';

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/packages/[id]
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const packageId = parseInt(id, 10);
    if (isNaN(packageId)) {
      return NextResponse.json({ error: 'معرف الباكدج غير صالح' }, { status: 400 });
    }

    const db = await getPool();
    const ready = await ensureServicePackagesTables(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جداول الباكدجات غير متوفرة' },
        { status: 503 },
      );
    }

    const pkg = await getServicePackageById(db, packageId);
    if (!pkg) {
      return NextResponse.json({ error: 'الباكدج غير موجود' }, { status: 404 });
    }
    return NextResponse.json(pkg);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/packages/[id]] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/packages/[id]
export async function PUT(req: NextRequest, { params }: RouteCtx) {
  const auth = await requirePageAccess('/admin/packages');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const packageId = parseInt(id, 10);
    if (isNaN(packageId)) {
      return NextResponse.json({ error: 'معرف الباكدج غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const validated = validatePackageBody(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const db = await getPool();
    const ready = await ensureServicePackagesTables(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جداول الباكدجات غير متوفرة' },
        { status: 503 },
      );
    }

    const updated = await updateServicePackage(db, packageId, validated.data);
    if (!updated) {
      return NextResponse.json({ error: 'الباكدج غير موجود' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/packages/[id]] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/packages/[id] — soft delete
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requirePageAccess('/admin/packages');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const packageId = parseInt(id, 10);
    if (isNaN(packageId)) {
      return NextResponse.json({ error: 'معرف الباكدج غير صالح' }, { status: 400 });
    }

    const db = await getPool();
    const ready = await ensureServicePackagesTables(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جداول الباكدجات غير متوفرة' },
        { status: 503 },
      );
    }

    const ok = await softDeleteServicePackage(db, packageId);
    if (!ok) {
      return NextResponse.json({ error: 'الباكدج غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/packages/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
