import 'server-only';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { APP_REGISTRY_CODES } from '@/platform/registry/constants';
import type { TenantWorkspaceSnapshot } from './workspaceReadiness';
import {
  applyWorkspaceReadinessSignals,
  type WorkspaceAppReadinessSignal,
  type WorkspaceReadinessProvider,
} from './workspaceReadinessSignals';

const KNOWN = new Set<string>(APP_REGISTRY_CODES);

function unavailable(
  tenantId: string,
  appCode: WorkspaceReadinessProvider['appCode'],
): WorkspaceAppReadinessSignal {
  return {
    tenantId,
    appCode,
    checks: [{ key: 'readiness_unavailable', state: 'unknown', detail: 'تعذر التحقق من جاهزية التطبيق.' }],
    usage: 'unknown',
  };
}

/**
 * Composition-root helper. A module may register its own provider but Core
 * imports only the contract; failures are isolated per app and never authorize
 * application access. The tenant must originate from a verified Core context.
 *
 * No provider for an installed app => preserve the existing Workspace V1
 * projection. Registered provider failing/invalid => explicit unverified.
 */
export async function enrichTenantWorkspaceWithProviders(
  baseline: TenantWorkspaceSnapshot,
  tenantId: string,
  providers: readonly WorkspaceReadinessProvider[],
): Promise<TenantWorkspaceSnapshot> {
  const tid = requireMasterDataTenantId(tenantId, 'workspace readiness providers');
  const installed = new Set(baseline.apps.filter((a) => a.status !== 'not_installed').map((a) => a.code));
  const eligible = providers.filter((provider) =>
    provider && KNOWN.has(provider.appCode) && installed.has(provider.appCode),
  );

  const signals = await Promise.all(eligible.map(async (provider): Promise<WorkspaceAppReadinessSignal> => {
    try {
      const result = await provider.check(tid);
      if (!result || result.appCode !== provider.appCode || result.tenantId.toLowerCase() !== tid) {
        return unavailable(tid, provider.appCode);
      }
      return result;
    } catch {
      // Never expose provider internals or accidentally fall back to "ready".
      return unavailable(tid, provider.appCode);
    }
  }));

  return applyWorkspaceReadinessSignals(baseline, tid, signals);
}
