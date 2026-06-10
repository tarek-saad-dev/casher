'use client';

import Link from 'next/link';
import { ShieldOff } from 'lucide-react';

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="text-center space-y-6 max-w-md">
        <div className="mx-auto w-20 h-20 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
          <ShieldOff className="w-10 h-10 text-rose-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-rose-400 mb-2">403</h1>
          <h2 className="text-xl font-semibold text-zinc-200 mb-3">غير مصرح بالوصول</h2>
          <p className="text-zinc-400 text-sm">
            ليس لديك صلاحية لعرض هذه الصفحة. تواصل مع مدير النظام لطلب الوصول.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-sm font-medium transition-colors border border-zinc-700"
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
