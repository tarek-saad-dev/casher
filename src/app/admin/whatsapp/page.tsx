import { Suspense } from 'react';
import AdminWhatsAppPage from '@/components/admin/whatsapp/AdminWhatsAppPage';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-400" dir="rtl">جاري التحميل…</div>}>
      <AdminWhatsAppPage />
    </Suspense>
  );
}
