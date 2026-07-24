'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  fetchSwitchableBranches,
  performBranchSwitch,
  type ClientActiveBranch,
  type ClientSwitchableBranch,
} from '@/lib/branch/postSwitchClient';

/**
 * Active branch label + optional switcher.
 * One accessible branch → label only.
 * Multiple → dropdown; hard reload after successful switch.
 */
export default function BranchSwitcher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [active, setActive] = useState<ClientActiveBranch | null>(null);
  const [branches, setBranches] = useState<ClientSwitchableBranch[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    void load();
  }, [load]);

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

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={!canSwitch}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 max-w-[11rem] rounded px-1.5 py-0.5 hover:bg-muted transition-colors disabled:opacity-60"
        title={active.branchName}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{label}</span>
        {switching ? (
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && !switching && (
        <div
          className="absolute top-full mt-1 right-0 z-50 min-w-[12rem] rounded-md border border-border bg-background shadow-md py-1"
          role="listbox"
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
        </div>
      )}

      {error ? (
        <div className="absolute top-full mt-1 right-0 z-50 text-[10px] text-destructive bg-background border border-destructive/30 rounded px-2 py-1 whitespace-nowrap">
          {error}
        </div>
      ) : null}
    </div>
  );
}
