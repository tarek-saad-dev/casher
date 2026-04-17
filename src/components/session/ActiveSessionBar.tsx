'use client';

import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';
import { User, CalendarDays, Clock, LogOut, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onCloseDayClick?: () => void;
}

export default function ActiveSessionBar({ onCloseDayClick }: Props) {
  const { user, day, shift, hasActiveDay, hasActiveShift, logout } = useSession();
  const canCloseDay = usePermission('day.close');

  if (!user) return null;

  const isAdmin = user.UserLevel === 'admin';

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-muted/50 border-b border-border text-xs">
      {/* User */}
      <div className="flex items-center gap-1.5">
        <User className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium">{user.UserName}</span>
        {isAdmin ? (
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <ShieldAlert className="w-3.5 h-3.5 text-blue-400" />
        )}
      </div>

      <span className="text-muted-foreground/40">|</span>

      {/* Day + Close button */}
      <div className="flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
        {hasActiveDay && day ? (
          <>
            <span className="text-emerald-400">
              يوم {new Date(day.NewDay).toLocaleDateString('ar-EG')}
            </span>
            {canCloseDay && onCloseDayClick && (
              <button
                onClick={onCloseDayClick}
                className="flex items-center gap-0.5 text-muted-foreground hover:text-destructive transition-colors mr-1 cursor-pointer"
                title="إغلاق اليوم"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span className="text-[10px]">إغلاق</span>
              </button>
            )}
          </>
        ) : (
          <span className="text-destructive font-medium">لا يوجد يوم مفتوح</span>
        )}
      </div>

      <span className="text-muted-foreground/40">|</span>

      {/* Shift */}
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        {hasActiveShift && shift ? (
          shift.UserID !== user.UserID ? (
            <span className="text-amber-500 font-medium">
              ⚠ وردية مستخدم آخر ({shift.UserName}) — يجب فتح وردية جديدة
            </span>
          ) : (
            <span className="text-emerald-400">
              {shift.ShiftName || `وردية #${shift.ShiftID}`} — {shift.UserName || user.UserName}
              <span className="text-muted-foreground mr-1">
                (من {shift.StartTime?.trim()})
              </span>
            </span>
          )
        ) : (
          <span className="text-destructive font-medium">لا يوجد وردية مفتوحة</span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Logout */}
      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={logout}>
        <LogOut className="w-3.5 h-3.5 ml-1" />
        خروج
      </Button>
    </div>
  );
}
