'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  fetchSwitchableBranches,
  performBranchSwitch,
  type ClientActiveBranch,
  type ClientSwitchableBranch,
} from '@/lib/branch/postSwitchClient';

/** Above TopNavPortal (9999) and TopNav menus (10000). */
const DROPDOWN_Z = 12000;

/**
 * Active branch label + optional switcher.
 * One accessible branch → label only.
 * Multiple → dropdown; hard reload after successful switch.
 *
 * Dropdown is portaled to document.body so ActiveSessionBar's overflow-hidden
 * cannot clip it under the content below.
 */
export default function BranchSwitcher() {
  const pathname = usePathname();
  const listboxId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [active, setActive] = useState<ClientActiveBranch | null>(null);
  const [branches, setBranches] = useState<ClientSwitchableBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSwitchableBranches();
      if (!data.ok) {
        setActive(null);
        setBranches([]);
        return;
      }
      setActive(data.activeBranch);
      setBranches(data.branches);
    } catch {
      setError('تعذر تحميل الفروع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const label = active
    ? active.shortName || active.branchName || active.branchCode
    : '—';

  const canSwitch = branches.length > 1 && !switching;

  async function onSelect(branchId: number) {
    if (switching) return;
    if (active && branchId === active.branchId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setError(null);
    const result = await performBranchSwitch({
      branchId,
      currentPathname: pathname,
    });
    if (!result.ok) {
      setSwitching(false);
      if (result.error !== 'CANCELLED') {
        setError(result.message);
      }
      return;
    }
    // Hard navigation in progress — keep loading state
  }

  if (loading && !active) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
        <Building2 className="w-3.5 h-3.5" />
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  }

  if (!active) return null;

  // Single branch — label only, no interactive dropdown
  if (branches.length <= 1) {
    return (
      <div
        className="flex items-center gap-1.5 shrink-0 max-w-[9rem]"
        title={active.branchName}
      >
        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate text-foreground">{label}</span>
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
            className="min-w-[12rem] rounded-md border border-border bg-background shadow-lg py-1"
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              zIndex: DROPDOWN_Z,
            }}
          >
            {branches.map((b) => {
              const itemLabel = b.shortName || b.branchName;
              const isCurrent = b.isCurrent || (active && b.branchId === active.branchId);
              return (
                <button
                  key={b.branchId}
                  type="button"
                  role="option"
                  aria-selected={Boolean(isCurrent)}
                  disabled={Boolean(isCurrent)}
                  onClick={() => void onSelect(b.branchId)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-right text-xs hover:bg-muted disabled:opacity-70"
                >
                  <span className="flex-1 truncate font-medium">{itemLabel}</span>
                  {b.shortName && b.shortName !== b.branchName ? (
                    <span className="text-muted-foreground truncate max-w-[4rem]">{b.branchCode}</span>
                  ) : null}
                  {isCurrent ? <Check className="w-3.5 h-3.5 text-success shrink-0" /> : null}
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
                className="text-[10px] text-destructive bg-background border border-destructive/30 rounded px-2 py-1 whitespace-nowrap shadow-md"
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
        className="flex items-center gap-1.5 max-w-[11rem] rounded px-1.5 py-0.5 hover:bg-muted transition-colors disabled:opacity-60"
        title={active.branchName}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
      >
        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{label}</span>
        {switching ? (
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
      </button>
      {dropdown}
      {errorToast}
    </div>
  );
}
