import { APP_REGISTRY_CODES, type AppRegistryCode } from '@/platform/registry/constants';
import type {
  TenantWorkspaceSnapshot,
  WorkspaceAppSummary,
  WorkspaceAppStatus,
} from './workspaceReadiness';

/**
 * App owners provide bounded, tenant-specific readiness checks at the composition
 * root. The Core is not allowed to import Booking, POS, Clinics or other app internals.
 * These values are informational only. They never authorize app access or modify setup.
 */
export type WorkspaceCheckState = 'pass' | 'fail' | 'unknown';
export type WorkspaceUsageEvidence = 'observed' | 'not_observed' | 'unknown';

export interface WorkspaceReadinessCheck {
  key: string;
  state: WorkspaceCheckState;
  detail: string;
  action?: string | null;
  actionHref?: string | null;
}

export interface WorkspaceAppReadinessSignal {
  tenantId: string;
  appCode: AppRegistryCode;
  checks: readonly WorkspaceReadinessCheck[];
  usage: WorkspaceUsageEvidence;
}

export interface WorkspaceReadinessProvider {
  appCode: AppRegistryCode;
  /** Must use only the Core-resolved tenantId, not browser parameters. */
  check(tenantId: string): Promise<WorkspaceAppReadinessSignal | null>;
}

const KNOWN = new Set<string>(APP_REGISTRY_CODES);

function safeInternalHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.includes('\\') ||
    /[\r\n\t]/.test(href)) return null;
  return href;
}

function unavailable(item: WorkspaceAppSummary): WorkspaceAppSummary {
  return {
    ...item,
    status: 'installed_unverified',
    description: 'التطبيق مثبت، لكن فحص جاهزيته غير متاح أو لم يكتمل.',
    nextAction: null,
    actionHref: null,
  };
}

function applySignal(
  item: WorkspaceAppSummary,
  signal: WorkspaceAppReadinessSignal,
  tenantId: string,
): WorkspaceAppSummary {
  if (signal.tenantId.toLowerCase() !== tenantId.toLowerCase() ||
    signal.appCode !== item.code ||
    !Array.isArray(signal.checks) ||
    signal.checks.length === 0 ||
    !['observed', 'not_observed', 'unknown'].includes(signal.usage)) {
    return unavailable(item);
  }

  const seen = new Set<string>();
  for (const check of signal.checks) {
    if (!check || typeof check.key !== 'string' || !check.key.trim() ||
      seen.has(check.key) ||
      !['pass', 'fail', 'unknown'].includes(check.state) ||
      typeof check.detail !== 'string' || !check.detail.trim()) {
      return unavailable(item);
    }
    seen.add(check.key);
  }

  const failed = signal.checks.find((check) => check.state === 'fail');
  if (failed) {
    return {
      ...item,
      status: 'needs_setup',
      description: failed.detail,
      nextAction: failed.action ?? null,
      actionHref: safeInternalHref(failed.actionHref),
    };
  }
  if (signal.checks.some((check) => check.state === 'unknown')) {
    return unavailable(item);
  }

  const status: WorkspaceAppStatus = signal.usage === 'observed' ? 'in_use' : 'basics_present';
  return {
    ...item,
    status,
    description: status === 'in_use'
      ? 'تم توثيق تشغيل لهذا التطبيق. ده مش بديل عن اختبار كل وظائفه.'
      : 'فحوصات الإعداد المعلنة من التطبيق نجحت، لكن التشغيل الكامل مش مضمون.',
    nextAction: null,
    actionHref: null,
  };
}

/**
 * Overlay trusted module signals onto the existing Workspace projection.
 * If no provider exists for an app, preserve the existing V1 signal/baseline.
 * An invalid, mismatched, empty or duplicated signal cannot produce a green
 * status. Uninstalled apps are never overridable.
 */
export function applyWorkspaceReadinessSignals(
  baseline: TenantWorkspaceSnapshot,
  tenantId: string,
  signals: readonly WorkspaceAppReadinessSignal[],
): TenantWorkspaceSnapshot {
  const groups = new Map<string, WorkspaceAppReadinessSignal[]>();
  for (const signal of signals) {
    if (!signal || !KNOWN.has(signal.appCode)) continue;
    const group = groups.get(signal.appCode) ?? [];
    group.push(signal);
    groups.set(signal.appCode, group);
  }

  const apps = baseline.apps.map((item) => {
    if (item.status === 'not_installed') return item;
    const matched = groups.get(item.code);
    if (!matched) return item;
    if (matched.length !== 1) return unavailable(item);
    return applySignal(item, matched[0], tenantId);
  });

  return {
    ...baseline,
    needsSetupCount: apps.filter((a) => a.status === 'needs_setup').length,
    installedCount: apps.filter((a) => a.status !== 'not_installed').length,
    apps,
  };
}
