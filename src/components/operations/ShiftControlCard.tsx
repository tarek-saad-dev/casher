'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Clock, Play, StopCircle, Loader2, AlertTriangle,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import ShiftCloseReceipt from './ShiftCloseReceipt';
import type {
  ShiftInfo, ShiftSummaryData, DayInfo,
  ShiftDefinition, UserDefaultShift
} from '@/lib/types/operations';

interface Props {
  day: DayInfo | null;
  shift: ShiftInfo | null;
  shiftSummary: ShiftSummaryData | null;
  userDefaultShift: UserDefaultShift | null;
  canOpen: boolean;
  canClose: boolean;
  onRefresh: () => void;
}

type ModalState = 'none' | 'open-confirm' | 'close-wizard';
type CloseStep = 1 | 2 | 3;

interface ShiftClosePrintData {
  shiftMoveID: number;
  userName: string;
  shiftName: string;
  startTime: string;
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: { method: string; cnt: number; total: number }[];
  cashIn: number;
  cashOut: number;
  notes?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0 }).format(n);

function useElapsedTimer(startTime: string | null | undefined): string {
  const [elapsed, setElapsed] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function calcElapsed() {
      if (!startTime) {
        setElapsed('');
        return;
      }
      const now = new Date();
      const parts = startTime.trim().split(/[: ]/);
      if (parts.length < 3) return;
      let hours = parseInt(parts[0]);
      const minutes = parseInt(parts[1]);
      const seconds = parseInt(parts[2]);
      const ampm = parts[3]?.toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const start = new Date();
      start.setHours(hours, minutes, seconds, 0);
      if (start > now) start.setDate(start.getDate() - 1);

      const diffMs = now.getTime() - start.getTime();
      const totalSecs = Math.floor(diffMs / 1000);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = totalSecs % 60;
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }

    calcElapsed();
    timerRef.current = setInterval(calcElapsed, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startTime]);

  return elapsed;
}

