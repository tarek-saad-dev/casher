'use client';

import { useEffect, useState } from 'react';

type StatusPayload = {
  connected: boolean;
  integration: {
    drvowaBaseUrl: string;
    drvowaIntegrationId: string | null;
    status: string;
    connectedAtUtc: string | null;
    updatedAtUtc: string;
  } | null;
};

export function DrvowaIntegrationCard() {
  const [pairingCode, setPairingCode] = useState('');
  const [drvowaBaseUrl, setDrvowaBaseUrl] = useState('https://app.drvotech.com');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const response = await fetch('/api/admin/integrations/drvowa/status', {
        cache: 'no-store',
      });
      const data = await response.json();
      if (response.ok) {
        setStatus({
          connected: Boolean(data.connected),
          integration: data.integration ?? null,
        });
      }
    } catch {
      // Keep page usable even if the status probe fails.
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function pair() {
    setBusy(true);
    setMessage(null);
    setErrorCode(null);
    try {
      const response = await fetch('/api/admin/integrations/drvowa/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode,
          drvowaBaseUrl,
          externalReference: 'CUT-SALON-PROD',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || 'تعذر إكمال الربط');
        setErrorCode(typeof data.code === 'string' ? data.code : null);
        return;
      }
      setMessage(
        data.manifestRefreshed
          ? 'تم الربط بنجاح وتحميل الأدوات المتاحة من الـ ERP.'
          : 'تم الربط بنجاح. فحص الأدوات هيتم من DRVOWA.',
      );
      setPairingCode('');
      await loadStatus();
    } catch {
      setMessage('تعذر الاتصال بـ DRVOWA.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black text-sky-700">DRVOWA Integration</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">
              ربط الـ ERP مع DRVOWA
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">
              من DRVOWA افتح صفحة التكاملات وولّد كود ربط مؤقت، وبعدها دخله هنا.
              السيستم هيبادل المفاتيح ويجهز الاتصال تلقائيًا من غير ما تنقل API keys يدويًا.
            </p>
          </div>

          <span className={
            `rounded-full px-3 py-1.5 text-xs font-black ${
              status?.connected
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
            }`
          }>
            {status?.connected ? 'متصل' : 'غير متصل'}
          </span>
        </div>

        <div className="mt-6 grid gap-4">
          <div>
            <label className="text-xs font-black text-slate-700">
              DRVOWA URL
            </label>
            <input
              dir="ltr"
              value={drvowaBaseUrl}
              onChange={(event) => setDrvowaBaseUrl(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-400"
            />
          </div>

          <div>
            <label className="text-xs font-black text-slate-700">
              Pairing Code
            </label>
            <input
              dir="ltr"
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 font-mono text-base tracking-[0.14em] outline-none transition focus:border-sky-400"
            />
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              الكود صالح لمدة 15 دقيقة وبيستخدم مرة واحدة فقط.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || pairingCode.trim().length < 8}
          onClick={() => void pair()}
          className="mt-5 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'جاري الربط...' : status?.connected ? 'إعادة الربط' : 'ربط DRVOWA'}
        </button>

        {message ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
            <div>{message}</div>
            {errorCode ? (
              <div dir="ltr" className="mt-2 font-mono text-[11px] font-semibold text-slate-400">
                {errorCode}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {status?.integration ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-sm font-black text-slate-900">حالة الاتصال</h3>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-[11px] font-black text-slate-400">DRVOWA</div>
              <div dir="ltr" className="mt-1 break-all font-semibold text-slate-700">
                {status.integration.drvowaBaseUrl}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-[11px] font-black text-slate-400">STATUS</div>
              <div className="mt-1 font-black text-emerald-700">
                {status.integration.status}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
