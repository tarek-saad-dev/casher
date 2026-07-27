'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2, ArrowLeft, ExternalLink,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ReadinessItem = {
  key: string;
  section: string;
  title: string;
  status: 'pass' | 'warning' | 'blocker';
  requiredFor: string[];
  details: string;
  remediationUrl?: string;
};

type ReadinessPayload = {
  score: number;
  isReadyForInternalLive: boolean;
  isReadyForPublicLive: boolean;
  lifecycleStatus?: string;
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
  sections: Array<{ section: string; items: ReadinessItem[] }>;
};

type WizardSection = {
  id: string;
  title: string;
  description: string;
  href: string | null;
  readinessKeys: string[];
};

const SECTIONS: WizardSection[] = [
  {
    id: 'identity',
    title: 'الهوية الأساسية',
    description: 'اسم الفرع والرمز والعرض الإنجليزي',
    href: null,
    readinessKeys: ['identity.code', 'identity.name', 'identity.timezone', 'identity.address'],
  },
  {
    id: 'contact',
    title: 'العنوان وبيانات التواصل',
    description: 'العنوان والهاتف',
    href: null,
    readinessKeys: ['biz.address', 'biz.contact'],
  },
  {
    id: 'hours',
    title: 'مواعيد التشغيل',
    description: 'ساعات العمل وقطع يوم العمل',
    href: null,
    readinessKeys: ['biz.operating_hours'],
  },
  {
    id: 'services',
    title: 'الخدمات والأسعار',
    description: 'كتالوج CUT العالمي — نفس الأسعار',
    href: '/admin/services',
    readinessKeys: [],
  },
  {
    id: 'users',
    title: 'المستخدمون والصلاحيات',
    description: 'مراجعة صلاحيات التشغيل والتقارير',
    href: null,
    readinessKeys: ['users.access_review'],
  },
  {
    id: 'employees',
    title: 'الموظفون',
    description: 'تعيينات حقيقية وجداول أسبوعية',
    href: 'employees',
    readinessKeys: ['biz.real_employees', 'legacy.ELIGIBLE_BARBER'],
  },
  {
    id: 'payroll',
    title: 'الرواتب والتارجت',
    description: 'خطة راتب + تارجت أو NO_TARGET لكل معيّن',
    href: 'payroll-targets',
    readinessKeys: ['payroll.plan_coverage', 'target.policy_coverage'],
  },
  {
    id: 'treasury',
    title: 'الخزنة وطرق الدفع',
    description: 'قرار الرصيد الافتتاحي + طرق الدفع',
    href: 'opening-cash',
    readinessKeys: ['biz.opening_cash'],
  },
  {
    id: 'inventory',
    title: 'المخزون الافتتاحي',
    description: 'صفر / شراء / نقل من جليم',
    href: 'opening-inventory',
    readinessKeys: ['biz.opening_inventory'],
  },
  {
    id: 'partners',
    title: 'نسب الشركاء',
    description: '40/20/20/20 بتاريخ بدء التشغيل',
    href: 'partners',
    readinessKeys: ['biz.partner_shares', 'biz.partner_shares_effective_date'],
  },
  {
    id: 'print_wa',
    title: 'الطباعة والإشعارات',
    description: 'طابعة وواتساب مشتركان — هوية كامب شيزار',
    href: null,
    readinessKeys: ['printer.shared_policy', 'whatsapp.shared_policy'],
  },
  {
    id: 'smoke',
    title: 'الاختبار النهائي',
    description: 'Smoke تشغيلي + إثبات Phase 1R + تنظيف',
    href: 'readiness',
    readinessKeys: [
      'internal.passed_smoke_run',
      'proof.pos.cashInvoice',
      'proof.pos.cardInvoice',
      'proof.gleem.isolation',
    ],
  },
  {
    id: 'review',
    title: 'المراجعة والجاهزية',
    description: 'مراجعة نهائية قبل التشغيل الداخلي',
    href: 'activate',
    readinessKeys: [],
  },
];

function statusOfSection(
  section: WizardSection,
  itemsByKey: Map<string, ReadinessItem>,
): 'مكتمل' | 'ناقص' | 'يحتاج قرار' | 'يحتاج اختبار' {
  const relevant = section.readinessKeys
    .map((k) => itemsByKey.get(k))
    .filter(Boolean) as ReadinessItem[];
  if (section.id === 'smoke') {
    if (relevant.some((i) => i.status === 'blocker')) return 'يحتاج اختبار';
    return 'مكتمل';
  }
  if (relevant.length === 0) {
    if (section.id === 'services' || section.id === 'review') return 'مكتمل';
    return 'مكتمل';
  }
  if (relevant.some((i) => i.status === 'blocker')) {
    if (
      section.id === 'treasury' ||
      section.id === 'inventory' ||
      section.id === 'partners' ||
      section.id === 'employees' ||
      section.id === 'payroll'
    ) {
      return 'يحتاج قرار';
    }
    return 'ناقص';
  }
  if (relevant.some((i) => i.status === 'warning')) return 'ناقص';
  return 'مكتمل';
}

const statusStyle: Record<string, string> = {
  مكتمل: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ناقص: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'يحتاج قرار': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  'يحتاج اختبار': 'bg-amber-500/15 text-amber-200 border-amber-500/40',
};

