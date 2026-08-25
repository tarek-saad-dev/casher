'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastItem = { id: number; message: string };

type OperationalToastContextValue = {
  showToast: (message: string) => void;
};

const OperationalToastContext = createContext<OperationalToastContextValue>({
  showToast: () => {},
});

export function useOperationalToast() {
  return useContext(OperationalToastContext);
}

export function OperationalToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const showToast = useCallback((message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-2), { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <OperationalToastContext.Provider value={value}>
      {children}
      {mounted && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed bottom-4 left-1/2 z-[13000] flex w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col gap-2"
              dir="rtl"
            >
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    'pointer-events-auto flex items-start gap-2 rounded-xl border border-success/30',
                    'bg-background/95 px-3 py-2.5 text-sm shadow-lg backdrop-blur-md',
                  )}
                  role="status"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <p className="flex-1 leading-snug text-foreground">{t.message}</p>
                  <button
                    type="button"
                    aria-label="إغلاق"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </OperationalToastContext.Provider>
  );
}
