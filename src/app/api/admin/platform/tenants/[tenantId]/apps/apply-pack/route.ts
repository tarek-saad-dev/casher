import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { findIndustryPack } from '@/packs';
import { TenantAppError } from '@/platform/apps/errors';
import { applyIndustryPack } from '@/platform/apps/tenantApps';
import {
  invalidTenantIdResponse,
  platformErrorResponse,
  readJsonBody,
  readStringArray,
} from '../../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

/**
 * POST /api/admin/platform/tenants/:tenantId/apps/apply-pack
 * Body: { industryPackCode, appCustomizations: { add?: string[], remove?: string[] } }.
 * Final installed set = pack defaults + add − remove; leaving apps are disabled, not deleted.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  try {
    const body = await readJsonBody(req);
    const packCode = String(body.industryPackCode ?? '');
    const pack = findIndustryPack(packCode);
    if (!pack) {
      throw new TenantAppError('PACK_NOT_FOUND', `Unknown industry pack: ${packCode}`, 400);
    }
    const customizations = (body.appCustomizations ?? {}) as Record<string, unknown>;
    const result = await applyIndustryPack(
      tenantId,
      pack,
      {
        add: readStringArray(customizations.add, 'appCustomizations.add'),
        remove: readStringArray(customizations.remove, 'appCustomizations.remove'),
      },
      { actor: { actorUserId: auth.userId } },
    );
    return NextResponse.json(result);
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/apps/apply-pack] POST error:', err);
    return NextResponse.json({ error: 'Apply pack failed' }, { status: 500 });
  }
}
