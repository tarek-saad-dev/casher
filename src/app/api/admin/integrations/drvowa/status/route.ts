import { NextResponse } from 'next/server';

import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getDrvowaIntegrationConfig } from '@/lib/integrations/drvowaConfig';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const config = await getDrvowaIntegrationConfig();
  return NextResponse.json({
    ok: true,
    connected: Boolean(config && config.status === 'ACTIVE'),
    integration: config
      ? {
          drvowaBaseUrl: config.drvowaBaseUrl,
          drvowaIntegrationId: config.drvowaIntegrationId,
          status: config.status,
          connectedAtUtc: config.connectedAtUtc,
          updatedAtUtc: config.updatedAtUtc,
        }
      : null,
  });
}