export default function BranchSetupWizardPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('فرع كامب شيزار');
  const [lifecycle, setLifecycle] = useState('SETUP');
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, rRes] = await Promise.all([
        fetch(`/api/admin/branches/${branchId}`),
        fetch(`/api/admin/branches/${branchId}/readiness`),
      ]);
      const bData = await bRes.json();
      const rData = await rRes.json();
      if (!bRes.ok) throw new Error(bData.error || 'فشل تحميل الفرع');
      if (!rRes.ok) throw new Error(rData.error || 'فشل تحميل الجاهزية');
      const branch = bData.branch ?? bData;
      setBranchName(branch.BranchName || branch.branchName || 'فرع كامب شيزار');
      setLifecycle(branch.LifecycleStatus || branch.lifecycleStatus || 'SETUP');
      setReadiness(rData.readiness ?? rData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemsByKey = useMemo(() => {
    const map = new Map<string, ReadinessItem>();
    if (!readiness) return map;
    for (const s of readiness.sections ?? []) {
      for (const i of s.items) map.set(i.key, i);
    }
    for (const i of readiness.blockers ?? []) map.set(i.key, i);
    for (const i of readiness.warnings ?? []) map.set(i.key, i);
    return map;
  }, [readiness]);

  const internalBlockers = (readiness?.blockers ?? []).filter((b) =>
    b.requiredFor?.includes('internal_live'),
  );
  const isInternalLive = lifecycle === 'INTERNAL_LIVE' || lifecycle === 'PUBLIC_LIVE';

  const sectionHref = (s: WizardSection) => {
    if (!s.href) {
      if (s.id === 'identity' || s.id === 'contact' || s.id === 'hours') {
        return `/admin/branches/${branchId}`;
      }
      if (s.id === 'users' || s.id === 'print_wa') {
        return `/admin/branches/${branchId}/readiness`;
      }
      return null;
    }
    if (s.href.startsWith('/')) return s.href;
    if (s.href === 'readiness' || s.href === 'activate') {
      return `/admin/branches/${branchId}/${s.href}`;
    }
    return `/admin/branches/${branchId}/setup/${s.href}`;
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6" dir="rtl">
      <div className="mb-4">
        <Link
          href="/admin/branches"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          قائمة الفروع
        </Link>
      </div>

      <PageHeader
        title={`إعداد ${branchName}`}
        description="جهّز بيانات التشغيل ثم راجع الجاهزية قبل فتح الفرع"
      />

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          جاري تحميل الجاهزية من الخادم…
        </div>
      ) : error ? (
        <div className="mt-6 rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-rose-200">
          {error}
          <Button className="mt-3" variant="outline" onClick={() => void load()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-card/80 p-4">
              <p className="text-xs text-muted-foreground">حالة الفرع</p>
              <p className="mt-1 text-lg font-bold">
                {isInternalLive ? 'يعمل داخليًا' : 'قيد الإعداد'}
              </p>
              <p className="text-xs text-muted-foreground">{lifecycle}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/80 p-4">
              <p className="text-xs text-muted-foreground">الجاهزية للتشغيل الداخلي</p>
              <p className="mt-1 text-lg font-bold">{readiness?.score ?? 0}%</p>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4">
              <p className="text-xs text-rose-300/80">عدد الموانع</p>
              <p className="mt-1 text-lg font-bold text-rose-300">{internalBlockers.length}</p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
              <p className="text-xs text-amber-300/80">عدد التنبيهات</p>
              <p className="mt-1 text-lg font-bold text-amber-300">
                {readiness?.warnings?.length ?? 0}
              </p>
            </div>
          </div>

          {isInternalLive && (
            <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-4 text-sm text-emerald-200">
              الفرع يعمل داخليًا · الحجز العام غير مفعّل
            </div>
          )}

          <div className="mt-6 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${Math.min(100, readiness?.score ?? 0)}%` }}
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {SECTIONS.map((section) => {
              const st = statusOfSection(section, itemsByKey);
              const href = sectionHref(section);
              const blockers = section.readinessKeys
                .map((k) => itemsByKey.get(k))
                .filter((i) => i && i.status === 'blocker') as ReadinessItem[];
              return (
                <div
                  key={section.id}
                  className="flex flex-col rounded-xl border border-border/70 bg-card/70 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-foreground">{section.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-lg border px-2 py-0.5 text-[11px] font-medium',
                        statusStyle[st],
                      )}
                    >
                      {st}
                    </span>
                  </div>
                  {blockers.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs text-rose-300/90">
                      {blockers.slice(0, 3).map((b) => (
                        <li key={b.key} className="flex gap-1">
                          <XCircle className="mt-0.5 size-3 shrink-0" />
                          <span>{b.title}: {b.details}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto flex gap-2 pt-4">
                    {href ? (
                      <Link
                        href={href}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                      >
                        متابعة
                        <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">يُدار من تفاصيل الفرع</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={`/admin/branches/${branchId}/readiness`}
              className="rounded-xl border border-border px-4 py-2 text-sm"
            >
              صفحة الجاهزية التفصيلية
            </Link>
            <Link
              href={`/admin/branches/${branchId}/activate`}
              className={cn(
                'rounded-xl px-4 py-2 text-sm font-semibold',
                readiness?.isReadyForInternalLive
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-zinc-800 text-zinc-400',
              )}
            >
              {isInternalLive ? 'إدارة التشغيل الداخلي' : 'المراجعة والتشغيل الداخلي'}
            </Link>
            <Button variant="outline" onClick={() => void load()}>
              تحديث الجاهزية
            </Button>
          </div>

          {!readiness?.isReadyForInternalLive && (
            <p className="mt-4 flex items-start gap-2 text-sm text-amber-200/90">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              التشغيل الداخلي معطّل حتى تُصفَّر الموانع من الخادم عبر{' '}
              <code className="text-xs">evaluateBranchReadiness</code>. الحجز العام يبقى مغلقًا.
            </p>
          )}
          {readiness?.isReadyForInternalLive && (
            <p className="mt-4 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="size-4" />
              جاهز للتشغيل الداخلي — افتح صفحة التفعيل للمراجعة النهائية.
            </p>
          )}
        </>
      )}
    </div>
  );
}
