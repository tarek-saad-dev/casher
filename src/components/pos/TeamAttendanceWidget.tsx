'use client';

import { useState } from 'react';
import { CalendarCheck, ChevronLeft, RefreshCw, Users } from 'lucide-react';
import { deriveAttendanceDisplay, type TeamAttendanceMember } from '@/lib/teamAttendance';
import TeamAttendanceDrawer from '@/components/pos/TeamAttendanceDrawer';
import { cn } from '@/lib/utils';

interface TeamAttendanceWidgetProps {
  team: TeamAttendanceMember[];
  date: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

export default function TeamAttendanceWidget({
  team,
  date,
  loading,
  error,
  onRefresh,
}: TeamAttendanceWidgetProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const presentCount = team.filter(m => m.isCheckedIn && !m.isCheckedOut).length;
  const absentCount = team.filter(m => m.attendanceStatus === 'Absent').length;

  return (
    <>
      <div
        className="shrink-0 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur-sm md:px-4"
        dir="rtl"
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-xs font-semibold text-foreground md:text-sm">
                حالة حضور الفريق اليوم
              </span>
              <span className="hidden text-[10px] text-muted-foreground sm:inline">{date}</span>
              {!loading && team.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  · {presentCount} حاضر
                  {absentCount > 0 ? ` · ${absentCount} غائب` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
              {loading && team.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">جاري التحميل...</span>
              ) : error && team.length === 0 ? (
                <span className="text-[11px] text-rose-400">{error}</span>
              ) : team.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">لا يوجد موظفون</span>
              ) : (
                team.map(member => {
                  const display = deriveAttendanceDisplay(member);
                  return (
                    <span
                      key={member.employeeId}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                        display.chipClassName,
                      )}
                    >
                      <span className="max-w-[72px] truncate font-medium">{member.employeeName}</span>
                      <span className="opacity-80">·</span>
                      <span className="whitespace-nowrap opacity-90">{display.chipLabel}</span>
                    </span>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onRefresh()}
              disabled={loading}
              aria-label="تحديث الحضور"
              title="تحديث"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface-muted px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-surface-muted/80"
            >
              <Users className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">عرض التفاصيل</span>
              <ChevronLeft className="h-3 w-3 sm:hidden" />
            </button>
          </div>
        </div>
      </div>

      <TeamAttendanceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        team={team}
        date={date}
        loading={loading}
        error={error}
        onRefresh={onRefresh}
      />
    </>
  );
}
