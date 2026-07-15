'use client';

import { useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { CalendarCheck, Loader2, X } from 'lucide-react';

function PanelLoader() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground/70">
      <Loader2 className="ml-2 h-5 w-5 animate-spin" />
      <span className="text-sm">جاري التحميل...</span>
    </div>
  );
}

const AttendancePanel = dynamic(() => import('@/components/hr/AttendancePanel'), {
  ssr: false,
  loading: () => <PanelLoader />,
});

interface AttendancePanelModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AttendancePanelModal({ open, onClose }: AttendancePanelModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // Nested Dialog (freelancer / breaks) owns Escape while open
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" dir="rtl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-bold text-foreground">
          <CalendarCheck className="h-5 w-5 shrink-0 text-primary" />
          <span>متابعة الحضور</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="متابعة الحضور"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-luxury-v sm:px-6"
      >
        <AttendancePanel />
      </div>
    </div>
  );
}
