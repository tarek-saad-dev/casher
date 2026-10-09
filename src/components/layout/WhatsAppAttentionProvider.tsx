'use client';

import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MessageCircle, X } from 'lucide-react';
import { usePathname } from 'next/navigation';

type AttentionItem = {
  conversationId: number | string;
  displayName: string | null;
  phone: string;
  lastMessagePreview: string | null;
  lastMessageAt: string;
  unreadCount: number;
};

type WhatsAppAttentionContextValue = {
  count: number;
  refresh: () => Promise<void>;
};

const WhatsAppAttentionContext =
  createContext<WhatsAppAttentionContextValue | null>(null);

export function useWhatsAppAttention() {
  return useContext(WhatsAppAttentionContext) ?? {
    count: 0,
    refresh: async () => {},
  };
}

export default function WhatsAppAttentionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [toastVisible, setToastVisible] = useState(false);
  const initializedRef = useRef(false);
  const previousCountRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  const count = items.length;
  const latest = items[0] ?? null;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/admin/whatsapp/inbox?filter=unread&limit=200',
        { cache: 'no-store' },
      );

      // Not every authenticated role can access the inbox. Silent fail is
      // intentional: users without access should not see global WhatsApp UI.
      if (!response.ok) return;

      const data = await response.json();
      const nextItems = Array.isArray(data.items)
        ? (data.items as AttentionItem[])
        : [];
      const nextCount = nextItems.length;

      if (
        initializedRef.current
        && nextCount > previousCountRef.current
        && !pathname.startsWith('/admin/whatsapp/inbox')
      ) {
        setToastVisible(true);
        if (toastTimerRef.current) {
          window.clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = window.setTimeout(
          () => setToastVisible(false),
          7000,
        );
      }

      initializedRef.current = true;
      previousCountRef.current = nextCount;
      setItems(nextItems);
    } catch {
      // Global notification should never break the cashier shell.
    }
  }, [pathname]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 10_000);

    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ count, refresh }),
    [count, refresh],
  );

  const onInboxPage = pathname.startsWith('/admin/whatsapp/inbox');

  return (
    <WhatsAppAttentionContext.Provider value={value}>
      {children}

      {!onInboxPage && count > 0 ? (
        <Link
          href="/admin/whatsapp/inbox"
          aria-label={`عندك ${count} محادثات واتساب محتاجة رد`}
          title={`${count} محادثات واتساب محتاجة رد`}
          className="fixed bottom-5 left-5 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_14px_40px_rgba(0,0,0,0.34)] ring-1 ring-white/20 transition hover:scale-105 active:scale-95"
        >
          <MessageCircle className="h-7 w-7 fill-white/10" strokeWidth={2.4} />
          <span className="absolute -right-1 -top-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5 text-[11px] font-black leading-none text-white shadow-lg">
            {count > 99 ? '99+' : count}
          </span>
          <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-[#25D366]/20" />
        </Link>
      ) : null}

      {!onInboxPage && toastVisible && count > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-24 z-[91] w-[min(360px,calc(100vw-7rem))] rounded-2xl border border-emerald-400/20 bg-[#111b21] p-3 text-white shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366]">
              <MessageCircle className="h-5 w-5" />
            </div>
            <Link
              href="/admin/whatsapp/inbox"
              onClick={() => setToastVisible(false)}
              className="min-w-0 flex-1"
            >
              <div className="text-sm font-black">
                {count === 1
                  ? 'رسالة واتساب محتاجة رد'
                  : `${count} محادثات واتساب محتاجة رد`}
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-zinc-300">
                {latest?.displayName || latest?.phone || 'عميل جديد'}
              </div>
              {latest?.lastMessagePreview ? (
                <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-zinc-400">
                  {latest.lastMessagePreview}
                </div>
              ) : null}
            </Link>
            <button
              type="button"
              onClick={() => setToastVisible(false)}
              className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
              aria-label="إغلاق التنبيه"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </WhatsAppAttentionContext.Provider>
  );
}
