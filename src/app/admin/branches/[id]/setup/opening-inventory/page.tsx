'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import PageHeader from '@/components/shared/PageHeader';

const OPTIONS = [
  {
    id: 'ZERO_STOCK',
    title: 'A. البدء بمخزون صفر',
    body: 'يتطلب موافقة صريحة. لا تُنشأ حركات مخزون. الجاهزية تسجّل اعتماد المخزون الصفري.',
  },
  {
    id: 'NEW_PURCHASE',
    title: 'B. إدخال مخزون مشتريات افتتاحي',
    body: 'شبكة/استيراد: منتج، كمية، تكلفة وحدة، مورد، تاريخ، سبب — عبر واجهات الحركة المعتمدة فقط.',
  },
  {
    id: 'TRANSFER_FROM_GLEEM',
    title: 'C. تحويل من جليم',
    body: 'مسار Phase 1J: خروج جليم + دخول كامب شيزار بنفس المرجع والكمية. ممنوع نسخ الكميات مباشرة.',
  },
] as const;

export default function OpeningInventoryOptionsPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string>(
    'المخزون الافتتاحي ما زال BLOCKER حتى يُعتمد خيار صريح (لا تُختلق كميات في Phase 1O).',
  );

  return (
    <div className="mx-auto max-w-3xl p-6" dir="rtl">
      <PageHeader
        title="خيارات المخزون الافتتاحي"
        description="قرار إنتاجي إلزامي قبل INTERNAL_LIVE — لا اختلاق كميات أو تكاليف"
      />
      <p className="mt-2 text-sm text-muted-foreground">BranchID: {branchId}</p>

      <div className="mt-6 space-y-3">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setSelected(opt.id);
              setMessage(
                `تم اختيار ${opt.id} محلياً للعرض فقط. التثبيت الإنتاجي يتطلب استدعاء selectOpeningInventoryOption مع اعتماد صريح — Phase 1O لا يفعّل ZERO_STOCK تلقائياً.`,
              );
            }}
            className={`w-full rounded-lg border px-4 py-3 text-right text-sm transition ${
              selected === opt.id
                ? 'border-primary bg-primary/10'
                : 'border-border/60 bg-surface'
            }`}
          >
            <div className="font-semibold">{opt.title}</div>
            <p className="mt-1 text-muted-foreground">{opt.body}</p>
          </button>
        ))}
      </div>

      <p className="mt-4 rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        biz.opening_inventory = BLOCKER حتى اعتماد خيار وإنشاء الحركات المطلوبة (أو ZERO_STOCK بموافقة).
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/admin/branches/${branchId}/setup`}
          className="rounded-xl border border-border px-4 py-2 text-sm"
        >
          العودة للإعداد
        </Link>
        <Link
          href={`/admin/branches/${branchId}/setup/employees`}
          className="rounded-xl border border-border px-4 py-2 text-sm"
        >
          معالج الموظفين
        </Link>
      </div>
    </div>
  );
}
