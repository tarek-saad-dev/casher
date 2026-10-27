import { APP_REGISTRY_CODES, type AppRegistryCode } from '@/platform/registry/constants';
import type { GoLiveMilestoneId, TenantGoLiveReport } from '@/platform/onboarding/goLiveTypes';

/**
 * A tenant's Workspace view is a read-only projection of existing app installation
 * and go-live evidence. It is NOT an entitlement decision or a feature readiness gate.
 * Counts in TenantGoLiveReport are tenant-wide, not proof of a usable specific slot,
 * shift, billing configuration or public booking publication.
 */
export type WorkspaceAppStatus =
  | 'not_installed'
  | 'needs_setup'
  | 'basics_present'
  | 'in_use'
  | 'installed_unverified';

export interface WorkspaceAppSummary {
  code: AppRegistryCode;
  label: string;
  status: WorkspaceAppStatus;
  description: string;
  nextAction: string | null;
  actionHref: string | null;
}

export interface TenantWorkspaceSnapshot {
  tenant: { code: string; name: string };
  installedCount: number;
  needsSetupCount: number;
  apps: WorkspaceAppSummary[];
}

const LABELS: Record<AppRegistryCode, string> = {
  booking: 'الحجوزات',
  queue: 'قائمة الانتظار',
  pos: 'الكاشير',
  inventory: 'المخزون',
  purchasing: 'المشتريات',
  attendance: 'الحضور',
  payroll: 'الرواتب',
  treasury: 'الخزنة',
  loyalty: 'الولاء',
  messaging: 'الرسائل',
  'ai-receptionist': 'المساعد الذكي',
  reports: 'التقارير',
};

type AppEvidenceRule = {
  prerequisites: readonly GoLiveMilestoneId[];
  firstUse?: GoLiveMilestoneId;
  appHref: string;
  firstAction: string;
};

/**
 * Only these apps have enough existing go-live evidence for an indicative setup
 * status. Other installed apps deliberately stay 'installed_unverified'.
 */
const EVIDENCE: Partial<Record<AppRegistryCode, AppEvidenceRule>> = {
  booking: {
    prerequisites: ['commercial_access', 'active_branch', 'catalog', 'team'],
    firstUse: 'first_booking',
    appHref: '/bookings',
    firstAction: 'سجّل أول حجز وتأكد من المواعيد والموظف قبل تفعيل الحجز العام.',
  },
  queue: {
    prerequisites: ['commercial_access', 'active_branch', 'team'],
    appHref: '/queue',
    firstAction: 'راجع إعدادات الدور وجرب استقبال أول عميل.',
  },
  pos: {
    prerequisites: ['commercial_access', 'active_branch', 'catalog', 'business_day', 'first_shift'],
    firstUse: 'first_sale',
    appHref: '/income/pos',
    firstAction: 'سجّل أول عملية بيع فعلية بعد مراجعة اليوم والوردية وطرق الدفع.',
  },
};

const SETUP_LINKS: Partial<Record<GoLiveMilestoneId, string>> = {
  active_branch: '/admin/branches',
  catalog: '/admin/services',
  team: '/admin/employees',
  users: '/admin/users',
  business_day: '/admin/day',
  first_shift: '/admin/shift',
};

/** Pure core-owned projection; never treat its statuses as authorization. */
export function buildTenantWorkspace(
  report: TenantGoLiveReport,
  installedAppCodes: readonly string[],
): TenantWorkspaceSnapshot {
  const installed = new Set(installedAppCodes);
  const milestones = new Map(report.milestones.map((step) => [step.id, step]));
  const apps: WorkspaceAppSummary[] = APP_REGISTRY_CODES.map((code) => {
    const label = LABELS[code];
    if (!installed.has(code)) {
      return {
        code,
        label,
        status: 'not_installed',
        description: 'التطبيق غير مثبت في هذه المنشأة.',
        nextAction: null,
        actionHref: null,
      };
    }

    const rule = EVIDENCE[code];
    if (!rule) {
      return {
        code,
        label,
        status: 'installed_unverified',
        description: 'التطبيق مثبت. لم يتم فحص جاهزيته التشغيلية في هذه الشاشة.',
        nextAction: null,
        actionHref: null,
      };
    }

    const missingId = rule.prerequisites.find((id) => milestones.get(id)?.status !== 'done');
    const missing = missingId ? milestones.get(missingId) : undefined;

    if (missingId) {
      return {
        code,
        label,
        status: 'needs_setup',
        description: missing?.detail ?? 'لم تكتمل معلومات الإعداد المطلوبة.',
        nextAction: missing?.action ?? 'راجع إعدادات المنشأة.',
        actionHref: missingId ? SETUP_LINKS[missingId] ?? null : null,
      };
    }

    if (rule.firstUse && milestones.get(rule.firstUse)?.status === 'done') {
      return {
        code,
        label,
        status: 'in_use',
        description: 'تم تسجيل نشاط لهذا التطبيق. لا يغني ذلك عن مراجعة إعداداته بالكامل.',
        nextAction: null,
        actionHref: rule.appHref,
      };
    }

    return {
      code,
      label,
      status: 'basics_present',
      description: 'متطلبات البداية موجودة على مستوى المنشأة، لكن التشغيل الكامل غير مؤكد.',
      nextAction: rule.firstAction,
      actionHref: rule.appHref,
    };
  });

  return {
    tenant: { code: report.tenantCode, name: report.tenantName },
    installedCount: apps.filter((a) => a.status !== 'not_installed').length,
    needsSetupCount: apps.filter((a) => a.status === 'needs_setup').length,
    apps,
  };
}

export type WorkspacePrimaryNextAction = {
  appCode: AppRegistryCode;
  appLabel: string;
  status: Exclude<WorkspaceAppStatus, 'not_installed'>;
  message: string;
  href: string | null;
};

/**
 * Single most useful next step for Workspace home.
 * Prefers needs_setup, then basics_present with a first-action hint.
 * Never invents readiness: installed_unverified apps are not promoted as "ready".
 */
export function pickPrimaryWorkspaceNextAction(
  snapshot: TenantWorkspaceSnapshot,
): WorkspacePrimaryNextAction | null {
  const installed = snapshot.apps.filter((a) => a.status !== 'not_installed');
  const needsSetup = installed.find((a) => a.status === 'needs_setup');
  if (needsSetup) {
    return {
      appCode: needsSetup.code,
      appLabel: needsSetup.label,
      status: 'needs_setup',
      message: needsSetup.nextAction ?? needsSetup.description,
      href: needsSetup.actionHref,
    };
  }
  const basics = installed.find(
    (a) => a.status === 'basics_present' && (a.nextAction || a.actionHref),
  );
  if (basics) {
    return {
      appCode: basics.code,
      appLabel: basics.label,
      status: 'basics_present',
      message: basics.nextAction ?? basics.description,
      href: basics.actionHref,
    };
  }
  return null;
}
