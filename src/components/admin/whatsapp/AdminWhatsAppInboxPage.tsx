'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw, Send } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { ownershipLabel, type InboxFilter, type InboxListItem } from '@/modules/messaging/handoff/domain/inboxRanking';

type InboxMessage = {
  messageId: number;
  direction: 'inbound' | 'outbound';
  origin: string;
  text: string | null;
  occurredAt: string;
  deliveryStatus: string | null;
};

type ConversationDetail = InboxListItem & {
  messages: InboxMessage[];
  humanLeaseUntil: string | null;
  ownershipLabel?: string;
};

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'needs_takeover', label: 'محتاج استلام' },
  { id: 'human', label: 'مع موظف' },
  { id: 'bot', label: 'مع البوت' },
  { id: 'unread', label: 'غير مقروء' },
];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return iso;
  }
}

function bubbleMeta(origin: string): string | null {
  if (origin === 'HUMAN_ERP') return 'ERP';
  if (origin === 'HUMAN_WHATSAPP') return 'واتساب';
  if (origin === 'HANDOFF_ACK') return null;
  return null;
}

export default function AdminWhatsAppInboxPage() {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<InboxListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ filter, q, limit: '100' });
      const res = await fetch(`/api/admin/whatsapp/inbox?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل المحادثات');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, [filter, q]);

  const loadDetail = useCallback(async (id: number, afterMessageId?: number) => {
    const params = afterMessageId ? `?afterMessageId=${afterMessageId}` : '';
    const res = await fetch(`/api/admin/whatsapp/inbox/${id}${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحميل المحادثة');
    const conversation = data.conversation as ConversationDetail;
    if (afterMessageId && detail?.conversationId === id) {
      const known = new Set(detail.messages.map((m) => m.messageId));
      const merged = [
        ...detail.messages,
        ...conversation.messages.filter((m) => !known.has(m.messageId)),
      ];
      setDetail({ ...conversation, messages: merged });
    } else {
      setDetail(conversation);
    }
    void fetch(`/api/admin/whatsapp/inbox/${id}/read`, { method: 'POST' });
  }, [detail]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadList();
      const id = selectedIdRef.current;
      if (id != null) {
        const last = detail?.conversationId === id
          ? detail.messages[detail.messages.length - 1]?.messageId
          : undefined;
        void loadDetail(id, last);
      }
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList, detail?.conversationId, detail?.messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages.length]);

  const openConversation = async (id: number) => {
    setSelectedId(id);
    setConfirmReturn(false);
    setError(null);
    try {
      await loadDetail(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const takeover = async () => {
    if (!selectedId) return;
    setError(null);
    const res = await fetch(`/api/admin/whatsapp/inbox/${selectedId}/takeover`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'تعذر الاستلام');
      await loadDetail(selectedId);
      await loadList();
      return;
    }
    await loadDetail(selectedId);
    await loadList();
  };

  const returnToBot = async () => {
    if (!selectedId) return;
    if (!confirmReturn) {
      setConfirmReturn(true);
      return;
    }
    setConfirmReturn(false);
    setError(null);
    const res = await fetch(`/api/admin/whatsapp/inbox/${selectedId}/return`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'تعذر الإرجاع');
      return;
    }
    await loadDetail(selectedId);
    await loadList();
  };

  const send = async () => {
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/inbox/${selectedId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الإرسال');
      setDraft('');
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const composerEnabled = detail?.mode === 'HUMAN';
  const needsTakeover = detail?.mode === 'BOT' || detail?.mode === 'HUMAN_REQUESTED';

  const headerLabel = useMemo(() => {
    if (!detail) return '';
    return detail.ownershipLabel || ownershipLabel(detail);
  }, [detail]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="صندوق وارد واتساب"
          description="استلام المحادثات من البوت أو من الهاتف، والرد كاستقبال"
        />
        <div className="flex items-center gap-2">
          <Link
            href="/admin/whatsapp"
            className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4" />
            إعدادات واتساب
          </Link>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadList()}>
            <RefreshCw className={`h-4 w-4 ${loadingList ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-[70vh] grid-cols-1 gap-3 lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col rounded-xl border border-border bg-background/40">
          <div className="space-y-2 border-b border-border p-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`rounded-md px-2 py-1 text-xs ${
                    filter === f.id
                      ? 'bg-primary/20 text-primary'
                      : 'bg-zinc-900 text-zinc-400 hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => {
              const active = item.conversationId === selectedId;
              return (
                <button
                  key={item.conversationId}
                  type="button"
                  onClick={() => void openConversation(item.conversationId)}
                  className={`block w-full border-b border-border/60 px-3 py-3 text-right transition-colors ${
                    active ? 'bg-primary/10' : 'hover:bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.displayName || item.phone}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{item.lastMessagePreview || '—'}</p>
                    </div>
                    <div className="shrink-0 text-left">
                      <p className="text-[10px] text-zinc-500">{formatTime(item.lastMessageAt)}</p>
                      {item.unreadCount > 0 ? (
                        <span className="mt-1 inline-flex rounded-full bg-emerald-600 px-1.5 text-[10px] text-white">
                          {item.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-300/90">{ownershipLabel(item)}</p>
                </button>
              );
            })}
            {items.length === 0 ? (
              <p className="p-4 text-center text-sm text-zinc-500">لا توجد محادثات</p>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-[60vh] flex-col rounded-xl border border-border bg-background/40">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              اختر محادثة من القائمة
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold">
                    {detail.displayName || detail.phone}
                  </h2>
                  <p className="text-xs text-zinc-400">{detail.phone}</p>
                  <p className="mt-1 text-xs text-amber-300">{headerLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {needsTakeover ? (
                    <Button type="button" onClick={() => void takeover()}>
                      استلام المحادثة
                    </Button>
                  ) : null}
                  {detail.mode === 'HUMAN' || detail.mode === 'HUMAN_REQUESTED' ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void returnToBot()}
                      className={confirmReturn ? 'border-amber-500 text-amber-300' : ''}
                    >
                      {confirmReturn ? 'تأكيد الإرجاع' : 'إرجاع للبوت'}
                    </Button>
                  ) : null}
                </div>
              </header>

              {detail.mode === 'HUMAN_REQUESTED' ? (
                <div className="border-b border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200">
                  محتاج استلام — العميل طلب الاستقبال
                </div>
              ) : null}

              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {detail.messages.map((m) => {
                  const mine = m.direction === 'outbound';
                  const meta = bubbleMeta(m.origin);
                  return (
                    <div
                      key={m.messageId}
                      className={`flex ${mine ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          mine
                            ? m.origin === 'BOT' || m.origin === 'HANDOFF_ACK'
                              ? 'bg-zinc-800 text-zinc-100'
                              : 'bg-primary/20 text-foreground'
                            : 'bg-emerald-950/50 text-emerald-50'
                        }`}
                      >
                        {meta ? (
                          <p className="mb-0.5 text-[10px] text-zinc-400">{meta}</p>
                        ) : null}
                        <p className="whitespace-pre-wrap">{m.text || '—'}</p>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                          <span>{formatTime(m.occurredAt)}</span>
                          {m.deliveryStatus ? <span>{m.deliveryStatus}</span> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <footer className="border-t border-border p-3">
                {!composerEnabled ? (
                  <p className="mb-2 text-xs text-zinc-500">
                    استلم المحادثة أولاً عشان تقدر تبعت كاستقبال.
                  </p>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    disabled={!composerEnabled || sending}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="اكتب رسالة..."
                    rows={2}
                    className="min-h-[64px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                  />
                  <Button
                    type="button"
                    disabled={!composerEnabled || sending || !draft.trim()}
                    onClick={() => void send()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
