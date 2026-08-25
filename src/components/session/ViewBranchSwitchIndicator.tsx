'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getViewBranchSwitchUiState,
  subscribeViewBranchSwitchUi,
  type ViewBranchSwitchUiState,
} from '@/lib/branch/viewBranchSwitchUi';

export default function ViewBranchSwitchIndicator() {
  const [ui, setUi] = useState<ViewBranchSwitchUiState>(() => getViewBranchSwitchUiState());

  useEffect(() => subscribeViewBranchSwitchUi(setUi), []);

  if (!ui.active) return null;

  const message = ui.label
    ? `جاري التبديل إلى ${ui.label}…`
    : 'جاري تبديل الفرع المعروض…';

  return (
    <div
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 border-b border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary backdrop-blur-sm"
      dir="rtl"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="font-medium">{message}</span>
    </div>
  );
}
