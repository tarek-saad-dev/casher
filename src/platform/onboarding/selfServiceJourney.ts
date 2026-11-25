import type { GoLiveMilestoneId, TenantGoLiveReport } from './goLiveTypes';

/**
 * Read-only, tenant-derived setup navigation. No client-local "completed" flags:
 * when the owner returns from an admin setup screen, progress follows the DB.
 * First sale and first public booking are intentionally not setup prerequisites.
 */
export const SELF_SERVICE_STEP_IDS = ['welcome', 'branch', 'services', 'team', 'launch', 'finish'] as const;
export type SelfServiceStepId = (typeof SELF_SERVICE_STEP_IDS)[number];

export function isSelfServiceStepId(value: string): value is SelfServiceStepId {
  return (SELF_SERVICE_STEP_IDS as readonly string[]).includes(value);
}

export type SelfServiceStep = {
  id: SelfServiceStepId;
  href: string;
  label: string;
  title: string;
  description: string;
  complete: boolean;
  count: number | null;
};

const REQUIRED: readonly GoLiveMilestoneId[] = [
  'active_branch', 'catalog', 'team', 'business_day', 'first_shift',
];

export function buildSelfServiceJourney(report: TenantGoLiveReport) {
  const evidence = new Map(report.milestones.map((item) => [item.id, item]));
  const done = (id: GoLiveMilestoneId) => evidence.get(id)?.status === 'done';
  const count = (id: GoLiveMilestoneId) => evidence.get(id)?.count ?? null;
  const ready = REQUIRED.every(done) && done('commercial_access') && done('users');

  const steps: SelfServiceStep[] = [
    {
      id: 'welcome', href: '/setup', label: 'أهلاً بيك', title: 'بيزنسك جاهز يبدأ رحلته',
      description: 'هنرتب معاك أهم الإعدادات واحدة واحدة، وتقدر تكمل في أي وقت.',
      complete: true, count: null,
    },
    {
      id: 'branch', href: '/setup/branch', label: 'الفرع', title: 'ظبط بيانات أول فرع',
      description: 'راجع عنوان المحل، رقم التواصل، وساعات الشغل قبل استقبال العملاء.',
      complete: done('active_branch'), count: count('active_branch'),
    },
    {
      id: 'services', href: '/setup/services', label: 'الخدمات', title: 'إيه الخدمات اللي بتقدمها؟',
      description: 'سجل خدماتك وأسعارها ومدتها من شاشة إدارة الخدمات.',
      complete: done('catalog'), count: count('catalog'),
    },
    {
      id: 'team', href: '/setup/team', label: 'فريقك', title: 'ضيف أول فرد في فريقك',
      description: 'حدد بيانات الحلاقين وأدوارهم وربطهم بالفرع ومواعيدهم.',
      complete: done('team'), count: count('team'),
    },
    {
      id: 'launch', href: '/setup/launch', label: 'التشغيل', title: 'جهّز أول يوم شغل',
      description: 'راجع فتح يوم التشغيل والوردية، وجرب سير العمل قبل أول عميل.',
      complete: done('business_day') && done('first_shift'),
      count: null,
    },
    {
      id: 'finish', href: '/setup/finish', label: 'الانطلاق', title: ready ? 'أنت جاهز للتشغيل الداخلي' : 'راجع آخر خطوات التجهيز',
      description: ready
        ? 'الإعدادات الأساسية موجودة. راجعها ثم ابدأ التشغيل الفعلي.'
        : 'تقدر تدخل النظام الآن وتكمل أي خطوة ناقصة لاحقاً.',
      complete: ready, count: null,
    },
  ];

  const completeCount = steps.slice(1, 5).filter((item) => item.complete).length;
  return {
    steps,
    ready,
    completeCount,
    totalCount: 4,
    progressPercent: Math.round((completeCount / 4) * 100),
    pendingMilestones: REQUIRED.filter((id) => !done(id)),
    branchName: report.primaryBranch?.branchName || 'الفرع الرئيسي',
    tenantName: report.tenantName,
    ownerLoginName: report.ownerLoginName,
    bookingInstalled: report.bookingInstalled,
  };
}