export default function ShiftControlCard({
  day, shift, shiftSummary, userDefaultShift, canOpen, canClose, onRefresh
}: Props) {
  const [modal, setModal] = useState<ModalState>('none');
  const [closeStep, setCloseStep] = useState<CloseStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');

  // For open shift
  const [shiftDefs, setShiftDefs] = useState<ShiftDefinition[]>([]);
  const [selectedShiftID, setSelectedShiftID] = useState<number>(userDefaultShift?.ShiftID || 0);
  const [loadingDefs, setLoadingDefs] = useState(false);

  // For close wizard step 2 — cash settlement
  const [actualCash, setActualCash] = useState('');

  const elapsed = useElapsedTimer(shift?.StartTime);

  // Load shift definitions when open modal shown
  useEffect(() => {
    if (modal === 'open-confirm') {
      setLoadingDefs(true);
      fetch('/api/shift/definitions')
        .then(r => r.json())
        .then(d => {
          if (Array.isArray(d)) {
            setShiftDefs(d);
            const defaultID = userDefaultShift?.ShiftID || (d[0]?.ShiftID ?? 0);
            setSelectedShiftID(defaultID);
          }
        })
        .catch(() => { })
        .finally(() => setLoadingDefs(false));
    }
  }, [modal, userDefaultShift?.ShiftID]);

  // ── Open Shift ────────────────────────────────────────────
  async function handleOpenShift() {
    if (!selectedShiftID) { setError('يجب اختيار الوردية'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/shift/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftID: selectedShiftID }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'خطأ غير معروف'); return; }
      resetModal();
      onRefresh();
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  // ── Close Shift ───────────────────────────────────────────
  const [showPrintReceipt, setShowPrintReceipt] = useState(false);
  const [printData, setPrintData] = useState<ShiftClosePrintData | null>(null);

  async function handleCloseShift() {
    if (!shift || !shiftSummary) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/shift/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftMoveID: shift.ID }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'خطأ غير معروف'); return; }

      // Prepare print data
      const closePrintData: ShiftClosePrintData = {
        shiftMoveID: shift.ID,
        userName: shiftSummary.userName || shift.UserName || '—',
        shiftName: shiftSummary.shiftName || shift.ShiftName || '—',
        startTime: shiftSummary.startTime || shift.StartTime?.trim() || '—',
        salesCount: shiftSummary.salesCount,
        totalRevenue: shiftSummary.totalRevenue,
        paymentBreakdown: shiftSummary.paymentBreakdown || [],
        cashIn: shiftSummary.cashIn,
        cashOut: shiftSummary.cashOut,
        notes: notes || undefined,
      };

      // Show print receipt instead of just closing
      resetModal();
      setPrintData(closePrintData);
      setShowPrintReceipt(true);
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
    setError('');
    setNotes('');
    setActualCash('');
  }

  const cashBreakdown = shiftSummary?.paymentBreakdown.find(
    p => p.method === 'كاش' || p.method === 'نقدي' || p.method?.toLowerCase().includes('cash')
  );
  const expectedCash = cashBreakdown ? cashBreakdown.total : 0;
  const cashDiff = actualCash ? parseFloat(actualCash) - expectedCash : null;

  return (
    <>
      {/* ── Card ──────────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl border p-6 flex flex-col gap-4 transition-all',
        shift
          ? 'bg-info-soft border-info/40'
          : 'bg-card border-border'
      )}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center',
              shift ? 'bg-info-soft' : 'bg-muted'
            )}>
              <Clock className={cn('w-5 h-5', shift ? 'text-info' : 'text-muted-foreground')} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">الوردية الحالية</p>
              <h3 className="text-base font-bold text-foreground mt-0.5">
                {shift ? (shift.ShiftName || `وردية #${shift.ShiftID}`) : 'لا توجد وردية'}
              </h3>
            </div>
          </div>

          <span className={cn(
            'text-xs font-semibold px-3 py-1 rounded-full',
            shift
              ? 'bg-info-soft text-info border border-info/30'
              : 'bg-muted text-muted-foreground border border-border'
          )}>
            {shift ? 'نشطة' : 'مغلقة'}
          </span>
        </div>

        {/* Shift info */}
        {shift ? (
          <div className="space-y-3">
            {/* Timer */}
            <div className="bg-card rounded-xl p-3 border border-border flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">مدة الوردية</p>
                <p className="text-2xl font-mono font-bold text-info mt-0.5 tabular-nums">{elapsed || '—'}</p>
              </div>
              <div className="text-left">
                <p className="text-xs text-muted-foreground">بدأت الساعة</p>
                <p className="text-sm font-medium text-foreground mt-0.5" dir="ltr">{shift.StartTime?.trim()}</p>
              </div>
            </div>

            {/* Quick financials */}
            {shiftSummary && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-card rounded-lg p-3 border border-border">
                  <p className="text-xs text-muted-foreground">المبيعات</p>
                  <p className="text-base font-bold text-success mt-0.5">{fmt(shiftSummary.totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground">{shiftSummary.salesCount} فاتورة</p>
                </div>
                <div className="bg-card rounded-lg p-3 border border-border">
                  <p className="text-xs text-muted-foreground">حركة نقدية</p>
                  <p className="text-base font-bold text-warning mt-0.5">
                    {fmt(shiftSummary.cashIn - shiftSummary.cashOut)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    دخل: {fmt(shiftSummary.cashIn)} / خرج: {fmt(shiftSummary.cashOut)}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <AlertTriangle className={cn('w-4 h-4 shrink-0', day ? 'text-warning' : 'text-muted-foreground')} />
            {day ? 'يجب فتح وردية لتسجيل المبيعات والمصروفات' : 'يجب فتح يوم عمل أولاً'}
          </div>
        )}

        {/* Action */}
        <div className="mt-auto pt-2">
          {!shift && canOpen && day && (
            <Button
              onClick={() => { setModal('open-confirm'); setError(''); }}
              className="w-full bg-primary hover:bg-primary-hover text-primary-foreground gap-2"
            >
              <Play className="w-4 h-4" />
              فتح وردية
            </Button>
          )}
          {!shift && !day && (
            <p className="text-xs text-muted-foreground text-center">افتح يوم عمل أولاً</p>
          )}
          {shift && canClose && (
            <Button
              variant="outline"
              onClick={() => { setModal('close-wizard'); setCloseStep(1); setError(''); }}
              className="w-full border-info/50 text-info hover:bg-info-soft hover:text-info gap-2"
            >
              <StopCircle className="w-4 h-4" />
              قفل الوردية
            </Button>
          )}
        </div>
      </div>

      {/* ── Modal: Open Shift ─────────────────────────────── */}
      {modal === 'open-confirm' && (
        <ModalOverlay onClose={resetModal}>
          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[85dvh] overflow-y-auto space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-info-soft flex items-center justify-center">
                <Play className="w-5 h-5 text-info" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">فتح وردية</h2>
                <p className="text-xs text-muted-foreground">اختر الوردية ثم أكد الفتح</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-background rounded-xl p-4 border border-border space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">اليوم</span>
                  <span className="text-foreground font-medium">
                    {day ? new Date(day.NewDay).toLocaleDateString('ar-EG') : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">وقت البداية</span>
                  <span className="text-foreground font-medium" dir="ltr">
                    {new Date().toLocaleTimeString('ar-EG')}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">اختر الوردية</label>
                {loadingDefs ? (
                  <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="grid gap-2">
                    {shiftDefs.map(s => (
                      <button
                        key={s.ShiftID}
                        type="button"
                        onClick={() => setSelectedShiftID(s.ShiftID)}
                        className={cn(
                          'w-full text-right px-4 py-3 rounded-xl border text-sm font-medium transition-all',
                          selectedShiftID === s.ShiftID
                            ? 'bg-info-soft border-info/50 text-info'
                            : 'bg-muted border-border text-foreground hover:border-border'
                        )}
                      >
                        <span>{s.ShiftName}</span>
                        {s.ShiftID === userDefaultShift?.ShiftID && (
                          <span className="mr-2 text-xs text-muted-foreground">(افتراضي)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            <div className="flex gap-3">
              <Button onClick={handleOpenShift} disabled={loading || !selectedShiftID} className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                فتح الوردية
              </Button>
              <Button variant="outline" onClick={resetModal} className="flex-1 border-border">إلغاء</Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Modal: Close Shift Wizard ─────────────────────── */}
      {modal === 'close-wizard' && (
        <ModalOverlay onClose={resetModal}>
          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-lg max-h-[85dvh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-info-soft flex items-center justify-center">
                  <StopCircle className="w-5 h-5 text-info" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">قفل الوردية</h2>
                  <p className="text-xs text-muted-foreground">خطوة {closeStep} من 3</p>
                </div>
              </div>
              <StepIndicator current={closeStep} total={3} />
            </div>

            {/* Step 1: Summary */}
            {closeStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">ملخص الوردية</h3>
                {shiftSummary ? (
                  <div className="space-y-2">
                    <SummaryRow label="اسم الوردية" value={shift?.ShiftName || '—'} />
                    <SummaryRow label="بدأت الساعة" value={shift?.StartTime?.trim() || '—'} />
                    <SummaryRow label="مدة الوردية" value={elapsed || '—'} />
                    <div className="border-t border-border my-2" />
                    <SummaryRow label="عدد الفواتير" value={`${shiftSummary.salesCount}`} />
                    <SummaryRow label="إجمالي المبيعات" value={`${fmt(shiftSummary.totalRevenue)} ج.م`} accent="emerald" />
                    <div className="border-t border-border my-2" />
                    {shiftSummary.paymentBreakdown.map(p => (
                      <SummaryRow key={p.method} label={p.method} value={`${fmt(p.total)} ج.م`} />
                    ))}
                    <div className="border-t border-border my-2" />
                    <SummaryRow label="حركة نقدية داخل" value={`${fmt(shiftSummary.cashIn)} ج.م`} accent="emerald" />
                    <SummaryRow label="حركة نقدية خارج" value={`${fmt(shiftSummary.cashOut)} ج.م`} accent="rose" />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">لا توجد بيانات لهذه الوردية</p>
                )}
                <div className="flex gap-3 pt-2">
                  <Button onClick={() => setCloseStep(2)} className="flex-1 bg-muted hover:bg-surface-muted gap-1">
                    التالي <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={resetModal} className="border-border">إلغاء</Button>
                </div>
              </div>
            )}

            {/* Step 2: Cash settlement */}
            {closeStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">تسوية الكاش</h3>
                <div className="bg-background rounded-xl p-4 border border-border space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">الكاش المتوقع</span>
                    <span className="text-success font-bold font-mono">{fmt(expectedCash)} ج.م</span>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">الكاش الفعلي في الصندوق</label>
                    <input
                      type="number"
                      value={actualCash}
                      onChange={e => setActualCash(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg bg-card border border-border px-4 py-2.5 text-foreground text-base font-mono focus:outline-none focus:border-border"
                      dir="ltr"
                    />
                  </div>
                  {cashDiff !== null && (
                    <div className={cn(
                      'flex items-center justify-between text-sm font-semibold p-2 rounded-lg',
                      cashDiff === 0 ? 'text-success bg-success-soft' :
                        cashDiff > 0 ? 'text-info bg-info-soft' :
                          'text-destructive bg-destructive-soft'
                    )}>
                      <span>الفرق</span>
                      <span className="font-mono">{cashDiff > 0 ? '+' : ''}{fmt(cashDiff)} ج.م</span>
                    </div>
                  )}
                </div>
                {cashDiff !== null && cashDiff !== 0 && (
                  <div className="flex items-center gap-2 text-xs text-warning bg-warning-soft border border-warning/30 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {cashDiff < 0 ? 'يوجد عجز في الكاش — تحقق من الأرقام' : 'يوجد زيادة في الكاش'}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <Button onClick={() => setCloseStep(3)} className="flex-1 bg-muted hover:bg-surface-muted gap-1">
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
                <h3 className="text-sm font-semibold text-foreground">تأكيد قفل الوردية</h3>
                <div className="bg-background rounded-xl p-4 border border-border space-y-2">
                  <SummaryRow label="الوردية" value={shift?.ShiftName || '—'} />
                  <SummaryRow label="إجمالي المبيعات" value={`${fmt(shiftSummary?.totalRevenue || 0)} ج.م`} accent="emerald" />
                  {cashDiff !== null && (
                    <SummaryRow
                      label="فرق الكاش"
                      value={`${cashDiff > 0 ? '+' : ''}${fmt(cashDiff)} ج.م`}
                      accent={cashDiff === 0 ? 'emerald' : cashDiff > 0 ? undefined : 'rose'}
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">ملاحظات الإغلاق (اختياري)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="أي ملاحظات..."
                    className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-border"
                  />
                </div>
                {error && <ErrorBox message={error} />}
                <div className="flex gap-3 pt-2">
                  <Button onClick={handleCloseShift} disabled={loading} className="flex-1 bg-primary hover:bg-primary-hover text-primary-foreground gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                    تأكيد قفل الوردية
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

      {/* Shift Close Receipt Print Modal */}
      <ShiftCloseReceipt
        open={showPrintReceipt}
        data={printData}
        onClose={() => {
          setShowPrintReceipt(false);
          setPrintData(null);
        }}
      />
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
    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive-soft border border-destructive/30 rounded-lg px-3 py-2.5">
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
            i + 1 === current ? 'w-5 bg-info' : i + 1 < current ? 'w-3 bg-success' : 'w-3 bg-muted'
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
    <div className="flex items-center justify-between text-sm py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        bold && 'font-bold text-base',
        accent === 'emerald' && 'text-success',
        accent === 'rose' && 'text-destructive',
        !accent && 'text-foreground'
      )}>{value}</span>
    </div>
  );
}
