import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { installTenantApp } from '@/platform/apps/tenantApps';
import {
  invalidTenantIdResponse,
  platformErrorResponse,
  readJsonBody,
} from '../../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/** POST /api/admin/platform/tenants/:tenantId/apps/install — body { appCode }. */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  try {
    const body = await readJsonBody(req);
    const result = await installTenantApp(tenantId, String(body.appCode ?? ''), {
      actor: { actorUserId: auth.userId },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/apps/install] POST error:', err);
    return NextResponse.json({ error: 'App install failed' }, { status: 500 });
  }
}
