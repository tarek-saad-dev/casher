import { NextResponse } from 'next/server';

import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { pairWithDrvowa } from '@/lib/integrations/drvowaPairing';

export const runtime = 'nodejs';

function resolveErpPublicBaseUrl(request: Request): string {
  const explicit = process.env.APP_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();
  if (!host) {
    throw new Error('ERP_PUBLIC_URL_UNRESOLVED');
  }

  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    ?.toLowerCase();
  const proto =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : 'https';

  return `${proto}://${host}`.replace(/\/$/, '');
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const pairingCode = String(body.pairingCode ?? '').trim();
    const drvowaBaseUrl = String(
      body.drvowaBaseUrl ?? process.env.DRVOWA_BASE_URL ?? 'https://app.drvotech.com',
    ).trim();
    const externalReference = String(body.externalReference ?? 'CUT-SALON-PROD').trim();

    if (!pairingCode) {
      return NextResponse.json(
        { ok: false, code: 'PAIRING_CODE_REQUIRED', error: 'كود الربط مطلوب' },
        { status: 400 },
      );
    }

    const erpBaseUrl = resolveErpPublicBaseUrl(request);

    const result = await pairWithDrvowa({
      pairingCode,
      drvowaBaseUrl,
      erpBaseUrl,
      externalReference,
    });

    return NextResponse.json({
      ok: true,
      integrationId: result.integrationId,
      manifestRefreshed: result.manifestRefreshed,
    });
  } catch (error) {
    const typed = error as Error & { code?: string };
    const code =
      typed?.code
      || (error instanceof Error ? error.message : 'DRVOWA_PAIR_FAILED');
    const isPairingCodeError =
      code === 'PAIRING_CODE_INVALID_OR_EXPIRED'
      || code === 'DRVOWA_HTTP_403';
    return NextResponse.json(
      {
        ok: false,
        code,
        error: isPairingCodeError
          ? 'كود الربط غير صالح أو انتهت صلاحيته'
          : 'تعذر إكمال الربط مع DRVOWA. جرّب مرة أخرى، ولو استمرت المشكلة راجع حالة الاتصال.',
      },
      { status: isPairingCodeError ? 400 : 502 },
    );
  }
}
