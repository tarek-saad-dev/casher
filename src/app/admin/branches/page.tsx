'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  fetchSwitchableBranches,
  performBranchSwitch,
  type ClientSwitchableBranch,
} from '@/lib/branch/postSwitchClient';
import type { SerializedBranch } from '@/lib/branch/serializeBranch';

const LIFECYCLE_LABEL: Record<string, string> = {
  SETUP: 'إعداد',
  SMOKE_TEST: 'اختبار دخان',
  INTERNAL_LIVE: 'تشغيل داخلي',
  PUBLIC_LIVE: 'تشغيل عام',
  SUSPENDED: 'موقوف',
};

function timeShort(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 5);
}

export default function AdminBranchesPage() {
  const pathname = usePathname();
  const [branches, setBranches] = useState<SerializedBranch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [switchable, setSwitchable] = useState<ClientSwitchableBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, switchRes] = await Promise.all([
        fetch('/api/admin/branches', { cache: 'no-store', credentials: 'same-origin' }),
        fetchSwitchableBranches(),
      ]);
      const listData = await listRes.json();
      if (!listRes.ok || !listData.ok) {
        setError(listData.error || 'فشل تحميل الفروع');
        setBranches([]);
        return;
      }
      setBranches(Array.isArray(listData.branches) ? listData.branches : []);
      setActiveBranchId(
        typeof listData.activeBranchId === 'number' ? listData.activeBranchId : null,
      );
      setSwitchable(switchRes.ok ? switchRes.branches : []);
      if (switchRes.activeBranch?.branchId != null) {
        setActiveBranchId(switchRes.activeBranch.branchId);
      }
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canSwitchTo = (branchId: number) =>
    switchable.some((b) => b.branchId === branchId && !b.isCurrent);

  async function onSwitch(branchId: number) {
    if (switchingId != null) return;
    setSwitchingId(branchId);
    setError(null);
    const result = await performBranchSwitch({
      branchId,
      currentPathname: pathname,
    });
    if (!result.ok) {
      setSwitchingId(null);
      if (result.error !== 'CANCELLED') {
        setError(result.message);
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl" dir="rtl">
      <PageHeader
        title="الفروع"
        description="تبديل الفرع النشط في الجلسة، وعرض وتعديل بيانات الفروع وإدارة الإعداد والجاهزية"
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`ml-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Link href="/admin/branches/new" className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus className="ml-1.5 h-4 w-4" />
            فرع جديد
          </Link>
        </div>
      </PageHeader>

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && branches.length === 0 ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          جاري التحميل…
        </div>
      ) : branches.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">لا توجد فروع مسجّلة.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {branches.map((branch) => {
            const isCurrent = activeBranchId === branch.branchId;
            const switchableHere = canSwitchTo(branch.branchId);
            const busy = switchingId === branch.branchId;

            return (
              <li
                key={branch.branchId}
                className={`rounded-2xl border bg-surface px-4 py-4 sm:px-5 ${
                  isCurrent ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <h2 className="text-base font-semibold">
                        {branch.shortName || branch.branchName}
                      </h2>
                      <span className="font-mono text-xs text-muted-foreground">
                        {branch.branchCode}
                      </span>
                      {isCurrent && (
                        <Badge variant="default" className="gap-1">
                          <Check className="h-3 w-3" />
                          الفرع النشط
                        </Badge>
                      )}
                      <Badge variant="secondary">
                        {LIFECYCLE_LABEL[branch.lifecycleStatus] ?? branch.lifecycleStatus}
                      </Badge>
                      {!branch.isActive && <Badge variant="outline">غير نشط</Badge>}
                      {branch.publicBookingEnabled && (
                        <Badge variant="outline">حجز عام</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {branch.branchName}
                      {branch.address ? ` · ${branch.address}` : ''}
                      {branch.phone ? ` · ${branch.phone}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ساعات العمل: {timeShort(branch.defaultOpenTime)} –{' '}
                      {timeShort(branch.defaultCloseTime)}
                      {' · '}
                      قطع اليوم: {timeShort(branch.businessDayCutoffTime)}
                      {' · '}
                      {branch.timeZone}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0">
                    {isCurrent ? null : switchableHere ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy || switchingId != null}
                        onClick={() => void onSwitch(branch.branchId)}
                      >
                        {busy ? (
                          <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />
                        ) : null}
                        تبديل الجلسة
                      </Button>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">
                        غير متاح للتبديل
                      </span>
                    )}
                    <Link
                      href={`/admin/branches/${branch.branchId}`}
                      className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                    >
                      التفاصيل
                    </Link>
                    <Link
                      href={`/admin/branches/${branch.branchId}/setup`}
                      className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                    >
                      <Settings2 className="ml-1 h-3.5 w-3.5" />
                      الإعداد
                    </Link>
                    <Link
                      href={`/admin/branches/${branch.branchId}/readiness`}
                      className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                    >
                      <ShieldCheck className="ml-1 h-3.5 w-3.5" />
                      الجاهزية
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
