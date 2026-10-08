import { NextResponse } from 'next/server';

import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { pairWithDrvowa } from '@/lib/integrations/drvowaPairing';

export const runtime = 'nodejs';

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

    const erpBaseUrl = (
      process.env.APP_PUBLIC_URL?.trim()
      || new URL(request.url).origin
    ).replace(/\/$/, '');

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
    const code = error instanceof Error ? error.message : 'DRVOWA_PAIR_FAILED';
    return NextResponse.json(
      {
        ok: false,
        code,
        error:
          code.includes('403') || code.includes('PAIR')
            ? 'كود الربط غير صالح أو انتهت صلاحيته'
            : 'تعذر إكمال الربط مع DRVOWA',
      },
      { status: 400 },
    );
  }
}
