'use client';

import { useState } from 'react';
import {
  CalendarDays, Lock, Unlock, Loader2, AlertTriangle,
  CheckCircle2, Users, ChevronLeft, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DayInfo, DaySummaryData, OpenShiftInfo } from '@/lib/types/operations';

interface Props {
  day: DayInfo | null;
  daySummary: DaySummaryData | null;
  allOpenShifts: OpenShiftInfo[];
  canOpen: boolean;
  canClose: boolean;
  onRefresh: () => void;
}

type ModalState = 'none' | 'open-confirm' | 'close-wizard';
type CloseStep = 1 | 2 | 3;

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0 }).format(n);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

export default function DayControlCard({ day, daySummary, allOpenShifts, canOpen, canClose, onRefresh }: Props) {
  const [modal, setModal] = useState<ModalState>('none');
  const [closeStep, setCloseStep] = useState<CloseStep>(1);
  const [forceClose, setForceClose] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');

  const hasOpenShifts = allOpenShifts.length > 0;

  // ── Open Day ──────────────────────────────────────────────
  async function handleOpenDay() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/day/open', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'خطأ غير معروف'); return; }
      setModal('none');
      onRefresh();
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  // ── Close Day ─────────────────────────────────────────────
  async function handleCloseDay() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/day/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceCloseShifts: forceClose }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'OPEN_SHIFTS') {
          setError(`يوجد ${data.openShifts?.length || ''} وردية مفتوحة`);
        } else {
          setError(data.error || 'خطأ غير معروف');
        }
        return;
      }
      setModal('none');
      setCloseStep(1);
      setForceClose(false);
      setNotes('');
      onRefresh();
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  function resetModal() {
    setModal('none');
    setCloseStep(1);
    setForceClose(false);
    setError('');
    setNotes('');
  }

  return (
    <>
      {/* ── Card ──────────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl border p-6 flex flex-col gap-4 transition-all',
        day
          ? 'bg-emerald-950/30 border-emerald-800/40'
          : 'bg-zinc-900/60 border-zinc-800/50'
      )}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center',
              day ? 'bg-emerald-500/15' : 'bg-zinc-800/80'
            )}>
              <CalendarDays className={cn('w-5 h-5', day ? 'text-emerald-400' : 'text-zinc-500')} />
            </div>
            <div>
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">يوم العمل</p>
              <h3 className="text-base font-bold text-white mt-0.5">
                {day ? 'يوم مفتوح' : 'لا يوجد يوم مفتوح'}
              </h3>
            </div>
          </div>

          <span className={cn(
            'text-xs font-semibold px-3 py-1 rounded-full',
            day
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
          )}>
            {day ? 'نشط' : 'مغلق'}
          </span>
        </div>

        {/* Day info */}
        {day ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300 font-medium">{fmtDate(day.NewDay)}</p>
            {daySummary && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-zinc-900/60 rounded-lg p-3 border border-zinc-800/50">
                  <p className="text-xs text-zinc-500">المبيعات</p>
                  <p className="text-lg font-bold text-emerald-400 mt-0.5">{fmt(daySummary.totalRevenue)}</p>
                  <p className="text-xs text-zinc-600">{daySummary.salesCount} فاتورة</p>
                </div>
                <div className="bg-zinc-900/60 rounded-lg p-3 border border-zinc-800/50">
                  <p className="text-xs text-zinc-500">المصروفات</p>
                  <p className="text-lg font-bold text-rose-400 mt-0.5">{fmt(daySummary.totalExpenses)}</p>
                  <p className="text-xs text-zinc-600">الورديات: {daySummary.shiftsCount}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            لا يمكن فتح أي ورديات أو تسجيل عمليات
          </div>
        )}

        {/* Action */}
        <div className="mt-auto pt-2">
          {!day && canOpen && (
            <Button
              onClick={() => { setModal('open-confirm'); setError(''); }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <Unlock className="w-4 h-4" />
              فتح يوم عمل جديد
            </Button>
          )}
          {day && canClose && (
            <Button
              variant="outline"
              onClick={() => { setModal('close-wizard'); setCloseStep(1); setError(''); }}
              className="w-full border-rose-800/50 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 gap-2"
            >
              <Lock className="w-4 h-4" />
              قفل اليوم
            </Button>
          )}
          {!canOpen && !day && (
            <p className="text-xs text-zinc-600 text-center">ليس لديك صلاحية فتح يوم</p>
          )}
        </div>
      </div>

      {/* ── Modal: Open Day Confirm ───────────────────────── */}
      {modal === 'open-confirm' && (
        <ModalOverlay onClose={resetModal}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">فتح يوم عمل جديد</h2>
                <p className="text-xs text-zinc-500">سيتم فتح يوم عمل بتاريخ اليوم</p>
              </div>
            </div>

            <div className="bg-zinc-950/60 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">التاريخ</span>
                <span className="text-white font-semibold">
                  {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            </div>

            <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg p-3 flex gap-2 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              بعد فتح اليوم، سيتمكن المستخدمون من فتح ورديات وتسجيل العمليات
            </div>

            {error && <ErrorBox message={error} />}

            <div className="flex gap-3">
              <Button onClick={handleOpenDay} disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                تأكيد الفتح
              </Button>
              <Button variant="outline" onClick={resetModal} className="flex-1 border-zinc-700">إلغاء</Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Modal: Close Day Wizard ───────────────────────── */}
      {modal === 'close-wizard' && (
        <ModalOverlay onClose={resetModal}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-lg space-y-5">
            {/* Wizard header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">قفل اليوم</h2>
                  <p className="text-xs text-zinc-500">خطوة {closeStep} من 3</p>
                </div>
              </div>
              <StepIndicator current={closeStep} total={3} />
            </div>

            {/* Step 1: Summary */}
            {closeStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300">مراجعة أرقام اليوم</h3>
                {daySummary ? (
                  <div className="space-y-2">
                    <SummaryRow label="التاريخ" value={fmtDate(daySummary.date)} />
                    <SummaryRow label="عدد الفواتير" value={`${daySummary.salesCount}`} />
                    <SummaryRow label="إجمالي المبيعات" value={`${fmt(daySummary.totalRevenue)} ج.م`} accent="emerald" />
                    <SummaryRow label="إجمالي المصروفات" value={`${fmt(daySummary.totalExpenses)} ج.م`} accent="rose" />
                    <div className="border-t border-zinc-800 my-2" />
                    <SummaryRow
                      label="صافي اليوم"
                      value={`${fmt(daySummary.totalRevenue - daySummary.totalExpenses)} ج.م`}
                      accent={daySummary.totalRevenue >= daySummary.totalExpenses ? 'emerald' : 'rose'}
                      bold
                    />
                    {daySummary.paymentBreakdown.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-zinc-500 mb-2">تفصيل وسائل الدفع</p>
                        {daySummary.paymentBreakdown.map((p) => (
                          <SummaryRow key={p.method} label={p.method} value={`${fmt(p.total)} ج.م`} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">لا توجد بيانات لهذا اليوم</p>
                )}
                <div className="flex gap-3 pt-2">
                  <Button onClick={() => setCloseStep(2)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 gap-1">
                    التالي <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={resetModal} className="border-zinc-700">إلغاء</Button>
                </div>
              </div>
            )}

            {/* Step 2: Check open shifts */}
            {closeStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300">فحص الورديات المفتوحة</h3>
                {hasOpenShifts ? (
                  <div className="space-y-3">
                    <div className="bg-rose-950/30 border border-rose-800/30 rounded-lg p-3 flex gap-2 text-xs text-rose-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      يوجد {allOpenShifts.length} وردية مفتوحة — يجب إغلاقها أولاً أو تفعيل الإغلاق التلقائي
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {allOpenShifts.map(s => (
                        <div key={s.ID} className="flex items-center justify-between bg-zinc-950/50 rounded-lg px-3 py-2 text-sm border border-zinc-800">
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-zinc-500" />
                            <span className="text-zinc-300">{s.UserName}</span>
                            <span className="text-zinc-600">—</span>
                            <span className="text-zinc-400">{s.ShiftName}</span>
                          </div>
                          <span className="text-xs text-zinc-500">{s.StartTime}</span>
                        </div>
                      ))}
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-zinc-800/40 border border-zinc-700 hover:border-amber-500/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={forceClose}
                        onChange={e => setForceClose(e.target.checked)}
                        className="w-4 h-4 accent-amber-500"
                      />
                      <div>
                        <p className="text-sm text-zinc-200 font-medium">إغلاق الورديات تلقائياً</p>
                        <p className="text-xs text-zinc-500">سيتم قفل جميع الورديات المفتوحة بوقت الإغلاق الحالي</p>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="bg-emerald-950/30 border border-emerald-800/30 rounded-lg p-3 flex gap-2 text-sm text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    لا توجد ورديات مفتوحة — يمكن المتابعة
                  </div>
                )}
                {error && <ErrorBox message={error} />}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => setCloseStep(3)}
                    disabled={hasOpenShifts && !forceClose}
                    className="flex-1 bg-zinc-700 hover:bg-zinc-600 gap-1 disabled:opacity-40"
                  >
                    التالي <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={() => setCloseStep(1)} className="border-zinc-700 gap-1">
                    <ChevronRight className="w-4 h-4" /> رجوع
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Final confirm */}
            {closeStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300">تأكيد الإغلاق</h3>
                <div className="bg-rose-950/30 border border-rose-800/30 rounded-lg p-4 space-y-2 text-sm">
                  <p className="text-rose-300 font-semibold">هذا الإجراء لا يمكن التراجع عنه</p>
                  <p className="text-zinc-400">سيتم قفل يوم العمل وإيقاف جميع العمليات التشغيلية</p>
                  {forceClose && hasOpenShifts && (
                    <p className="text-amber-300 text-xs">• سيتم قفل {allOpenShifts.length} وردية مفتوحة تلقائياً</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">ملاحظات (اختياري)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="أي ملاحظات على إغلاق اليوم..."
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
                  />
                </div>
                {error && <ErrorBox message={error} />}
                <div className="flex gap-3 pt-2">
                  <Button onClick={handleCloseDay} disabled={loading} className="flex-1 bg-rose-700 hover:bg-rose-600 gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    تأكيد قفل اليوم
                  </Button>
                  <Button variant="outline" onClick={() => setCloseStep(2)} className="border-zinc-700 gap-1">
                    <ChevronRight className="w-4 h-4" /> رجوع
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────
function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-rose-300 bg-rose-950/40 border border-rose-800/30 rounded-lg px-3 py-2.5">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i + 1 === current ? 'w-5 bg-amber-400' : i + 1 < current ? 'w-3 bg-emerald-500' : 'w-3 bg-zinc-700'
          )}
        />
      ))}
    </div>
  );
}

function SummaryRow({
  label, value, accent, bold
}: { label: string; value: string; accent?: 'emerald' | 'rose'; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-zinc-500">{label}</span>
      <span className={cn(
        bold && 'font-bold text-base',
        accent === 'emerald' && 'text-emerald-400',
        accent === 'rose' && 'text-rose-400',
        !accent && 'text-zinc-200'
      )}>{value}</span>
    </div>
  );
}
