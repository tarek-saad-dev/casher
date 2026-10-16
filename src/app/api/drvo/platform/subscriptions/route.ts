import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { applyCommercialEntitlementCommand, DrvoCommercialConflictError } from '@/platform/modules/commercialEntitlementService';
import { validateCommercialEntitlementCommand, type CommercialEntitlementCommand } from '@/platform/modules/commercialEntitlementCommand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stagingSafe(): boolean {
  return process.env.DRVO_STAGING_MODE === 'true' &&
    process.env.STAGING_SAFETY_ENFORCE === 'true' &&
    process.env.STAGING_SAFETY_DB_NAME === 'last132_agent' &&
    process.env.DB_NAME === 'last132_agent' &&
    process.env.DB_DATABASE === 'last132_agent' &&
    process.env.DB_USER === 'drvo_agent';
}

export async function POST(request: NextRequest) {
  if (!stagingSafe()) return NextResponse.json({ error: 'STAGING_ONLY' }, { status: 503 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  // Same-origin + explicit custom header blocks cross-site form submissions.
  // Proxy may forward x-forwarded-host; compare against the actual request URL origin.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const expectedHost = forwardedHost || host;
  const expectedProtocol = forwardedProto || new URL(request.url).protocol.replace(':', '');
  let validOrigin = false;
  try {
    const parsed = origin ? new URL(origin) : null;
    validOrigin = !!parsed && parsed.host === expectedHost &&
      parsed.protocol === expectedProtocol + ':' && parsed.username === '' && parsed.password === '';
  } catch { /* deny malformed origin */ }
  if (!validOrigin || request.headers.get('x-drvo-commercial-intent') !== '1') {
    return NextResponse.json({ error: 'CSRF_DENIED' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'JSON_REQUIRED' }, { status: 415 });
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  let input: CommercialEntitlementCommand;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 4096) {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON_BODY');
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some(key => !['tenantId','moduleKey','action','validUntilUtc','requestId'].includes(key)) ||
        typeof record.tenantId !== 'string' || typeof record.moduleKey !== 'string' ||
        typeof record.action !== 'string' || typeof record.requestId !== 'string' ||
        (record.validUntilUtc != null && typeof record.validUntilUtc !== 'string')) {
      throw new Error('INVALID_JSON_BODY');
    }
    input = validateCommercialEntitlementCommand(record as CommercialEntitlementCommand);
  } catch {
    return NextResponse.json({ error: 'INVALID_COMMERCIAL_COMMAND' }, { status: 400 });
  }

  try {
    const result = await applyCommercialEntitlementCommand(session.UserID, input);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof DrvoCommercialConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'PLATFORM_ENTITLEMENT_MANAGE_DENIED') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    if (error instanceof Error && error.message === 'ACTIVE_TENANT_NOT_FOUND') {
      return NextResponse.json({ error: 'ACTIVE_TENANT_NOT_FOUND' }, { status: 404 });
    }
    console.error('[drvo/platform/subscriptions] command failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'COMMERCIAL_COMMAND_FAILED' }, { status: 503 });
  }
}
