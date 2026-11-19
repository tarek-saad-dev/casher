'use client';

import { useState } from 'react';
import Link from 'next/link';

type SendData = {
  ok: boolean;
  challengeId?: string;
  status?: string;
  expiresAtUtc?: string;
  code?: string;
};
type VerifyData = {
  ok: boolean;
  verified?: boolean;
  phoneNormalized?: string;
  code?: string;
};

export function DrvowaOtpTest() {
  const [phone, setPhone] = useState('');
  const [ownNumber, setOwnNumber] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [sentPhone, setSentPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);

  async function sendOtp() {
    setError('');
    setInfo('');
    setBusy('send');
    setChallenge(null);
    setCode('');
    setVerified(false);
    try {
      const response = await fetch('/api/admin/integrations/drvowa/otp-test/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
          requestId: crypto.randomUUID(),
          confirmedOwnNumber: ownNumber,
        }),
      });
      const data = await response.json() as SendData;
      if (!response.ok || !data.ok || !data.challengeId) {
        setError(`تعذر إرسال الكود — ${data.code || response.status}`);
        return;
      }
      setChallenge(data.challengeId);
      setSentPhone(phone.trim());
      setInfo(data.status === 'SENT'
        ? 'تم قبول رسالة OTP للإرسال على واتساب. ادخل الكود اللي وصلك.'
        : 'حالة الإرسال غير مؤكدة. لو وصل الكود على واتساب، تقدر تدخله هنا.');
    } catch {
      setError('تعذر الاتصال بسيرفر Casher.');
    } finally {
      setBusy(null);
    }
  }

  async function verifyOtp() {
    if (!challenge) return;
    setError('');
    setInfo('');
    setBusy('verify');
    try {
      const response = await fetch('/api/admin/integrations/drvowa/otp-test/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: sentPhone,
          challengeId: challenge,
          code: code.trim(),
        }),
      });
      const data = await response.json() as VerifyData;
      if (!response.ok || !data.ok || data.verified !== true) {
        setError(`التحقق لم ينجح — ${data.code || response.status}`);
        return;
      }
      setVerified(true);
      setCode('');
      setInfo(`تم التحقق بنجاح ✅ — ${data.phoneNormalized || sentPhone}`);
    } catch {
      setError('تعذر الاتصال بسيرفر Casher.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/integrations/drvowa" className="text-sm font-bold text-sky-700 hover:underline">
          العودة لتكامل DRVO
        </Link>
        <h1 className="mt-3 text-2xl font-black text-slate-950">تجربة WhatsApp OTP API</h1>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          اختبار حقيقي لإرسال رمز تحقق من رقم Cut Salon المتصل بـ DRVO AutoRespond.
          سيتم استخدام مفتاح الربط من السيرفر فقط، مش هيظهر في المتصفح.
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-5 text-sm font-black text-slate-900">1. إرسال كود التحقق</div>
        <label htmlFor="otp-test-phone" className="block text-sm font-bold text-slate-800">رقم واتساب الاختبار</label>
        <input
          id="otp-test-phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="tel"
          placeholder="01012345678"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setChallenge(null); setInfo(''); setError(''); }}
          disabled={busy !== null}
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-500"
        />
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={ownNumber}
            onChange={e => setOwnNumber(e.target.checked)}
            className="mt-1"
          />
          ده رقمي أو رقم صاحبه موافق على استقبال رسالة الاختبار
        </label>
        <button
          type="button"
          onClick={() => void sendOtp()}
          disabled={busy !== null || !ownNumber || phone.trim().length < 8}
          className="mt-5 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
        >
          {busy === 'send' ? 'جاري إرسال OTP...' : 'إرسال OTP على واتساب'}
        </button>
      </section>

      {challenge ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 text-sm font-black text-slate-900">2. تأكيد الكود</div>
          <p className="mb-3 text-sm text-slate-500">ادخل الست أرقام اللي وصلت على واتساب {sentPhone}.</p>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            dir="ltr"
            aria-label="OTP code"
            placeholder="● ● ● ● ● ●"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy !== null || verified}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-sky-500"
          />
          <button
            type="button"
            onClick={() => void verifyOtp()}
            disabled={busy !== null || verified || code.length !== 6}
            className="mt-4 w-full rounded-xl bg-emerald-700 px-5 py-3 font-black text-white transition hover:bg-emerald-800 disabled:opacity-40"
          >
            {busy === 'verify' ? 'جاري التحقق...' : verified ? 'تم التحقق' : 'تحقق من OTP'}
          </button>
        </section>
      ) : null}

      {info ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">{info}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</p> : null}

      <p className="text-xs leading-6 text-slate-500">
        الكود صالح 5 دقائق، وبحد أقصى 5 محاولات للتحقق. إرسال رسالة الاختبار فعلي ويستهلك من استخدام واتساب للبزنس.
        الشاشة دي للتجربة فقط ولا تفعّل حساب CUT CLUB بنفسها.
      </p>
    </div>
  );
}
