import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import {
  BrandProfileValidationError,
  validateBrandProfileInput,
} from '@/platform/branding/brandProfile';
import {
  BrandProfileError,
  loadTenantBrandProfile,
  saveTenantBrandProfile,
} from '@/platform/branding/brandRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/tenant/brand — the session tenant's brand profile (tenant admins). */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const brand = await loadTenantBrandProfile(auth.tenantId);
  if (!brand) return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
  return NextResponse.json({ brand });
}

/**
 * PUT /api/tenant/brand — replace the session tenant's editable brand fields.
 * The tenant always comes from the authenticated session; a tenantId in the body is rejected.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  let body: Record<string, unknown>;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'صيغة الطلب غير صالحة', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  if ('tenantId' in body || 'TenantId' in body || 'revision' in body) {
    return NextResponse.json(
      { error: 'System-controlled fields are not accepted', code: 'FORBIDDEN_SYSTEM_FIELD' },
      { status: 400 },
    );
  }
  const expectedRevision = body.expectedRevision != null ? Number(body.expectedRevision) : undefined;
  if (expectedRevision !== undefined && !Number.isInteger(expectedRevision)) {
    return NextResponse.json({ error: 'expectedRevision must be an integer', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    const input = validateBrandProfileInput(body);
    const brand = await saveTenantBrandProfile(auth.tenantId, input, {
      actorUserId: auth.userId,
      expectedRevision,
      source: 'tenant_admin',
    });
    return NextResponse.json({ brand });
  } catch (err) {
    if (err instanceof BrandProfileValidationError || err instanceof BrandProfileError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/tenant/brand] PUT error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر حفظ هوية المنشأة' }, { status: 500 });
  }
}
