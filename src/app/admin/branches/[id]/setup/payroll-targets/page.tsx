'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';

type CoverageRow = {
  empId: number;
  empName: string;
  assignment: string;
  schedule: string;
  services: string;
  payroll: string;
  target: string;
  bookingEligibility: string;
  finalStatus: 'ready' | 'blocked';
  blockers: string[];
};

export default function PayrollTargetsSetupPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/payroll-targets`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحميل');
      setRows(data.rows || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6" dir="rtl">
      <Link href={`/admin/branches/${branchId}/setup`} className="text-sm text-muted-foreground">
        ← معالج الإعداد
      </Link>
      <PageHeader
        title="لوحة تغطية الرواتب والتارجت"
        description="حالة كل موظف معيّن على كامب شيزار — بدون fallback لجليم"
      />

      <div className="mt-4">
        <Link
          href={`/admin/branches/${branchId}/setup/employees`}
          className="text-sm text-primary underline"
        >
          فتح تجهيز فريق الافتتاح
        </Link>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <Loader2 className="mt-8 size-6 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
          لا توجد تعيينات إنتاجية نشطة بعد. أكمل التعيين من صفحة الفريق أولًا.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border/70">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right font-medium">الموظف</th>
                <th className="px-3 py-2 text-right font-medium">التعيين</th>
                <th className="px-3 py-2 text-right font-medium">الجدول</th>
                <th className="px-3 py-2 text-right font-medium">الخدمات</th>
                <th className="px-3 py-2 text-right font-medium">الراتب</th>
                <th className="px-3 py-2 text-right font-medium">التارجت</th>
                <th className="px-3 py-2 text-right font-medium">الحجز</th>
                <th className="px-3 py-2 text-right font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.empId} className="border-t border-border/50">
                  <td className="px-3 py-2">{r.empName}</td>
                  <td className="px-3 py-2">{r.assignment}</td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs text-muted-foreground">
                    {r.schedule}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.services}</td>
                  <td className="px-3 py-2 text-xs">{r.payroll}</td>
                  <td className="px-3 py-2">{r.target}</td>
                  <td className="px-3 py-2 text-xs">{r.bookingEligibility}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.finalStatus === 'ready' ? 'text-emerald-300' : 'text-amber-200'
                      }
                    >
                      {r.finalStatus === 'ready' ? 'جاهز' : r.blockers.join(' · ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
