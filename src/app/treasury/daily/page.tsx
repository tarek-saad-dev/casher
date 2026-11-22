'use client';

import TreasuryDailyView from '@/components/treasury/TreasuryDailyView';
import { useSession } from '@/hooks/useSession';
import { useRouteAccess } from '@/hooks/useRouteAccess';
import { hasPagePermission } from '@/lib/routing/routeRegistry';

/**
 * Daily treasury — one page for treasury staff and cashiers (routing R2).
 * A grant on /treasury/daily gives the full controls; the cashier grant
 * (/cashier/treasury/daily, kept in the permission catalogue) gives the
 * close-shift-only view the old cashier page had. Server APIs re-check.
 */
export default function DailyTreasuryPage() {
  const { shift } = useSession();
  const { access } = useRouteAccess();
  const fullControl = Boolean(
    access &&
      hasPagePermission(
        { isSuperAdmin: access.isSuperAdmin, isPartnerOnly: access.isPartnerOnly, allowedPagePaths: access.allowedPagePaths },
        '/treasury/daily',
      ),
  );

  if (fullControl) {
    return (
      <TreasuryDailyView
        canCloseDay
        canTransfer
        canAddPastRevenue
        canAddPastExpense
        canDeleteMove
        pageTitle="الخزنة"
        pageSubtitle="متابعة الحركات المالية ورصيد الخزنة"
      />
    );
  }

  return (
    <TreasuryDailyView
      canCloseDay={false}
      canCloseShift={true}
      defaultShiftMoveId={shift?.ID ?? null}
      canTransfer={false}
      canAddPastRevenue={false}
      canAddPastExpense={false}
      canDeleteMove={false}
      pageTitle="الخزنة اليومية"
      pageSubtitle="عرض الحركات المالية لليوم وتقفيل الوردية"
    />
  );
}
