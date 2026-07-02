'use client';

import { memo } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';
import { DbToggleButton } from '@/components/db/DbToggleButton';
import LogoutConfirmModal from '@/components/auth/LogoutConfirmModal';
import ShiftCloseReceipt from '@/components/operations/ShiftCloseReceipt';
import { User, CalendarDays, Clock, LogOut, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import TopNav from '@/components/layout/TopNav';

interface Props {
  onCloseDayClick?: () => void;
}

function ActiveSessionBar({ onCloseDayClick }: Props) {
  const pathname = usePathname();
  const isPosPage = pathname === '/income/pos';
  const { user, day, shift, hasActiveDay, hasActiveShift, logout, closeMyShift } = useSession();
  const canCloseDay = usePermission('day.close');
  const [mounted, setMounted] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPrintReceipt, setShowPrintReceipt] = useState(false);
  const [printData, setPrintData] = useState<{
    shiftMoveID: number;
    userName: string;
    shiftName: string;
    startTime: string;
    salesCount: number;
    totalRevenue: number;
    paymentBreakdown: { method: string; cnt: number; total: number }[];
    cashIn: number;
    cashOut: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!user) return null;

  const isAdmin = user.UserLevel === 'admin';

  async function handleCloseShiftAndLogout() {
    if (shift) {
      await closeMyShift(shift.ID);
    }
    await logout();
  }

  async function handleCloseShiftPrintAndLogout() {
    if (!shift) return;
    
    try {
      // Get shift summary before closing
      const summaryRes = await fetch(`/api/shift/summary?id=${shift.ID}`);
      const summaryData = await summaryRes.json();
      
      if (!summaryRes.ok) {
        // If can't get summary, just close and logout
        await handleCloseShiftAndLogout();
        return;
      }
      
      // Close the shift
      const closeRes = await fetch('/api/shift/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftMoveID: shift.ID }),
      });
      
      if (!closeRes.ok) {
        // If close failed, just logout
        await logout();
        return;
      }
      
      // Prepare print data
      setPrintData({
        shiftMoveID: shift.ID,
        userName: shift.UserName || user?.UserName || '—',
        shiftName: shift.ShiftName || '—',
        startTime: shift.StartTime?.trim() || '—',
        salesCount: summaryData.salesCount || 0,
        totalRevenue: summaryData.totalRevenue || 0,
        paymentBreakdown: summaryData.paymentBreakdown || [],
        cashIn: summaryData.cashIn || 0,
        cashOut: summaryData.cashOut || 0,
      });
      
      // Close logout modal and show print receipt
      setShowLogoutModal(false);
      setShowPrintReceipt(true);
      
      // Refresh session
      // Note: logout will happen after print is closed manually by user
    } catch {
      // On error, just do normal close and logout
      await handleCloseShiftAndLogout();
    }
  }

  function handlePrintClose() {
    setShowPrintReceipt(false);
    setPrintData(null);
    // Now logout after print is done
    logout();
  }

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-muted/50 border-b border-border text-xs overflow-visible relative">
      {/* User */}
      <div className="flex items-center gap-1.5">
        <User className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium">{user.UserName}</span>
        {isAdmin ? (
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
        ) : (
          <ShieldAlert className="w-3.5 h-3.5 text-info" />
        )}
      </div>

      <span className="text-muted-foreground/40">|</span>

      {/* Day + Close button */}
      <div className="flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
        {hasActiveDay && day ? (
          <>
            <span className="text-success">
              يوم {mounted ? new Date(day.NewDay).toLocaleDateString('ar-EG') : new Date(day.NewDay).toISOString().split('T')[0]}
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
            <span className="text-warning font-medium">
              ⚠ وردية مستخدم آخر ({shift.UserName}) — يجب فتح وردية جديدة
            </span>
          ) : (
            <span className="text-success">
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

      {!isPosPage && (
        <>
          <span className="text-muted-foreground/40">|</span>
          {/* Database Toggle */}
          <DbToggleButton />
        </>
      )}

      {/* TopNav — centered in available space */}
      <div className="flex-1 flex justify-center items-center overflow-visible">
        <TopNav />
      </div>

      {/* Logout */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-xs px-2"
        onClick={() => setShowLogoutModal(true)}
      >
        <LogOut className="w-3.5 h-3.5 ml-1" />
        خروج
      </Button>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        hasOpenShift={hasActiveShift}
        shiftName={shift?.ShiftName}
        onClose={() => setShowLogoutModal(false)}
        onCloseShiftAndLogout={handleCloseShiftAndLogout}
        onCloseShiftPrintAndLogout={handleCloseShiftPrintAndLogout}
        onLogoutOnly={logout}
      />

      {/* Shift Close Receipt Print Modal */}
      <ShiftCloseReceipt
        open={showPrintReceipt}
        data={printData}
        onClose={handlePrintClose}
      />
    </div>
  );
}

export default memo(ActiveSessionBar);
