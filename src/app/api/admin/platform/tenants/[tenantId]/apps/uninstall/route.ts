import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { findIndustryPack } from '@/packs';
import { uninstallTenantApp } from '@/platform/apps/tenantApps';
import {
  invalidTenantIdResponse,
  platformErrorResponse,
  readJsonBody,
} from '../../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * POST /api/admin/platform/tenants/:tenantId/apps/uninstall — body { appCode }.
 * Disables tenant access only; historical, financial and audit data is preserved.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  try {
    const body = await readJsonBody(req);
    const result = await uninstallTenantApp(tenantId, String(body.appCode ?? ''), {
      actor: { actorUserId: auth.userId },
      resolvePack: findIndustryPack,
    });
    return NextResponse.json({ ...result, dataPreserved: true });
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/apps/uninstall] POST error:', err);
    return NextResponse.json({ error: 'App uninstall failed' }, { status: 500 });
  }
}
