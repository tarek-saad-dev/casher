import 'server-only';
import { createSalonWorkspaceReadinessProviders } from '@/packs/salon/workspaceReadinessProviders';
import type { WorkspaceReadinessProvider } from '@/platform/tenant/workspaceReadinessSignals';

/**
 * Trusted application composition root for Workspace readiness.
 * Core never imports Salon/POS/Booking internals; this route-local composer does.
 */
export function composeWorkspaceReadinessProviders(): readonly WorkspaceReadinessProvider[] {
  return [...createSalonWorkspaceReadinessProviders()];
}
