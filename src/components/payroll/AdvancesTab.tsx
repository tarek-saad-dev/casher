'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wallet, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';

interface AdvanceMapping {
  EmpID:        number;
  EmpName:      string;
  ExpINID:      number | null;
  CatName:      string | null;
  ExpINType:    string | null;
  IsActive:     boolean | null;
}

interface DeductionRow {
  EmpID:                  number;
  EmpName:                string;
  TotalEmployeeDeductions:number;
}

function fmt(n: number) {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
}
function today()      { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function AdvancesTab() {
  const [mappings,   setMappings]   = useState<AdvanceMapping[]>([]);
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadingDed, setLoadingDed] = useState(false);
  const [error,      setError]      = useState('');

  const [from, setFrom] = useState(firstOfMonth());
  const [to,   setTo]   = useState(today());

  const loadMappings = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/employees');
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'خطأ');
      setMappings(Array.isArray(d) ? d.map((e: any) => ({
        EmpID:     e.EmpID,
        EmpName:   e.EmpName,
        ExpINID:   e.AdvanceExpINID  ?? null,
        CatName:   e.AdvanceCatName  ?? null,
        ExpINType: null,
        IsActive:  e.AdvanceExpINID !== null,
      })) : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadDeductions = useCallback(async () => {
    setLoadingDed(true);
    try {
      const res = await fetch(`/api/payroll/monthly?from=${from}&to=${to}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'خطأ');
      setDeductions((d.data ?? []).map((r: any) => ({
        EmpID:                   r.EmpID,
        EmpName:                 r.EmpName,
        TotalEmployeeDeductions: r.TotalEmployeeDeductions ?? 0,
      })));
    } catch {}
    finally { setLoadingDed(false); }
  }, [from, to]);

  useEffect(() => { loadMappings(); },   [loadMappings]);
  useEffect(() => { loadDeductions(); }, [loadDeductions]);

  const deductMap = new Map(deductions.map(d => [d.EmpID, d.TotalEmployeeDeductions]));
  const totalDed  = deductions.reduce((s, r) => s + r.TotalEmployeeDeductions, 0);

  return (
    <div className="space-y-5">
      {/* ── Period filter for deductions ── */}
      <div className="flex flex-wrap items-end gap-3 p-4 bg-zinc-900/40 border border-zinc-800/60 rounded-xl">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">من</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-36 bg-zinc-800/50 border-zinc-700 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">إلى</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-36 bg-zinc-800/50 border-zinc-700 text-sm" />
        </div>
        <Button onClick={loadDeductions} disabled={loadingDed} className="bg-amber-600 hover:bg-amber-700 gap-2">
          {loadingDed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          تحديث السلف
        </Button>
        {totalDed > 0 && (
          <div className="mr-auto text-sm">
            <span className="text-zinc-500">إجمالي السلف: </span>
            <span className="font-bold text-rose-400">{fmt(totalDed)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* ── Mapping + Deductions table ── */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">ربط السلف والخصومات</h3>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-right font-medium">تصنيف السلفة</th>
                  <th className="px-4 py-3 text-right font-medium">ExpINID</th>
                  <th className="px-4 py-3 text-right font-medium">حالة الربط</th>
                  <th className="px-4 py-3 text-right font-medium">إجمالي السلف في الفترة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {mappings.map(m => {
                  const ded = deductMap.get(m.EmpID) ?? 0;
                  return (
                    <tr key={m.EmpID} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{m.EmpName}</td>
                      <td className="px-4 py-3">
                        {m.CatName ? (
                          <span className="font-mono text-xs text-zinc-300">{m.CatName}</span>
                        ) : (
                          <span className="text-xs text-zinc-600 italic">غير محدد</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                        {m.ExpINID ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {m.ExpINID ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> مرتبط
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
                            <AlertCircle className="w-3.5 h-3.5" /> غير مرتبط
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ded > 0 ? (
                          <span className="font-bold font-mono text-sm text-rose-400">{fmt(ded)}</span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-600 px-1">
        لإضافة سلفة جديدة، استخدم صفحة "تسجيل مصروف" واختر تصنيف سلفة الموظف.
      </p>
    </div>
  );
}
