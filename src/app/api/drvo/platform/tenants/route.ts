import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { loadPlatformPrincipal } from '@/platform/modules/platformAuthorityRepository';
import { findIndustryPack } from '@/packs';
import { provisionTenant } from '@/platform/onboarding/provisionTenant';
import { TenantOnboardingError } from '@/platform/onboarding/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowed = ['tenantCode','tenantDisplayName','industryPackCode','ownerUserName','ownerLoginName','ownerPassword','firstBranchCode','firstBranchName'];
const fields = ['tenantCode','tenantDisplayName','industryPackCode','ownerUserName','ownerLoginName','ownerPassword','firstBranchCode','firstBranchName'] as const;

function stagingSafe() {
  return process.env.DRVO_STAGING_MODE === 'true' &&
    process.env.STAGING_SAFETY_ENFORCE === 'true' &&
    process.env.STAGING_SAFETY_DB_NAME === 'last132_agent' &&
    process.env.DB_NAME === 'last132_agent' &&
    process.env.DB_DATABASE === 'last132_agent' &&
    process.env.DB_USER === 'drvo_agent' &&
    process.env.DRVO_STAGING_OUTBOUND_DISABLED === 'true' &&
    process.env.DRVO_STAGING_WORKERS_DISABLED === 'true' &&
    process.env.DRVO_STAGING_CRON_DISABLED === 'true';
}

export async function POST(req: NextRequest) {
  if (!stagingSafe()) return NextResponse.json({ error: 'STAGING_ONLY' }, { status: 503 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  let sameOrigin = false;
  try {
    const parsed = origin ? new URL(origin) : null;
    sameOrigin = !!parsed && parsed.host === host && parsed.protocol === proto + ':' && !parsed.username && !parsed.password;
  } catch { /* deny */ }
  if (!sameOrigin || req.headers.get('x-drvo-tenant-intent') !== '1')
    return NextResponse.json({ error: 'CSRF_DENIED' }, { status: 403 });
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return NextResponse.json({ error: 'JSON_REQUIRED' }, { status: 415 });
  if (Number(req.headers.get('content-length') || 0) > 4096)
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });

  let body: Record<string, string>;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 4096) return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some(key => !allowed.includes(key)) ||
        fields.some(key => typeof record[key] !== 'string' || !(record[key] as string).trim() || (record[key] as string).length > 100) ||
        !/^[A-Z][A-Z0-9_]{2,62}$/.test(String(record.tenantCode).trim().toUpperCase()) ||
        !/^[A-Z][A-Z0-9_]{2,29}$/.test(String(record.firstBranchCode).trim().toUpperCase()) ||
        String(record.ownerPassword).length < 12 ||
        String(record.ownerPassword).length > 50) throw Error();
    body = record as Record<string, string>;
  } catch {
    return NextResponse.json({ error: 'INVALID_TENANT_INPUT' }, { status: 400 });
  }
  const pack = findIndustryPack(body.industryPackCode);
  if (!pack) return NextResponse.json({ error: 'UNKNOWN_INDUSTRY_PACK' }, { status: 400 });
  try {
    const pool = await getPool();
    const db = await pool.request().query<{ name: string }>('SELECT DB_NAME() AS name');
    if (db.recordset[0]?.name !== 'last132_agent') throw Error('STAGING_DATABASE_MISMATCH');
    const principal = await loadPlatformPrincipal(session.UserID, { executor: pool });
    if (!principal.active || principal.userId !== session.UserID || !principal.grants.includes('platform.entitlements.manage'))
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    const result = await provisionTenant({
      tenantCode: body.tenantCode,
      tenantDisplayName: body.tenantDisplayName,
      defaultTimezone: 'Africa/Cairo',
      ownerUserName: body.ownerUserName,
      ownerLoginName: body.ownerLoginName,
      ownerPassword: body.ownerPassword,
      firstBranchCode: body.firstBranchCode,
      firstBranchName: body.firstBranchName,
      industryPack: pack,
      subscriptionStatus: 'trial',
    }, { actorUserId: session.UserID });
    return NextResponse.json({ tenantId: result.tenantId, tenantCode: result.tenantCode, branchCode: result.branchCode, ownerLoginName: result.ownerLoginName, readiness: result.readiness.overall }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TenantOnboardingError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('[drvo/platform/tenants] provision failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'TENANT_PROVISION_FAILED' }, { status: 503 });
  }
}
