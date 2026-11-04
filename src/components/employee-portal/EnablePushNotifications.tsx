'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cut-staff-push-prompt-v1';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerStaffPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('unsupported');
  }
  const keyRes = await fetch('/api/employee-portal/push/vapid-public-key', { cache: 'no-store' });
  if (!keyRes.ok) throw new Error('vapid_unavailable');
  const { publicKey } = (await keyRes.json()) as { publicKey?: string };
  if (!publicKey) throw new Error('vapid_unavailable');

  const registration =
    (await navigator.serviceWorker.getRegistration('/employee-portal')) ||
    (await navigator.serviceWorker.register('/employee-portal/sw.js', { scope: '/employee-portal' }));

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  const res = await fetch('/api/employee-portal/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  });
  if (!res.ok) throw new Error('subscribe_failed');
}

export default function EnablePushNotifications() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (localStorage.getItem(STORAGE_KEY) === 'dismissed') return;
    if (Notification.permission === 'granted') {
      void registerStaffPush().catch(() => undefined);
      return;
    }
    if (Notification.permission === 'denied') return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
      <p className="font-bold">تفعيل إشعارات الحجوزات</p>
      <p className="mt-1 text-xs text-amber-100/80">وصلك تنبيه فور إضافة حجز جديد لك على تطبيق CUT STAFF</p>
      {message ? <p className="mt-2 text-xs text-rose-300">{message}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-xl bg-amber-400 px-3 py-2 text-xs font-extrabold text-zinc-950 disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            setMessage('');
            void registerStaffPush()
              .then(() => {
                localStorage.setItem(STORAGE_KEY, 'dismissed');
                setVisible(false);
              })
              .catch((err) => {
                const code = err instanceof Error ? err.message : 'error';
                setMessage(
                  code === 'denied'
                    ? 'تم رفض إذن الإشعارات من الجهاز'
                    : code === 'vapid_unavailable'
                      ? 'الإشعارات غير مهيأة على السيرفر بعد'
                      : 'تعذر تفعيل الإشعارات',
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'جاري التفعيل…' : 'تفعيل'}
        </button>
        <button
          type="button"
          className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-200"
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, 'dismissed');
            setVisible(false);
          }}
        >
          لاحقًا
        </button>
      </div>
    </div>
  );
}
