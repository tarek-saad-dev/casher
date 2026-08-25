'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Loader2, Save } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  fetchSwitchableBranches,
  performBranchSwitch,
} from '@/lib/branch/postSwitchClient';
import type { SerializedBranch } from '@/lib/branch/serializeBranch';
import { useSession } from '@/hooks/useSession';

const LIFECYCLE_LABEL: Record<string, string> = {
  SETUP: 'إعداد',
  SMOKE_TEST: 'اختبار دخان',
  INTERNAL_LIVE: 'تشغيل داخلي',
  PUBLIC_LIVE: 'تشغيل عام',
  SUSPENDED: 'موقوف',
};

function toInputTime(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 5);
}

export default function AdminBranchDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const branchId = Number(params.id);

  const [branch, setBranch] = useState<SerializedBranch | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    address: '',
    phone: '',
    timeZone: 'Africa/Cairo',
    defaultOpenTime: '',
    defaultCloseTime: '',
    businessDayCutoffTime: '',
  });

  const applyBranch = useCallback((b: SerializedBranch) => {
    setBranch(b);
    setForm({
      address: b.address ?? '',
      phone: b.phone ?? '',
      timeZone: b.timeZone || 'Africa/Cairo',
      defaultOpenTime: toInputTime(b.defaultOpenTime),
      defaultCloseTime: toInputTime(b.defaultCloseTime),
      businessDayCutoffTime: toInputTime(b.businessDayCutoffTime),
    });
  }, []);

  const load = useCallback(async () => {
    if (!Number.isFinite(branchId) || branchId <= 0) {
      setError('معرف فرع غير صالح');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [detailRes, switchRes] = await Promise.all([
        fetch(`/api/admin/branches/${branchId}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        }),
        fetchSwitchableBranches(),
      ]);
      const data = await detailRes.json();
      if (!detailRes.ok || !data.ok) {
        setError(data.error || 'فشل تحميل الفرع');
        setBranch(null);
        return;
      }
      applyBranch(data.branch as SerializedBranch);
      setActiveBranchId(
        typeof data.activeBranchId === 'number'
          ? data.activeBranchId
          : switchRes.activeBranch?.branchId ?? null,
      );
      setCanSwitch(
        switchRes.ok &&
          switchRes.branches.some((b) => b.branchId === branchId && !b.isCurrent),
      );
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [applyBranch, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          timeZone: form.timeZone.trim() || 'Africa/Cairo',
          defaultOpenTime: form.defaultOpenTime || null,
          defaultCloseTime: form.defaultCloseTime || null,
          businessDayCutoffTime: form.businessDayCutoffTime || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل الحفظ');
        return;
      }
      applyBranch(data.branch as SerializedBranch);
      setSavedMsg(data.message || 'تم الحفظ');
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  async function onSwitch() {
    if (switching) return;
    setSwitching(true);
    setError(null);
    const result = await performBranchSwitch({
      branchId,
      currentPathname: pathname,
      onSoftSwitch: async () => {
        await session.refresh();
        router.refresh();
        await load();
      },
    });
    if (!result.ok) {
      setSwitching(false);
      if (result.error !== 'CANCELLED') {
        setError(result.message);
      }
      return;
    }
    if (result.navigation === 'soft') {
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground" dir="rtl">
        <Loader2 className="h-5 w-5 animate-spin" />
        جاري التحميل…
      </div>
    );
  }

  if (!branch) {
    return (
      <div className="mx-auto max-w-3xl" dir="rtl">
        <p className="text-destructive">{error || 'الفرع غير موجود'}</p>
        <Link
          href="/admin/branches"
          className={cn(buttonVariants({ variant: 'outline' }), 'mt-4 inline-flex')}
        >
          العودة للفروع
        </Link>
      </div>
    );
  }

  const isCurrent = activeBranchId === branch.branchId;

  return (
    <div className="mx-auto max-w-3xl" dir="rtl">
      <div className="mb-4">
        <Link
          href="/admin/branches"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" />
          كل الفروع
        </Link>
      </div>

      <PageHeader
        title={branch.shortName || branch.branchName}
        description={`${branch.branchName} · ${branch.branchCode}`}
      >
        <div className="flex flex-wrap gap-2">
          {isCurrent ? (
            <Badge>الفرع النشط في الجلسة</Badge>
          ) : canSwitch ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={switching}
              onClick={() => void onSwitch()}
            >
              {switching ? <Loader2 className="ml-1.5 h-4 w-4 animate-spin" /> : null}
              تبديل الجلسة لهذا الفرع
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="secondary">
          {LIFECYCLE_LABEL[branch.lifecycleStatus] ?? branch.lifecycleStatus}
        </Badge>
        <Badge variant="outline">{branch.isActive ? 'نشط تشغيلياً' : 'غير نشط'}</Badge>
        <Badge variant="outline">
          حجز عام: {branch.publicBookingEnabled ? 'مفعّل' : 'مغلق'}
        </Badge>
        <Badge variant="outline">
          إشعارات خارجية: {branch.externalNotificationsEnabled ? 'مفعّلة' : 'مغلقة'}
        </Badge>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {savedMsg && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
          {savedMsg}
        </div>
      )}

      <form onSubmit={onSave} className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">بيانات الاتصال وساعات العمل</h3>
        <p className="text-xs text-muted-foreground">
          لا يغيّر هذا النموذج حالة الدورة التشغيلية أو الحجز العام — استخدم الجاهزية ومعالج الإعداد لذلك.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="address">العنوان</Label>
            <Input
              id="address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">الهاتف</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              dir="ltr"
              className="text-left"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tz">المنطقة الزمنية</Label>
            <Input
              id="tz"
              value={form.timeZone}
              onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))}
              dir="ltr"
              className="text-left"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="open">فتح</Label>
            <Input
              id="open"
              type="time"
              value={form.defaultOpenTime}
              onChange={(e) => setForm((f) => ({ ...f, defaultOpenTime: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="close">إغلاق</Label>
            <Input
              id="close"
              type="time"
              value={form.defaultCloseTime}
              onChange={(e) => setForm((f) => ({ ...f, defaultCloseTime: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cutoff">قطع يوم العمل</Label>
            <Input
              id="cutoff"
              type="time"
              value={form.businessDayCutoffTime}
              onChange={(e) =>
                setForm((f) => ({ ...f, businessDayCutoffTime: e.target.value }))
              }
            />
          </div>
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="ml-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="ml-1.5 h-4 w-4" />
          )}
          حفظ التعديلات
        </Button>
      </form>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Link
          href={`/admin/branches/${branch.branchId}/setup`}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          معالج الإعداد
        </Link>
        <Link
          href={`/admin/branches/${branch.branchId}/readiness`}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          الجاهزية والتحويل
        </Link>
        <Link
          href={`/admin/branches/${branch.branchId}/setup/employees`}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          الموظفون والتعيينات
        </Link>
        <Link
          href={`/admin/branches/${branch.branchId}/setup/opening-inventory`}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          المخزون الافتتاحي
        </Link>
      </div>
    </div>
  );
}
