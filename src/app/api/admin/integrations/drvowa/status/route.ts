import { NextResponse } from 'next/server';

import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getDrvowaIntegrationConfig } from '@/lib/integrations/drvowaConfig';
import { isDrvowaOwnerTenant } from '@/lib/integrations/drvowaTenant';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  if (!(await isDrvowaOwnerTenant(auth.tenantId))) {
    return NextResponse.json(
      { ok: false, code: 'DRVOWA_NOT_AVAILABLE_FOR_TENANT', error: 'DRVOWA is not available for this tenant' },
      { status: 403 },
    );
  }

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
