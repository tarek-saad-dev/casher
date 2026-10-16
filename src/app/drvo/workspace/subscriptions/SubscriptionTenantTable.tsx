'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

type Action = 'provision' | 'suspend' | 'renew' | 'cancel';
type ModuleRow = { key: string; title: string; status: string | null; validUntilUtc: string | null };
type Props = { tenantId: string; tenantName: string; tenantCode: string; modules: ModuleRow[]; canManage: boolean };
const labels: Record<Action, string> = { provision: 'تفعيل', suspend: 'إيقاف مؤقت', renew: 'تجديد', cancel: 'إلغاء' };

function availableActions(status: string | null): Action[] {
  if (!status || status === 'disabled') return ['provision'];
  if (status === 'suspended') return ['provision', 'renew', 'cancel'];
  return ['suspend', 'renew', 'cancel'];
}

export default function SubscriptionTenantTable({ tenantId, tenantName, tenantCode, modules, canManage }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ module: ModuleRow; action: Action } | null>(null);
  const [expiry, setExpiry] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);

  function open(module: ModuleRow, action: Action) {
    setSelected({ module, action });
    setExpiry('');
    setConfirmed(false);
    setMessage('');
    pending.current = null;
  }
  function close() {
    if (busy) return;
    setSelected(null);
    setMessage('');
  }
  async function submit() {
    if (!selected || !confirmed || busy) return;
    const { module, action } = selected;
    const requiresExpiry = action === 'provision' || action === 'renew';
    const expiresAt = requiresExpiry ? new Date(expiry + 'T23:59:59.000Z') : null;
    if (requiresExpiry && (!expiry || !Number.isFinite(expiresAt?.getTime()) || expiresAt!.getTime() <= Date.now())) {
      setMessage('اختار تاريخ انتهاء مستقبلي صحيح.');
      return;
    }
    const fingerprint = JSON.stringify({ tenantId, moduleKey: module.key, action, expiry: requiresExpiry ? expiry : null });
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    const body: Record<string, string> = { tenantId, moduleKey: module.key, action, requestId: pending.current.requestId };
    if (expiresAt) body.validUntilUtc = expiresAt.toISOString();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/drvo/platform/subscriptions', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-drvo-commercial-intent': '1' },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string; replayed?: boolean };
      if (!response.ok) {
        setMessage('لم يتم تنفيذ العملية: ' + (result.error ?? 'خطأ غير معروف'));
        return;
      }
      pending.current = null;
      setSelected(null);
      router.refresh();
    } catch {
      setMessage('تعذر التأكد من النتيجة. يمكن إعادة نفس الطلب دون تكرار العملية.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[650px] border-collapse text-right text-sm">
          <thead className="bg-white/[0.04] text-xs text-slate-400">
            <tr><th scope="col" className="p-3">الوحدة</th><th scope="col" className="p-3">الحالة</th><th scope="col" className="p-3">تاريخ الانتهاء</th><th scope="col" className="p-3">الإدارة</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {modules.map(module => {
              const expired = !!module.validUntilUtc && Date.parse(module.validUntilUtc) <= Date.now();
              const state = !module.status ? 'غير مشترك' : module.status === 'enabled' && expired ? 'منتهي' : module.status === 'enabled' ? 'مفعّل' : module.status === 'suspended' ? 'موقوف' : 'ملغي';
              return <tr key={module.key} className="hover:bg-white/[0.025]">
                <td className="p-3"><div className="font-semibold">{module.title}</div><div dir="ltr" className="mt-1 w-fit text-xs text-slate-500">{module.key}</div></td>
                <td className="p-3"><span className={module.status === 'enabled' && !expired ? 'text-emerald-300' : module.status === 'suspended' ? 'text-amber-300' : 'text-slate-400'}>{state}</span></td>
                <td className="p-3 text-xs text-slate-400">{module.validUntilUtc ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(module.validUntilUtc)) : '—'}</td>
                <td className="p-3">{canManage ? <div className="flex flex-wrap gap-2">{availableActions(module.status).map(action => <button key={action} type="button" onClick={() => open(module, action)} className={action === 'cancel' ? 'rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-400/10' : 'rounded-lg border border-cyan-400/25 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-400/10'}>{labels[action]}</button>)}</div> : <span className="text-xs text-slate-500">قراءة فقط</span>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="subscription-dialog-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#111d30] p-6 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h3 id="subscription-dialog-title" className="text-lg font-bold">{labels[selected.action]} اشتراك {selected.module.title}</h3>
              <button type="button" aria-label="إغلاق" onClick={close} disabled={busy} className="rounded-lg p-2 hover:bg-white/10"><X className="size-5" /></button>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-400">الشركة: <strong className="text-slate-100">{tenantName}</strong> ({tenantCode})</p>
            <p className="text-xs text-slate-400">الوحدة: {selected.module.key}</p>
            {(selected.action === 'provision' || selected.action === 'renew') && <label className="mt-5 block text-sm">تاريخ الانتهاء (UTC)
              <input type="date" value={expiry} onChange={event => { setExpiry(event.target.value); setConfirmed(false); }} disabled={busy} className="mt-2 block w-full rounded-lg border border-white/20 bg-[#0a1424] p-3 text-slate-100" />
            </label>}
            <label className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 p-3 text-sm leading-6">
              <input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
              <span>أؤكد تنفيذ «{labels[selected.action]}» على وحدة {selected.module.title} للشركة {tenantName}.</span>
            </label>
            {message && <p role="alert" className="mt-3 text-sm text-amber-200">{message}</p>}
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={close} disabled={busy} className="flex-1 rounded-lg border border-white/20 p-3 text-sm">رجوع</button>
              <button type="button" onClick={submit} disabled={busy || !confirmed} className="flex-1 rounded-lg bg-cyan-300 p-3 text-sm font-bold text-slate-950 disabled:opacity-40">{busy ? 'جارٍ التنفيذ…' : 'تأكيد العملية'}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
