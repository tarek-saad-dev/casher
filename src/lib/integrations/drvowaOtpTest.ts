import 'server-only';

import { getDrvowaIntegrationConfig } from '@/lib/integrations/drvowaConfig';

export type OtpTestResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function callDrvowaOtpForAdminTest(
  action: 'send' | 'verify',
  payload: Record<string, unknown>,
): Promise<OtpTestResult> {
  const config = await getDrvowaIntegrationConfig();
  if (!config || config.status !== 'ACTIVE') {
    return { status: 409, body: { ok: false, code: 'DRVOWA_NOT_PAIRED', error: 'اربط DRVO أولاً من صفحة التكاملات.' } };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${config.drvowaBaseUrl.replace(/\/$/, '')}/api/external/v1/otp/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.inboundApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        status: 502,
        body: { ok: false, code: 'DRVOWA_BAD_RESPONSE', error: 'DRVO رجّع استجابة غير مفهومة.' },
      };
    }
    const safe = parsed as Record<string, unknown>;
    // Whitelist keys: never return token, secret, request body or OTP.
    if (response.ok) {
      return {
        status: response.status,
        body: action === 'send' ? {
          ok: true,
          challengeId: safe.challengeId,
          status: safe.status,
          expiresAtUtc: safe.expiresAtUtc,
          resendAfterSec: safe.resendAfterSec,
        } : {
          ok: true,
          verified: safe.verified === true,
          phoneNormalized: safe.phoneNormalized,
          purpose: safe.purpose,
        },
      };
    }
    const code = typeof safe.code === 'string' ? safe.code.slice(0, 100) : `DRVOWA_HTTP_${response.status}`;
    return { status: response.status, body: { ok: false, code, error: 'فشل طلب التحقق من DRVO. راجع كود الخطأ.' } };
  } catch {
    return { status: 504, body: { ok: false, code: 'DRVOWA_TIMEOUT', error: 'تعذر الوصول لـ DRVO أو انتهت مهلة الرد.' } };
  } finally {
    clearTimeout(timeout);
  }
}
