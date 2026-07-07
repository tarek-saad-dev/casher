'use client';

import { useCallback, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { formatTime12h } from '@/lib/timeUtils';
import { deriveAttendanceDisplay, type TeamAttendanceMember } from '@/lib/teamAttendance';
import { cn } from '@/lib/utils';

interface TeamAttendanceDrawerProps {
  open: boolean;
  onClose: () => void;
  team: TeamAttendanceMember[];
  date: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

function formatTimeOrDash(val: string | null): string {
  if (!val) return '--';
  const formatted = formatTime12h(val);
  return formatted === '—' ? '--' : formatted;
}

export default function TeamAttendanceDrawer({
  open,
  onClose,
  team,
  date,
  loading,
  error,
  onRefresh,
}: TeamAttendanceDrawerProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" dir="rtl">
      <button
        type="button"
        aria-label="إغلاق"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="حالة حضور الفريق اليوم"
        className={cn(
          'absolute top-0 bottom-0 right-0 flex flex-col',
          'w-full border-l border-border bg-surface shadow-2xl',
          'md:w-[min(100%,520px)] md:min-w-[440px]',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">حالة حضور الفريق اليوم</h2>
            <p className="text-xs text-muted-foreground">{date}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRefresh()}
              aria-label="تحديث"
              title="تحديث"
              disabled={loading}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-luxury-v">
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}

          {loading && team.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">جاري التحميل...</div>
          ) : team.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">لا يوجد موظفون مفعّل لهم نظام الرواتب</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-right font-medium">الموظف</th>
                    <th className="px-3 py-2 text-right font-medium">حضر؟</th>
                    <th className="px-3 py-2 text-right font-medium">الحضور</th>
                    <th className="px-3 py-2 text-right font-medium">انصرف؟</th>
                    <th className="px-3 py-2 text-right font-medium">الانصراف</th>
                    <th className="px-3 py-2 text-right font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {team.map(member => {
                    const display = deriveAttendanceDisplay(member);
                    return (
                      <tr key={member.employeeId} className="hover:bg-surface-muted/30">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">{member.employeeName}</div>
                          {member.jobTitle && (
                            <div className="text-[11px] text-muted-foreground">{member.jobTitle}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {member.isCheckedIn ? (
                            <span className="text-emerald-400">نعم</span>
                          ) : (
                            <span className="text-muted-foreground">لا</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-foreground">
                          {formatTimeOrDash(member.checkInTime)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {member.isCheckedOut ? (
                            <span className="text-violet-300">نعم</span>
                          ) : (
                            <span className="text-muted-foreground">لا</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-foreground">
                          {formatTimeOrDash(member.checkOutTime)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px]', display.chipClassName)}>
                            {display.statusLabel}
                          </span>
                          {member.lateMinutes > 0 && (
                            <div className="mt-0.5 text-[10px] text-amber-400">
                              تأخير {member.lateMinutes} د
                            </div>
                          )}
                          {member.notes && (
                            <div className="mt-0.5 max-w-[120px] truncate text-[10px] text-muted-foreground" title={member.notes}>
                              {member.notes}
                            </div>
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
      </aside>
    </div>
  );
}
