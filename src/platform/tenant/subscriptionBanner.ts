import type { TenantShellSnapshot } from './tenantShellTypes';

export type SubscriptionNotice = {
  tone: 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Trial banner appears only in the last days of the trial. */
export const TRIAL_BANNER_DAYS = 7;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function daysUntil(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS));
}

const BLOCKED_DETAIL: Record<string, string> = {
  TRIAL_EXPIRED: 'انتهت الفترة التجريبية.',
  PAST_DUE_GRACE_EXCEEDED: 'انتهت مهلة السداد المسموح بها.',
  SUSPENDED: 'تم إيقاف الاشتراك.',
  CANCELLED: 'تم إلغاء الاشتراك.',
  NO_SUBSCRIPTION: 'لا يوجد اشتراك لهذه المنشأة.',
  PLAN_NOT_FOUND: 'خطة الاشتراك غير متاحة.',
};

/**
 * Shell notice for the tenant subscription state; null when nothing needs saying.
 * Blocked (allowed=false) always yields a danger notice — the shell renders it full-screen.
 */
export function describeSubscriptionNotice(
  sub: TenantShellSnapshot['subscription'],
  now: Date = new Date(),
): SubscriptionNotice | null {
  if (!sub.allowed) {
    return {
      tone: 'danger',
      title: 'اشتراك المنشأة غير نشط',
      detail: `${BLOCKED_DETAIL[sub.reason] ?? 'الوصول غير متاح حالياً.'} تواصل مع مزود الخدمة لإعادة التفعيل.`,
    };
  }
  if (sub.warning === 'PAST_DUE_GRACE' || sub.reason === 'PAST_DUE_IN_GRACE') {
    return {
      tone: 'warning',
      title: 'الاشتراك متأخر السداد',
      detail: sub.accessEndsAt
        ? `الخدمة متاحة حتى ${formatDate(sub.accessEndsAt)} — يرجى السداد لتجنب الإيقاف.`
        : 'يرجى السداد لتجنب الإيقاف.',
    };
  }
  if (sub.warning === 'CANCELLED_UNTIL_PERIOD_END' || sub.reason === 'CANCELLED_UNTIL_PERIOD_END') {
    return {
      tone: 'warning',
      title: 'تم إلغاء الاشتراك',
      detail: sub.accessEndsAt
        ? `الخدمة متاحة حتى نهاية الفترة الحالية (${formatDate(sub.accessEndsAt)}).`
        : 'الخدمة متاحة حتى نهاية الفترة الحالية.',
    };
  }
  if (sub.status === 'trial' && sub.trialEndsAt) {
    const days = daysUntil(sub.trialEndsAt, now);
    if (days <= TRIAL_BANNER_DAYS) {
      return {
        tone: 'info',
        title: 'فترة تجريبية',
        detail:
          days === 0
            ? 'تنتهي الفترة التجريبية اليوم.'
            : `متبقي ${days} يوم على انتهاء الفترة التجريبية (${formatDate(sub.trialEndsAt)}).`,
      };
    }
  }
  return null;
}
