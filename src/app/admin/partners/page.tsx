'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Loader2,
  RefreshCw,
  Save,
  AlertTriangle,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';

type BranchOption = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isActive: boolean;
  lifecycleStatus: string;
};

type PartnerRow = {
  userId: number;
  userName: string;
  loginName: string;
  isDeleted: boolean;
  defaultBranchId: number | null;
  defaultBranchCode: string | null;
  defaultBranchName: string | null;
  canViewReports: boolean;
  branches: Array<{
    branchId: number;
    branchCode: string;
    branchName: string;
    isDefault: boolean;
    canViewReports: boolean;
    isActive: boolean;
  }>;
};

export default function AdminPartnersPage() {
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [draft, setDraft] = useState<Record<number, number | ''>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/partners');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل الشركاء');
      setPartners(data.partners ?? []);
      setBranches(data.branches ?? []);
      const next: Record<number, number | ''> = {};
      for (const p of data.partners as PartnerRow[]) {
        next[p.userId] = p.defaultBranchId ?? '';
      }
      setDraft(next);
    } catch (e: unknown) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'خطأ' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (userId: number) => {
    const branchId = draft[userId];
    if (branchId === '' || branchId == null) {
      setMsg({ type: 'err', text: 'اختر فرعًا قبل الحفظ' });
      return;
    }
    setSavingId(userId);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/partners/${userId}/branch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ فرع الشريك');
      setMsg({
        type: 'ok',
        text: `تم ربط الشريك بفرع ${data.branchName} (${data.branchCode})`,
      });
      await load();
    } catch (e: unknown) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'خطأ' });
    } finally {
      setSavingId(null);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="إدارة الشركاء"
        description="تحديد الفرع الافتراضي لكل حساب شريك — يحدد تسجيل الدخول وتقرير الشركاء"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          الشريك يرى تقرير الفرع الافتراضي فقط. غيّر الفرع من هنا ثم احفظ.
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/reports/partners"
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            تقرير الشركاء
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-2 text-zinc-400 hover:text-zinc-200"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            msg.type === 'ok'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {partners.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-5 py-10 text-center text-sm text-zinc-500">
          لا يوجد مستخدمون بدور شريك. عيّن الدور من{' '}
          <Link href="/admin/permissions/users" className="text-amber-400 underline">
            صلاحيات المستخدمين
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-3">
          {partners.map((p) => {
            const selected = draft[p.userId];
            const dirty = (selected || null) !== (p.defaultBranchId ?? null) && selected !== '';
            const missingDefault = p.defaultBranchId == null;

            return (
              <div
                key={p.userId}
                className={`rounded-2xl border bg-zinc-900/50 px-5 py-4 ${
                  p.isDeleted
                    ? 'border-zinc-800/40 opacity-50'
                    : missingDefault
                      ? 'border-amber-500/30'
                      : 'border-zinc-800/60'
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{p.userName}</span>
                      <span className="text-xs text-zinc-500">({p.loginName})</span>
                      {missingDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          بدون فرع افتراضي
                        </span>
                      )}
                    </div>
                    {p.defaultBranchName ? (
                      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <Building2 className="h-3.5 w-3.5" />
                        الحالي: {p.defaultBranchName}
                        {p.defaultBranchCode ? ` (${p.defaultBranchCode})` : ''}
                        {!p.canViewReports ? ' — بدون صلاحية تقارير' : ''}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-400/90">لم يُربط بفرع بعد</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={selected === '' ? '' : String(selected)}
                      disabled={p.isDeleted || savingId === p.userId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((prev) => ({
                          ...prev,
                          [p.userId]: v === '' ? '' : Number(v),
                        }));
                      }}
                      className="min-w-[220px] rounded-xl border border-zinc-700/70 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500/40"
                    >
                      <option value="">اختر الفرع…</option>
                      {branches.map((b) => (
                        <option key={b.branchId} value={b.branchId}>
                          {b.branchName} ({b.branchCode})
                          {!b.isActive ? ' — غير نشط' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={p.isDeleted || savingId === p.userId || !dirty}
                      onClick={() => void save(p.userId)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-40"
                    >
                      {savingId === p.userId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      حفظ
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
