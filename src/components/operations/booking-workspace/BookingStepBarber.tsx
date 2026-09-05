'use client';

import { Sparkles, User, Clock } from 'lucide-react';
import {
  BORDER,
  GOLD,
  GOLD_BG,
  GOLD_BDR,
  type BookingMode,
  type BookingWorkspaceBarber,
  barberStatusLabel,
  formatBarberHours,
  formatNextAvailable,
} from './types';

interface Props {
  mode: BookingMode;
  barbers: BookingWorkspaceBarber[];
  selectedBarberId: number | null;
  lockedBarber: boolean;
  initialBarberName?: string;
  loadingBarbers?: boolean;
  /** Dense layout when embedded in Time step. */
  compact?: boolean;
  onModeChange: (mode: BookingMode) => void;
  onSelectBarber: (empId: number) => void;
}

export function BookingStepBarber({
  mode,
  barbers,
  selectedBarberId,
  lockedBarber,
  initialBarberName,
  loadingBarbers = false,
  compact = false,
  onModeChange,
  onSelectBarber,
}: Props) {
  return (
    <div className={compact ? 'space-y-3 max-w-3xl' : 'space-y-6 max-w-3xl'}>
      {!compact && (
        <div>
          <h3 className="text-base font-bold text-foreground mb-1">طريقة اختيار الحلاق</h3>
          <p className="text-xs text-muted-foreground">حدد كيف سيتم تعيين الحلاق لهذا الحجز</p>
        </div>
      )}
      {compact && (
        <p className="text-xs font-semibold text-muted-foreground">اختيار الحلاق</p>
      )}

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-2' : 'gap-4'}`}>
        {[
          {
            value: 'nearest' as const,
            label: 'أقرب حلاق متاح',
            desc: 'النظام يعرض أقرب الأوقات المتاحة',
            icon: Sparkles,
            disabled: lockedBarber,
          },
          {
            value: 'specific' as const,
            label: 'حلاق معين',
            desc: 'اختر الحلاق بنفسك',
            icon: User,
            disabled: false,
          },
        ].map((m) => {
          const active = mode === m.value;
          const Icon = m.icon;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => !m.disabled && onModeChange(m.value)}
              disabled={m.disabled}
              className={`relative flex flex-col items-start gap-2 rounded-2xl border-2 transition-all text-right ${
                compact ? 'p-3 min-h-[72px]' : 'p-5 min-h-[120px] gap-3'
              }`}
              style={{
                borderColor: active ? GOLD : BORDER,
                background: active ? GOLD_BG : 'var(--surface)',
                opacity: m.disabled ? 0.5 : 1,
              }}
            >
              {active && (
                <span className="absolute top-3 left-3 w-2.5 h-2.5 rounded-full" style={{ background: GOLD }} aria-hidden />
              )}
              <div
                className={`rounded-xl flex items-center justify-center ${compact ? 'w-9 h-9' : 'w-12 h-12'}`}
                style={{ background: active ? GOLD : 'var(--surface-muted)' }}
              >
                <Icon size={compact ? 18 : 22} style={{ color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }} />
              </div>
              <div>
                <p className="text-base font-bold" style={{ color: active ? GOLD : 'var(--foreground)' }}>{m.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {mode === 'specific' && (
        <div className="space-y-3">
          <h4 className="text-sm font-bold text-foreground">اختر الحلاق</h4>
          {lockedBarber && initialBarberName && (
            <p className="text-xs px-3 py-2 rounded-lg border" style={{ borderColor: GOLD_BDR, background: GOLD_BG, color: GOLD }}>
              تم التحديد من لوحة العمليات: {initialBarberName}
            </p>
          )}
          {loadingBarbers && (
            <p className="text-xs text-muted-foreground">جاري تحديث جداول الحلاقين لهذا اليوم…</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {barbers.map((b) => {
              const active = selectedBarberId === b.empId;
              const nextAt = formatNextAvailable(b.nextAvailableAt);
              const hours = formatBarberHours(b.workStart, b.workEnd);
              return (
                <button
                  key={b.empId}
                  type="button"
                  onClick={() => onSelectBarber(b.empId)}
                  className="text-right p-4 rounded-xl border-2 transition-all min-h-[100px]"
                  style={{
                    borderColor: active ? GOLD : BORDER,
                    background: active ? GOLD_BG : 'var(--surface)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                      style={{ background: active ? GOLD : 'var(--surface-muted)', color: active ? 'var(--primary-foreground)' : 'var(--foreground)' }}
                    >
                      {b.empName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate" style={{ color: active ? GOLD : 'var(--foreground)' }}>{b.empName}</p>
                      <p className="text-[11px] mt-1 font-semibold" style={{ color: b.status === 'working' ? 'var(--success)' : 'var(--muted-foreground)' }}>
                        {barberStatusLabel(b.status)}
                      </p>
                      {hours && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {hours}
                        </p>
                      )}
                      {nextAt && (
                        <p className="text-[10px] mt-1" style={{ color: GOLD }}>أقرب موعد: {nextAt}</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
