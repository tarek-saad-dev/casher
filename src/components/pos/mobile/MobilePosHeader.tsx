'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Scissors,
  RotateCcw,
  MoreVertical,
  Clock,
  Receipt,
  History,
  Menu,
} from 'lucide-react';
import { useMobileNavOptional } from '@/components/layout/MobileNavContext';
import BranchSwitcher from '@/components/session/BranchSwitcher';
import OperationalHandoffControl from '@/components/session/OperationalHandoffControl';
import OperationalMobileSheet from '@/components/session/OperationalMobileSheet';
import { useSession } from '@/hooks/useSession';
import { branchDisplayName } from '@/lib/operations/viewOperationalState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface MobilePosHeaderProps {
  invoiceLabel: string;
  shiftId: number | null;
  shiftName: string | null;
  onNewSale: () => void;
  onOpenRecentSales: () => void;
}

export default function MobilePosHeader({
  invoiceLabel,
  shiftId,
  shiftName,
  onNewSale,
  onOpenRecentSales,
}: MobilePosHeaderProps) {
  const mobileNav = useMobileNavOptional();
  const { operationalBranch, viewMatchesOperational, hasOpenShift, user } = useSession();
  const [time, setTime] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const isAdmin = user?.UserLevel === 'admin';

  useEffect(() => {
    const update = () => {
      setTime(
        new Date().toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex h-14 min-h-[56px] max-h-16 shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur-md pt-[env(safe-area-inset-top)] md:hidden"
        dir="rtl"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Scissors className="h-5 w-5 text-primary-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold leading-tight text-foreground">نقطة البيع</h1>
          <p className="truncate text-[11px] text-muted-foreground">{invoiceLabel}</p>
          <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
            <BranchSwitcher />
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className={`truncate rounded-md px-1.5 py-0.5 text-[10px] ${
                hasOpenShift && operationalBranch
                  ? viewMatchesOperational
                    ? 'bg-success/10 text-success'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
              }`}
              aria-label="الحالة التشغيلية"
            >
              {hasOpenShift && operationalBranch
                ? `● ${branchDisplayName(operationalBranch)}`
                : 'لا توجد وردية'}
            </button>
            <OperationalHandoffControl
              label="نقل"
              className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onNewSale}
          aria-label="فاتورة جديدة"
          className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-border bg-surface-muted px-2.5 text-xs font-medium text-primary transition-colors hover:bg-surface-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RotateCcw className="h-4 w-4 shrink-0" />
          <span className="hidden min-[360px]:inline">فاتورة جديدة</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="المزيد من الإجراءات"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 border-border bg-surface-muted">
            <DropdownMenuItem onClick={onOpenRecentSales} className="min-h-11 text-foreground">
              <History className="ml-2 h-4 w-4" />
              آخر المبيعات
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem asChild className="min-h-11 text-foreground">
              <Link href="/expenses">
                <Receipt className="ml-2 h-4 w-4" />
                المصروفات
              </Link>
            </DropdownMenuItem>
            {isAdmin ? (
              <DropdownMenuItem asChild className="min-h-11 text-foreground">
                <Link href="/admin/operations">
                  <Clock className="ml-2 h-4 w-4" />
                  مركز التشغيل
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem disabled className="min-h-11 text-muted-foreground opacity-100">
              <Clock className="ml-2 h-4 w-4" />
              {shiftId
                ? `وردية${shiftName ? ` — ${shiftName}` : ''}`
                : 'لا توجد وردية مفتوحة'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="min-h-11 text-muted-foreground opacity-100">
              <Clock className="ml-2 h-4 w-4" />
              {time ?? '—'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {mobileNav && (
          <button
            type="button"
            onClick={mobileNav.toggle}
            aria-label="فتح القائمة"
            aria-expanded={mobileNav.isOpen}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
      </header>

      <OperationalMobileSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
