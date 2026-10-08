import 'server-only';

import {
  generateDrvowaOutboundToken,
  hashDrvowaToken,
  saveDrvowaIntegrationConfig,
} from '@/lib/integrations/drvowaConfig';

type PairResponse = {
  ok: boolean;
  integrationId: string;
  inboundApiKey: string;
  next?: { refreshUrl?: string };
};

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('DRVOWA_BASE_URL_INVALID');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('DRVOWA_BASE_URL_HTTPS_REQUIRED');
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function pairWithDrvowa(params: {
  pairingCode: string;
  drvowaBaseUrl: string;
  erpBaseUrl: string;
  externalReference?: string | null;
}): Promise<{
  integrationId: string;
  manifestRefreshed: boolean;
}> {
  const drvowaBaseUrl = normalizeBaseUrl(params.drvowaBaseUrl);
  const erpBaseUrl = normalizeBaseUrl(params.erpBaseUrl);
  const outboundToken = generateDrvowaOutboundToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  let paired: PairResponse;
  try {
    const response = await fetch(`${drvowaBaseUrl}/api/external/v1/pair`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pairingCode: params.pairingCode,
        baseUrl: erpBaseUrl,
        outboundToken,
        externalReference: params.externalReference ?? 'DRVOERP',
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as
      | PairResponse
      | { error?: string; code?: string }
      | null;

    if (!response.ok || !payload || !('inboundApiKey' in payload)) {
      const rec =
        payload && typeof payload === 'object'
          ? payload as Record<string, unknown>
          : {};
      const code =
        typeof rec.code === 'string'
          ? rec.code
          : response.status === 403
            ? 'PAIRING_CODE_INVALID_OR_EXPIRED'
            : `DRVOWA_HTTP_${response.status}`;
      const message =
        typeof rec.error === 'string'
          ? rec.error
          : code;
      const error = new Error(message);
      (error as Error & { code?: string }).code = code;
      throw error;
    }

    paired = payload as PairResponse;
  } finally {
    clearTimeout(timer);
  }

  await saveDrvowaIntegrationConfig({
    drvowaBaseUrl,
    inboundApiKey: paired.inboundApiKey,
    outboundTokenHash: hashDrvowaToken(outboundToken),
    drvowaIntegrationId: paired.integrationId,
    status: 'ACTIVE',
  });

  let manifestRefreshed = false;
  try {
    const refreshResponse = await fetch(
      `${drvowaBaseUrl}/api/external/v1/integrations/refresh`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paired.inboundApiKey}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );
    manifestRefreshed = refreshResponse.ok;
  } catch {
    manifestRefreshed = false;
  }

  return {
    integrationId: paired.integrationId,
    manifestRefreshed,
  };
}
