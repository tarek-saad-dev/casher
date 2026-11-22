'use client';

import { memo, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { DbToggleButton } from '@/components/db/DbToggleButton';
import LogoutConfirmModal from '@/components/auth/LogoutConfirmModal';
import ShiftCloseReceipt from '@/components/operations/ShiftCloseReceipt';
import CloseShiftConfirmDialog from '@/components/session/CloseShiftConfirmDialog';
import ShiftCloseReconPanel from '@/components/treasury/ShiftCloseReconPanel';
import OperationalHandoffControl from '@/components/session/OperationalHandoffControl';
import OperationalMobileSheet from '@/components/session/OperationalMobileSheet';
import { useOperationalToast } from '@/components/session/OperationalToast';
import { User, LogOut, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BranchSwitcher from '@/components/session/BranchSwitcher';
import {
  branchDisplayName,
  formatShiftElapsed,
  formatShiftStartTime,
  mapOperationalError,
} from '@/lib/operations/viewOperationalState';

type ShiftReconIntent = 'logout' | 'close-only' | null;

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
    access,
    logout,
    closeMyShift,
    refresh,
  } = useSession();
  const { showToast } = useOperationalToast();
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPrintReceipt, setShowPrintReceipt] = useState(false);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [busyClose, setBusyClose] = useState(false);
  const [shiftReconIntent, setShiftReconIntent] = useState<ShiftReconIntent>(null);
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

  const isCashier = Boolean(access?.roles?.includes('cashier'));
  const requireShiftRecon = isCashier && hasOpenShift && Boolean(shift?.ID);

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

  function requestLogout() {
    if (requireShiftRecon) {
      setShiftReconIntent('logout');
      return;
    }
    setShowLogoutModal(true);
  }

  function requestEndShift() {
    if (requireShiftRecon) {
      setShiftReconIntent('close-only');
      return;
    }
    setCloseShiftOpen(true);
  }

  async function handleCloseShiftAndLogout() {
    if (shift) {
      try {
        await closeMyShift(shift.ID);
      } catch (err) {
        showToast(mapOperationalError(err, 'فشل إغلاق الوردية — لم يتم تسجيل الخروج'));
        return;
      }
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
        const data = await closeRes.json().catch(() => ({}));
        showToast(mapOperationalError(
          new Error(data.error || 'فشل إغلاق الوردية'),
          'فشل إغلاق الوردية — لم يتم تسجيل الخروج',
        ));
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

  async function handleShiftReconClosed() {
    const intent = shiftReconIntent;
    setShiftReconIntent(null);
    const closedShiftId = shift?.ID;
    const closedShift = shift;

    try {
      await refresh();
    } catch {
      // session refresh best-effort
    }

    if (intent === 'logout' && closedShiftId && closedShift) {
      try {
        const summaryRes = await fetch(`/api/shift/summary?id=${closedShiftId}`);
        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          setPrintData({
            shiftMoveID: closedShiftId,
            userName: closedShift.UserName || user?.UserName || '—',
            shiftName: closedShift.ShiftName || '—',
            startTime: closedShift.StartTime?.trim() || '—',
            salesCount: summaryData.salesCount || 0,
            totalRevenue: summaryData.totalRevenue || 0,
            paymentBreakdown: summaryData.paymentBreakdown || [],
            cashIn: summaryData.cashIn || 0,
            cashOut: summaryData.cashOut || 0,
          });
          setShowPrintReceipt(true);
          return;
        }
      } catch {
        // fall through to logout
      }
      await logout();
      return;
    }

    showToast(`تم تقفيل وردية ${opLabel}`);
  }

  const shiftTone = hasOpenShift
    ? viewMatchesOperational
      ? 'bg-success-soft text-success border-success/20'
      : 'bg-warning-soft text-warning border-warning/25'
    : 'bg-muted text-muted-foreground border-border';

  return (
    <div
      role="banner"
      className="relative flex h-12 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-topbar-background px-3 text-xs text-topbar-foreground xl:h-14 xl:gap-3 xl:px-4"
    >
      {/* Desktop: branch context + shift state (always visible — ADR-023 global context) */}
      <div className="hidden min-w-0 flex-1 items-center gap-2.5 xl:flex">
        <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2">
          <span className="whitespace-nowrap text-muted-foreground">الفرع</span>
          <BranchSwitcher />
        </div>

        {hasOpenShift && operationalBranch ? (
          <div
            className={`flex h-8 min-w-0 items-center gap-2 rounded-lg border px-2.5 ${shiftTone}`}
            title={
              viewMatchesOperational
                ? `تعمل في ${opLabel}`
                : `عرض ${viewLabel} — تعمل في ${opLabel}`
            }
          >
            <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
            <span className="whitespace-nowrap font-semibold">تعمل في {opLabel}</span>
            <span className="num whitespace-nowrap opacity-80">
              وردية مفتوحة
              {elapsed ? ` • ${elapsed}` : startedAt && mounted ? ` • منذ ${startedAt}` : ''}
            </span>
          </div>
        ) : (
          <div className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 ${shiftTone}`}>
            <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
            <span className="whitespace-nowrap">لا توجد وردية مفتوحة</span>
          </div>
        )}

        {hasOpenShift && operationalBranch ? (
          <div className="flex items-center gap-1">
            <OperationalHandoffControl className="h-8 whitespace-nowrap rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary-soft" />
            <button
              type="button"
              onClick={requestEndShift}
              className="h-8 whitespace-nowrap rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
            >
              إنهاء الوردية
            </button>
          </div>
        ) : null}
      </div>

      {/* Compact (< xl): user + state chip opens the operational sheet */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 xl:hidden">
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          className={`flex h-8 min-w-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold ${shiftTone}`}
          aria-label="الحالة التشغيلية"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
          <span className="truncate">{hasOpenShift ? opLabel : 'لا توجد وردية'}</span>
        </button>
        <OperationalHandoffControl
          label="نقل التشغيل"
          className="h-8 whitespace-nowrap rounded-lg bg-primary-soft px-2 text-xs font-semibold text-primary"
        />
      </div>

      {/* End: environment toggle, user, logout */}
      <div className="flex shrink-0 items-center gap-1.5 xl:gap-2">
        {!isPosPage && <DbToggleButton />}
        <div className="hidden h-8 items-center gap-1.5 rounded-lg px-1.5 sm:flex">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
            <User className="size-3.5" aria-hidden />
          </span>
          <span className="max-w-[7rem] truncate font-semibold">{user.UserName}</span>
          {isAdmin ? (
            <ShieldCheck className="size-3.5 shrink-0 text-success" aria-label="مدير" />
          ) : (
            <ShieldAlert className="size-3.5 shrink-0 text-info" aria-label="مستخدم" />
          )}
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={requestLogout}>
          <LogOut aria-hidden />
          خروج
        </Button>
      </div>

      <LogoutConfirmModal
        isOpen={showLogoutModal}
        hasOpenShift={hasOpenShift}
        shiftName={shift?.ShiftName}
        onClose={() => setShowLogoutModal(false)}
        onCloseShiftAndLogout={handleCloseShiftAndLogout}
        onCloseShiftPrintAndLogout={handleCloseShiftPrintAndLogout}
        onLogoutOnly={logout}
      />

      {shiftReconIntent && shift?.ID ? (
        <ShiftCloseReconPanel
          shiftMoveId={shift.ID}
          shiftName={shift.ShiftName}
          onClose={() => setShiftReconIntent(null)}
          onClosed={() => void handleShiftReconClosed()}
        />
      ) : null}

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
