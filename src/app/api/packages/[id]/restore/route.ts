import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getServicePackageById, restoreServicePackage } from '@/lib/catalog/servicePackages';
import { ensureServicePackagesTables } from '@/lib/migrations/ensureServicePackages';

// PATCH /api/packages/[id]/restore
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const existing = await getServicePackageById(db, packageId);
    if (!existing) {
      return NextResponse.json({ error: 'الباكدج غير موجود' }, { status: 404 });
    }

    if (!existing.isDeleted) {
      return NextResponse.json({ ...existing, alreadyActive: true });
    }

    await restoreServicePackage(db, packageId);
    const restored = await getServicePackageById(db, packageId);
    return NextResponse.json({ ...restored, alreadyActive: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/packages/[id]/restore] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
