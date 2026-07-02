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
          ? 'bg-success/10 border-success/20'
          : 'bg-surface/60 border-border/50'
      )}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center',
              day ? 'bg-success/15' : 'bg-surface-muted/80'
            )}>
              <CalendarDays className={cn('w-5 h-5', day ? 'text-success' : 'text-muted-foreground/70')} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">يوم العمل</p>
              <h3 className="text-base font-bold text-foreground mt-0.5">
                {day ? 'يوم مفتوح' : 'لا يوجد يوم مفتوح'}
              </h3>
            </div>
          </div>

          <span className={cn(
            'text-xs font-semibold px-3 py-1 rounded-full',
            day
              ? 'bg-success/15 text-success border border-success/30'
              : 'bg-surface-muted text-muted-foreground/70 border border-border'
          )}>
            {day ? 'نشط' : 'مغلق'}
          </span>
        </div>

        {/* Day info */}
        {day ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground font-medium">{fmtDate(day.NewDay)}</p>
            {daySummary && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-surface/60 rounded-lg p-3 border border-border/50">
                  <p className="text-xs text-muted-foreground/70">المبيعات</p>
                  <p className="text-lg font-bold text-success mt-0.5">{fmt(daySummary.totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground/60">{daySummary.salesCount} فاتورة</p>
                </div>
                <div className="bg-surface/60 rounded-lg p-3 border border-border/50">
                  <p className="text-xs text-muted-foreground/70">المصروفات</p>
                  <p className="text-lg font-bold text-destructive mt-0.5">{fmt(daySummary.totalExpenses)}</p>
                  <p className="text-xs text-muted-foreground/60">الورديات: {daySummary.shiftsCount}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground/70 py-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            لا يمكن فتح أي ورديات أو تسجيل عمليات
          </div>
        )}

        {/* Action */}
        <div className="mt-auto pt-2">
          {!day && canOpen && (
            <Button
              onClick={() => { setModal('open-confirm'); setError(''); }}
              className="w-full bg-success hover:bg-success/90 text-foreground gap-2"
            >
              <Unlock className="w-4 h-4" />
              فتح يوم عمل جديد
            </Button>
          )}
          {day && canClose && (
            <Button
              variant="outline"
              onClick={() => { setModal('close-wizard'); setCloseStep(1); setError(''); }}
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive/80 gap-2"
            >
              <Lock className="w-4 h-4" />
              قفل اليوم
            </Button>
          )}
          {!canOpen && !day && (
            <p className="text-xs text-muted-foreground/60 text-center">ليس لديك صلاحية فتح يوم</p>
          )}
        </div>
      </div>

      {/* ── Modal: Open Day Confirm ───────────────────────── */}
      {modal === 'open-confirm' && (
        <ModalOverlay onClose={resetModal}>
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-success" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">فتح يوم عمل جديد</h2>
                <p className="text-xs text-muted-foreground/70">سيتم فتح يوم عمل بتاريخ اليوم</p>
              </div>
            </div>

            <div className="bg-background/60 rounded-xl p-4 border border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">التاريخ</span>
                <span className="text-foreground font-semibold">
                  {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
            </div>

            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex gap-2 text-xs text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              بعد فتح اليوم، سيتمكن المستخدمون من فتح ورديات وتسجيل العمليات
            </div>

            {error && <ErrorBox message={error} />}

            <div className="flex gap-3">
              <Button onClick={handleOpenDay} disabled={loading} className="flex-1 bg-success hover:bg-success/90 gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                تأكيد الفتح
              </Button>
              <Button variant="outline" onClick={resetModal} className="flex-1 border-border">إلغاء</Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Modal: Close Day Wizard ───────────────────────── */}
      {modal === 'close-wizard' && (
        <ModalOverlay onClose={resetModal}>
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-lg space-y-5">
            {/* Wizard header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">قفل اليوم</h2>
                  <p className="text-xs text-muted-foreground/70">خطوة {closeStep} من 3</p>
                </div>
              </div>
              <StepIndicator current={closeStep} total={3} />
            </div>

            {/* Step 1: Summary */}
            {closeStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">مراجعة أرقام اليوم</h3>
                {daySummary ? (
                  <div className="space-y-2">
                    <SummaryRow label="التاريخ" value={fmtDate(daySummary.date)} />
                    <SummaryRow label="عدد الفواتير" value={`${daySummary.salesCount}`} />
                    <SummaryRow label="إجمالي المبيعات" value={`${fmt(daySummary.totalRevenue)} ج.م`} accent="emerald" />
                    <SummaryRow label="إجمالي المصروفات" value={`${fmt(daySummary.totalExpenses)} ج.م`} accent="rose" />
                    <div className="border-t border-border my-2" />
                    <SummaryRow
                      label="صافي اليوم"
                      value={`${fmt(daySummary.totalRevenue - daySummary.totalExpenses)} ج.م`}
                      accent={daySummary.totalRevenue >= daySummary.totalExpenses ? 'emerald' : 'rose'}
                      bold
                    />
                    {daySummary.paymentBreakdown.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-muted-foreground/70 mb-2">تفصيل وسائل الدفع</p>
                        {daySummary.paymentBreakdown.map((p) => (
                          <SummaryRow key={p.method} label={p.method} value={`${fmt(p.total)} ج.م`} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground/70 text-sm">لا توجد بيانات لهذا اليوم</p>
                )}
                <div className="flex gap-3 pt-2">
                  <Button onClick={() => setCloseStep(2)} className="flex-1 bg-secondary hover:bg-secondary/80 gap-1">
                    التالي <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={resetModal} className="border-border">إلغاء</Button>
                </div>
              </div>
            )}

            {/* Step 2: Check open shifts */}
            {closeStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">فحص الورديات المفتوحة</h3>
                {hasOpenShifts ? (
                  <div className="space-y-3">
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex gap-2 text-xs text-destructive">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      يوجد {allOpenShifts.length} وردية مفتوحة — يجب إغلاقها أولاً أو تفعيل الإغلاق التلقائي
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {allOpenShifts.map(s => (
                        <div key={s.ID} className="flex items-center justify-between bg-background/50 rounded-lg px-3 py-2 text-sm border border-border">
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-muted-foreground/70" />
                            <span className="text-foreground">{s.UserName}</span>
                            <span className="text-muted-foreground/60">—</span>
                            <span className="text-muted-foreground">{s.ShiftName}</span>
                          </div>
                          <span className="text-xs text-muted-foreground/70">{s.StartTime}</span>
                        </div>
                      ))}
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-surface-muted/40 border border-border hover:border-warning/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={forceClose}
                        onChange={e => setForceClose(e.target.checked)}
                        className="w-4 h-4 accent-warning"
                      />
                      <div>
                        <p className="text-sm text-foreground font-medium">إغلاق الورديات تلقائياً</p>
                        <p className="text-xs text-muted-foreground/70">سيتم قفل جميع الورديات المفتوحة بوقت الإغلاق الحالي</p>
                      </div>
                    </label>
                  </div>
                ) : (
                  <div className="bg-success/10 border border-success/20 rounded-lg p-3 flex gap-2 text-sm text-success">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    لا توجد ورديات مفتوحة — يمكن المتابعة
                  </div>
                )}
                {error && <ErrorBox message={error} />}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => setCloseStep(3)}
                    disabled={hasOpenShifts && !forceClose}
                    className="flex-1 bg-secondary hover:bg-secondary/80 gap-1 disabled:opacity-40"
                  >
                    التالي <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={() => setCloseStep(1)} className="border-border gap-1">
                    <ChevronRight className="w-4 h-4" /> رجوع
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Final confirm */}
            {closeStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">تأكيد الإغلاق</h3>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-2 text-sm">
                  <p className="text-destructive font-semibold">هذا الإجراء لا يمكن التراجع عنه</p>
                  <p className="text-muted-foreground">سيتم قفل يوم العمل وإيقاف جميع العمليات التشغيلية</p>
                  {forceClose && hasOpenShifts && (
                    <p className="text-warning text-xs">• سيتم قفل {allOpenShifts.length} وردية مفتوحة تلقائياً</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">ملاحظات (اختياري)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="أي ملاحظات على إغلاق اليوم..."
                    className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:border-border"
                  />
                </div>
                {error && <ErrorBox message={error} />}
                <div className="flex gap-3 pt-2">
                  <Button onClick={handleCloseDay} disabled={loading} className="flex-1 bg-destructive hover:bg-destructive/90 gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    تأكيد قفل اليوم
                  </Button>
                  <Button variant="outline" onClick={() => setCloseStep(2)} className="border-border gap-1">
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
    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
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
            i + 1 === current ? 'w-5 bg-warning' : i + 1 < current ? 'w-3 bg-success' : 'w-3 bg-muted-foreground'
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
      <span className="text-muted-foreground/70">{label}</span>
      <span className={cn(
        bold && 'font-bold text-base',
        accent === 'emerald' && 'text-success',
        accent === 'rose' && 'text-destructive',
        !accent && 'text-foreground'
      )}>{value}</span>
    </div>
  );
}
