import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { validateBrandProfileInput } from '@/platform/branding/brandProfile';
import { saveTenantBrandProfile } from '@/platform/branding/brandRepository';
import {
  invalidTenantIdResponse,
  platformErrorResponse,
  readJsonBody,
} from '../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/** PUT /api/admin/platform/tenants/:tenantId/brand — operator edit of a tenant brand profile. */
export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  try {
    const body = await readJsonBody(req);
    const expectedRevision = body.expectedRevision != null ? Number(body.expectedRevision) : undefined;
    if (expectedRevision !== undefined && !Number.isInteger(expectedRevision)) {
      return NextResponse.json({ error: 'expectedRevision must be an integer', code: 'INVALID_REQUEST' }, { status: 400 });
    }
    const brand = await saveTenantBrandProfile(tenantId, validateBrandProfileInput(body), {
      actorUserId: auth.userId,
      expectedRevision,
      source: 'platform_operator',
    });
    return NextResponse.json({ brand });
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/brand] PUT error:', err);
    return NextResponse.json({ error: 'Brand update failed' }, { status: 500 });
  }
}
