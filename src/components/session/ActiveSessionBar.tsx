'use client';

import { memo, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { DbToggleButton } from '@/components/db/DbToggleButton';
import LogoutConfirmModal from '@/components/auth/LogoutConfirmModal';
import ShiftCloseReceipt from '@/components/operations/ShiftCloseReceipt';
import CloseShiftConfirmDialog from '@/components/session/CloseShiftConfirmDialog';
import OperationalHandoffControl from '@/components/session/OperationalHandoffControl';
import OperationalMobileSheet from '@/components/session/OperationalMobileSheet';
import { useOperationalToast } from '@/components/session/OperationalToast';
import { User, LogOut, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TopNav from '@/components/layout/TopNav';
import BranchSwitcher from '@/components/session/BranchSwitcher';
import {
  branchDisplayName,
  formatShiftElapsed,
  formatShiftStartTime,
  mapOperationalError,
} from '@/lib/operations/viewOperationalState';

function ActiveSessionBar() {
  const pathname = usePathname();
  const isPosPage = pathname === '/income/pos';
  const {
    user,
    shift,
    hasOpenShift,
    viewBranch,
    operationalBranch,
    viewMatchesOperational,
    logout,
    closeMyShift,
  } = useSession();
  const { showToast } = useOperationalToast();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPrintReceipt, setShowPrintReceipt] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [busyClose, setBusyClose] = useState(false);
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

  useEffect(() => {
    if (!hasOpenShift) return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [hasOpenShift]);

  if (!user) return null;

  const isAdmin = user.UserLevel === 'admin';
  const viewLabel = branchDisplayName(viewBranch);
  const opLabel = branchDisplayName(operationalBranch);
  const startedAt = formatShiftStartTime(shift?.StartDate, shift?.StartTime);
  const elapsed = formatShiftElapsed(shift?.StartDate, shift?.StartTime, now);

  async function handleCloseShiftAndLogout() {
    if (shift) {
      await closeMyShift(shift.ID);
    }
    await logout();
  }

  async function handleCloseShiftPrintAndLogout() {
    if (!shift) return;

    try {
      const summaryRes = await fetch(`/api/shift/summary?id=${shift.ID}`);
      const summaryData = await summaryRes.json();

      if (!summaryRes.ok) {
        await handleCloseShiftAndLogout();
        return;
      }

      const closeRes = await fetch('/api/shift/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftMoveID: shift.ID }),
      });

      if (!closeRes.ok) {
        await logout();
        return;
      }

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

      setShowLogoutModal(false);
      setShowPrintReceipt(true);
    } catch {
      await handleCloseShiftAndLogout();
    }
  }

  function handlePrintClose() {
    setShowPrintReceipt(false);
    setPrintData(null);
    void logout();
  }

  async function confirmCloseShift() {
    if (!shift) return;
    setBusyClose(true);
    try {
      await closeMyShift(shift.ID);
      setCloseShiftOpen(false);
      showToast(`تم إنهاء وردية ${opLabel}`);
    } catch (err) {
      showToast(mapOperationalError(err, 'فشل إنهاء الوردية'));
    } finally {
      setBusyClose(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/50 border-b border-border text-xs overflow-hidden relative min-w-0">
      {/* Desktop operational status — compact, view lighter / operate stronger */}
      <div className="hidden xl:flex items-center gap-2.5 shrink-0 max-w-[46%] min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium truncate max-w-[7rem]">{user.UserName}</span>
          {isAdmin ? (
            <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-info shrink-0" />
          )}
        </div>

        <span className="text-muted-foreground/40">|</span>

        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-muted-foreground whitespace-nowrap">عرض:</span>
          <BranchSwitcher />
        </div>

        <span className="text-muted-foreground/40">|</span>

        {hasOpenShift && operationalBranch ? (
          <div
            className="flex items-center gap-1.5 min-w-0"
            title={
              viewMatchesOperational
                ? `تعمل في ${opLabel}`
                : `عرض ${viewLabel} — تعمل في ${opLabel}`
            }
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-success" />
            <span className="font-semibold text-foreground whitespace-nowrap">
              تعمل في {opLabel}
            </span>
            <span className="text-muted-foreground whitespace-nowrap">
              وردية مفتوحة
              {elapsed ? ` • ${elapsed}` : startedAt && mounted ? ` • منذ ${startedAt}` : ''}
            </span>
            <OperationalHandoffControl className="text-[10px] font-medium text-primary hover:underline underline-offset-2 whitespace-nowrap" />
            <button
              type="button"
              onClick={() => setCloseShiftOpen(true)}
              className="text-[10px] text-muted-foreground hover:text-destructive underline-offset-2 hover:underline mr-0.5"
            >
              إنهاء
            </button>
          </div>
        ) : (
          <span className="text-muted-foreground whitespace-nowrap">لا توجد وردية مفتوحة</span>
        )}

        {!isPosPage && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <DbToggleButton />
          </>
        )}
      </div>

      {/* Compact chip (&lt; xl): tap opens operational sheet on mobile widths */}
      <div className="flex xl:hidden items-center gap-1.5 shrink-0">
        <User className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium truncate max-w-[5.5rem]">{user.UserName}</span>
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          className={`text-[10px] whitespace-nowrap rounded-md px-1.5 py-0.5 ${
            hasOpenShift
              ? viewMatchesOperational
                ? 'text-success bg-success/10'
                : 'text-amber-700 dark:text-amber-400 bg-amber-500/10'
              : 'text-muted-foreground bg-muted'
          }`}
          aria-label="الحالة التشغيلية"
        >
          {hasOpenShift ? `● ${opLabel}` : 'لا توجد وردية'}
        </button>
        <OperationalHandoffControl
          label="نقل التشغيل"
          className="text-[10px] font-medium text-primary whitespace-nowrap rounded-md px-1.5 py-0.5 bg-primary/10"
        />
        {!isPosPage && <DbToggleButton />}
      </div>

      <div className="flex-1 min-w-0 overflow-hidden">
        <TopNav />
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-xs px-2 shrink-0"
        onClick={() => setShowLogoutModal(true)}
      >
        <LogOut className="w-3.5 h-3.5 ml-1" />
        خروج
      </Button>

      <LogoutConfirmModal
        isOpen={showLogoutModal}
        hasOpenShift={hasOpenShift}
        shiftName={shift?.ShiftName}
        onClose={() => setShowLogoutModal(false)}
        onCloseShiftAndLogout={handleCloseShiftAndLogout}
        onCloseShiftPrintAndLogout={handleCloseShiftPrintAndLogout}
        onLogoutOnly={logout}
      />

      <ShiftCloseReceipt open={showPrintReceipt} data={printData} onClose={handlePrintClose} />

      <CloseShiftConfirmDialog
        open={closeShiftOpen}
        branchLabel={opLabel}
        startedAt={startedAt}
        elapsed={elapsed}
        busy={busyClose}
        onCancel={() => setCloseShiftOpen(false)}
        onConfirm={() => void confirmCloseShift()}
      />

      <OperationalMobileSheet open={mobileSheetOpen} onClose={() => setMobileSheetOpen(false)} />
    </div>
  );
}

export default memo(ActiveSessionBar);
