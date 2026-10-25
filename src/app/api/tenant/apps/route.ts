import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getPool } from '@/lib/db';
import { buildAppManagerCatalog } from '@/platform/apps/selfServiceAppManager';
import { changeSelfServiceTenantApps, getTenantPackState, listTenantApps } from '@/platform/apps/tenantApps';
import { findIndustryPack } from '@/packs';
import { platformErrorResponse } from '@/app/api/admin/platform/_shared/platformErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadAppManager(tenantId: string, tenantCode: string) {
  const pool = await getPool();
  const [packState, states] = await Promise.all([
    getTenantPackState(pool, tenantId),
    listTenantApps(tenantId, { executor: pool }),
  ]);
  const pack = packState ? findIndustryPack(packState.packCode) : null;
  return {
    pack: pack ? { code: pack.packCode, name: pack.displayName } : null,
    apps: buildAppManagerCatalog(pack, states, { protectedTenant: tenantCode === 'CASHER_BOOT' }),
    protectedTenant: tenantCode === 'CASHER_BOOT',
  };
}

/** GET /api/tenant/apps — never accepts a tenantId from URL or client. */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    return NextResponse.json(
      await loadAppManager(auth.tenantId, auth.tenant.tenantCode),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[api/tenant/apps] GET failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تحميل التطبيقات' }, { status: 500 });
  }
}

/** POST /api/tenant/apps — exact one-app operation, optional explicit dependency bundle. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  let input: { action: 'install' | 'disable'; appCode: string; confirmDependencies?: boolean };
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    const fields = body as Record<string, unknown>;
    const allowed = new Set(['action', 'appCode', 'confirmDependencies', 'confirmDisable']);
    if (Object.keys(fields).some((key) => !allowed.has(key))) throw new Error('unknown field');
    if ((fields.action !== 'install' && fields.action !== 'disable') ||
        typeof fields.appCode !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(fields.appCode)) {
      throw new Error('invalid action or appCode');
    }
    if (fields.confirmDependencies !== undefined && typeof fields.confirmDependencies !== 'boolean') {
      throw new Error('invalid dependency confirmation');
    }
    if (fields.action === 'disable' && fields.confirmDisable !== true) {
      return NextResponse.json({ error: 'يجب تأكيد إيقاف التطبيق', code: 'CONFIRMATION_REQUIRED' }, { status: 400 });
    }
    input = {
      action: fields.action as 'install' | 'disable',
      appCode: fields.appCode,
      confirmDependencies: fields.confirmDependencies === true,
    };
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صحيحة', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    const change = await changeSelfServiceTenantApps(auth.tenantId, input, {
      actor: { actorUserId: auth.userId },
      resolvePack: findIndustryPack,
    });
    return NextResponse.json({
      change,
      ...(await loadAppManager(auth.tenantId, auth.tenant.tenantCode)),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const response = platformErrorResponse(err);
    if (response) return response;
    console.error('[api/tenant/apps] POST failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تعديل التطبيق' }, { status: 500 });
  }
}
