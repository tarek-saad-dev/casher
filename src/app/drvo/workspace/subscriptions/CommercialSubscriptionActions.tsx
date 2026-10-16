'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'provision' | 'suspend' | 'renew' | 'cancel';
type Props = { tenantId: string; tenantName: string; moduleKey: string; status: string | null };

export default function CommercialSubscriptionActions({ tenantId, tenantName, moduleKey, status }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<Action>(status === 'enabled' ? 'suspend' : 'provision');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const pendingRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);

  async function submit() {
    if (busy || !confirmation) return;
    if ((action === 'provision' || action === 'renew') && (!expiry || new Date(expiry).getTime() <= Date.now())) {
      setMessage('اختار تاريخ انتهاء مستقبلي صحيح.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const fingerprint = JSON.stringify({ tenantId, moduleKey, action, expiry: action === 'provision' || action === 'renew' ? expiry : null });
      if (pendingRequest.current?.fingerprint !== fingerprint) {
        pendingRequest.current = { fingerprint, requestId: crypto.randomUUID() };
      }
      const body: Record<string, string> = {
        tenantId, moduleKey, action, requestId: pendingRequest.current.requestId,
      };
      if (action === 'provision' || action === 'renew') {
        body.validUntilUtc = new Date(expiry + 'T23:59:59.000Z').toISOString();
      }
      const response = await fetch('/api/drvo/platform/subscriptions', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-drvo-commercial-intent': '1' },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string; replayed?: boolean };
      if (!response.ok) {
        setMessage('لم يتم تنفيذ العملية: ' + (result.error || 'خطأ غير معروف'));
        return;
      }
      setMessage(result.replayed ? 'الطلب تم تنفيذه مسبقًا.' : 'تم تسجيل العملية بنجاح.');
      pendingRequest.current = null;
      setConfirmation(false);
      router.refresh();
    } catch {
      setMessage('تعذر التأكد من نتيجة الطلب. راجع سجل العمليات قبل إعادة المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <label className="block text-xs text-slate-400" htmlFor={`action-${tenantId}-${moduleKey}`}>عملية الاشتراك</label>
      <select id={`action-${tenantId}-${moduleKey}`} value={action}
        onChange={event => { setAction(event.target.value as Action); setConfirmation(false); setMessage(''); }}
        disabled={busy} className="mt-1 w-full rounded-lg border border-white/15 bg-[#111e30] p-2 text-xs text-slate-100">
        <option value="provision">تفعيل / إعادة تفعيل</option>
        <option value="suspend" disabled={!status || status === 'disabled'}>إيقاف مؤقت</option>
        <option value="renew" disabled={!status || status === 'disabled'}>تجديد</option>
        <option value="cancel" disabled={!status || status === 'disabled'}>إلغاء</option>
      </select>
      {(action === 'provision' || action === 'renew') && (
        <div className="mt-2">
          <label className="block text-xs text-slate-400" htmlFor={`expiry-${tenantId}-${moduleKey}`}>تاريخ انتهاء الاشتراك (UTC)</label>
          <input id={`expiry-${tenantId}-${moduleKey}`} type="date" value={expiry}
            onChange={event => { setExpiry(event.target.value); setConfirmation(false); }}
            disabled={busy} className="mt-1 w-full rounded-lg border border-white/15 bg-[#111e30] p-2 text-xs text-slate-100" />
        </div>
      )}
      <label className="mt-3 flex items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={confirmation} onChange={event => setConfirmation(event.target.checked)} disabled={busy} className="mt-0.5" />
        <span>أؤكد تعديل <strong>{moduleKey}</strong> للشركة <strong>{tenantName}</strong> ({action}).</span>
      </label>
      <button type="button" onClick={submit} disabled={busy || !confirmation}
        className="mt-3 w-full rounded-lg bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? 'جارٍ التنفيذ…' : 'تنفيذ العملية'}
      </button>
      {message && <p role="status" className="mt-2 text-xs leading-5 text-amber-200">{message}</p>}
    </div>
  );
}
