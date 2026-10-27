import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getTenantInstalledAppsForGate } from '@/platform/commercial/tenantAccessGate';
import { evaluateTenantGoLive } from '@/platform/onboarding/goLiveReadiness';
import { buildTenantWorkspace } from '@/platform/tenant/workspaceReadiness';
import { enrichTenantWorkspaceWithProviders } from '@/platform/tenant/workspaceSignalCollector';
import { composeWorkspaceReadinessProviders } from './composeProviders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only app setup evidence for the authenticated tenant administrator.
 * No tenant selector: the only tenantId is resolved from the verified session.
 * This is workspace UX, not an authorization or installation management endpoint.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const [report, installedApps] = await Promise.all([
      evaluateTenantGoLive(auth.tenantId),
      getTenantInstalledAppsForGate(auth.tenantId),
    ]);
    if (!report || report.tenantId.toLowerCase() !== auth.tenantId.toLowerCase()) {
      return NextResponse.json(
        { error: 'المنشأة غير موجودة', code: 'TENANT_NOT_FOUND' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const baseline = buildTenantWorkspace(report, installedApps);
    const enriched = await enrichTenantWorkspaceWithProviders(
      baseline,
      auth.tenantId,
      composeWorkspaceReadinessProviders(),
    );

    return NextResponse.json(enriched, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[api/tenant/workspace] GET failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'تعذر تحميل حالة التطبيقات', code: 'WORKSPACE_UNAVAILABLE' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
