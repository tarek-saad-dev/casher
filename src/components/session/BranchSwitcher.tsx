'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  fetchSwitchableBranches,
  performBranchSwitch,
  type ClientSwitchableBranch,
} from '@/lib/branch/postSwitchClient';
import { useSession } from '@/hooks/useSession';
import { branchDisplayName } from '@/lib/operations/viewOperationalState';

/** Above TopNavPortal (9999) and TopNav menus (10000). */
const DROPDOWN_Z = 12000;

/**
 * ViewBranch label + switcher — always driven by SessionProvider bootstrap state.
 */
export default function BranchSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const listboxId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [fallbackBranches, setFallbackBranches] = useState<ClientSwitchableBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const viewBranch = session.viewBranch ?? session.activeBranch;

  const branches = useMemo(() => {
    if (session.branches.length > 0) {
      return session.branches.map((b) => ({
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
        shortName: b.shortName,
        isCurrent: b.branchId === viewBranch?.branchId,
      }));
    }
    return fallbackBranches.map((b) => ({
      ...b,
      isCurrent: b.branchId === viewBranch?.branchId,
    }));
  }, [session.branches, session.revision, viewBranch?.branchId, fallbackBranches]);

  const loadFallback = useCallback(async () => {
    setFallbackLoading(true);
    setError(null);
    try {
      const data = await fetchSwitchableBranches();
      if (!data.ok) {
        setFallbackBranches([]);
        return;
      }
      setFallbackBranches(data.branches);
    } catch {
      setError('تعذر تحميل الفروع');
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (session.loading) return;
    if (session.branches.length > 0 || viewBranch) return;
    void loadFallback();
  }, [session.loading, session.branches.length, viewBranch, loadFallback]);

  const updateMenuPos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    window.addEventListener('resize', updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      window.removeEventListener('resize', updateMenuPos);
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | PointerEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label = branchDisplayName(viewBranch);
  const loading = (session.loading || fallbackLoading) && !viewBranch;
  const canSwitch = branches.length > 1 && !switching;

  async function onSelect(branchId: number) {
    if (switching) return;
    if (viewBranch && branchId === viewBranch.branchId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setError(null);
    setOpen(false);
    const target = branches.find((b) => b.branchId === branchId);
    const targetLabel = target?.shortName || target?.branchName || null;
    const result = await performBranchSwitch({
      branchId,
      targetLabel,
      currentPathname: pathname,
      onSoftSwitch: async () => {
        await session.refresh();
        router.refresh();
      },
    });
    if (!result.ok) {
      setSwitching(false);
      if (result.error !== 'CANCELLED') {
        setError(result.message);
      }
      return;
    }
    if (result.navigation === 'soft') {
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  if (!viewBranch) return null;

  if (branches.length <= 1) {
    return (
      <div
        className="flex max-w-[9rem] shrink-0 items-center gap-1.5"
        title={viewBranch.branchName}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{label}</span>
      </div>
    );
  }

  const dropdown =
    mounted && open && !switching && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            className="min-w-[12rem] rounded-md border border-border bg-background py-1 shadow-lg"
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              zIndex: DROPDOWN_Z,
            }}
          >
            {branches.map((b) => {
              const itemLabel = b.shortName || b.branchName;
              return (
                <button
                  key={b.branchId}
                  type="button"
                  role="option"
                  aria-selected={b.isCurrent}
                  disabled={b.isCurrent}
                  onClick={() => void onSelect(b.branchId)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-right text-xs hover:bg-muted disabled:opacity-70"
                >
                  <span className="flex-1 truncate font-medium">{itemLabel}</span>
                  {b.shortName && b.shortName !== b.branchName ? (
                    <span className="max-w-[4rem] truncate text-muted-foreground">{b.branchCode}</span>
                  ) : null}
                  {b.isCurrent ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  const errorToast =
    mounted && error && buttonRef.current
      ? createPortal(
          (() => {
            const rect = buttonRef.current!.getBoundingClientRect();
            return (
              <div
                className="whitespace-nowrap rounded border border-destructive/30 bg-background px-2 py-1 text-[10px] text-destructive shadow-md"
                style={{
                  position: 'fixed',
                  top: rect.bottom + 4,
                  right: window.innerWidth - rect.right,
                  zIndex: DROPDOWN_Z,
                }}
              >
                {error}
              </div>
            );
          })(),
          document.body,
        )
      : null;

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={!canSwitch}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[11rem] items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-muted disabled:opacity-60"
        title={viewBranch.branchName}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{label}</span>
        {switching ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
      </button>
      {dropdown}
      {errorToast}
    </div>
  );
}
