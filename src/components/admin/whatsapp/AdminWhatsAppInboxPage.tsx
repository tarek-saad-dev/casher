'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';
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

const NEAR_BOTTOM_PX = 96;

function formatListTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate()
    ) {
      return 'أمس';
    }
    return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

function formatBubbleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function bubbleMeta(origin: string): string | null {
  if (origin === 'HUMAN_ERP') return 'ERP';
  if (origin === 'HUMAN_WHATSAPP') return 'واتساب';
  if (origin === 'BOT') return 'بوت';
  if (origin === 'HANDOFF_ACK') return null;
  return null;
}

function initials(name: string | null, phone: string): string {
  const source = (name || phone || '?').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function modeDotClass(mode: InboxListItem['mode']): string {
  if (mode === 'HUMAN_REQUESTED') return 'bg-amber-400';
  if (mode === 'HUMAN') return 'bg-emerald-400';
  return 'bg-zinc-500';
}

function isNearBottom(pane: HTMLElement): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= NEAR_BOTTOM_PX;
}

export default function AdminWhatsAppInboxPage() {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<InboxListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [showNewBelow, setShowNewBelow] = useState(false);

  const messagesPaneRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const selectedIdRef = useRef<number | null>(null);
  const lastMessageIdRef = useRef<number | undefined>(undefined);
  const messageCountRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  selectedIdRef.current = selectedId;

  useEffect(() => {
    const t = window.setTimeout(() => setQ(searchInput), 280);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  /** Only scroll the messages pane — never scrollIntoView (that scrolls `<main>`). */
  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const pane = messagesPaneRef.current;
    if (!pane) return;
    if (behavior === 'smooth' && typeof pane.scrollTo === 'function') {
      pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
    } else {
      pane.scrollTop = pane.scrollHeight;
    }
    stickToBottomRef.current = true;
    setShowNewBelow(false);
  }, []);

  const onMessagesScroll = useCallback(() => {
    const pane = messagesPaneRef.current;
    if (!pane) return;
    const near = isNearBottom(pane);
    stickToBottomRef.current = near;
    if (near) setShowNewBelow(false);
  }, []);

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
    if (selectedIdRef.current !== id) return;

    const conversation = data.conversation as ConversationDetail;

    setDetail((prev) => {
      if (afterMessageId && prev?.conversationId === id) {
        const known = new Set(prev.messages.map((m) => m.messageId));
        const merged = [
          ...prev.messages,
          ...conversation.messages.filter((m) => !known.has(m.messageId)),
        ];
        const lastMerged = merged[merged.length - 1]?.messageId;
        if (lastMerged != null) lastMessageIdRef.current = lastMerged;
        return { ...conversation, messages: merged };
      }
      const last = conversation.messages[conversation.messages.length - 1]?.messageId;
      if (last != null) lastMessageIdRef.current = last;
      return conversation;
    });

    void fetch(`/api/admin/whatsapp/inbox/${id}/read`, { method: 'POST' });
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList();
      const id = selectedIdRef.current;
      if (id != null) {
        void loadDetail(id, lastMessageIdRef.current);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadList, loadDetail]);

  // Keep latest in view when pinned; otherwise surface "رسائل جديدة" without yanking scroll.
  useEffect(() => {
    if (!detail || detail.conversationId !== selectedId) return;

    const len = detail.messages.length;
    const prevLen = messageCountRef.current;
    const grew = len > prevLen;
    messageCountRef.current = len;

    if (len === 0) return;

    if (stickToBottomRef.current) {
      const behavior: ScrollBehavior = grew && prevLen > 0 ? 'smooth' : 'auto';
      // Double rAF: layout paints message nodes before we read scrollHeight.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollMessagesToBottom(behavior));
      });
      return;
    }

    if (grew && prevLen > 0) {
      setShowNewBelow(true);
    }
  }, [detail?.messages.length, detail?.conversationId, selectedId, scrollMessagesToBottom]);

  const openConversation = async (id: number) => {
    if (id === selectedId && detail?.conversationId === id) return;

    setSelectedId(id);
    setConfirmReturn(false);
    setError(null);
    setDraft('');
    setDetail(null);
    setLoadingDetail(true);
    setShowNewBelow(false);
    stickToBottomRef.current = true;
    lastMessageIdRef.current = undefined;
    messageCountRef.current = 0;

    try {
      await loadDetail(id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollMessagesToBottom('auto'));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
      composerRef.current?.focus();
    }
  };

  const closeConversation = () => {
    setSelectedId(null);
    setDetail(null);
    setConfirmReturn(false);
    setDraft('');
    setShowNewBelow(false);
    lastMessageIdRef.current = undefined;
    messageCountRef.current = 0;
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
    composerRef.current?.focus();
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
    stickToBottomRef.current = true;
    setShowNewBelow(false);
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
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollMessagesToBottom('smooth'));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  };

  const composerEnabled = detail?.mode === 'HUMAN';
  const needsTakeover = detail?.mode === 'BOT' || detail?.mode === 'HUMAN_REQUESTED';

  const headerLabel = useMemo(() => {
    if (!detail) return '';
    return detail.ownershipLabel || ownershipLabel(detail);
  }, [detail]);

  const selectedListItem = useMemo(
    () => items.find((i) => i.conversationId === selectedId) ?? null,
    [items, selectedId],
  );

  const chatTitle =
    detail?.displayName ||
    detail?.phone ||
    selectedListItem?.displayName ||
    selectedListItem?.phone ||
    '';

  const chatPhone = detail?.phone || selectedListItem?.phone || '';
  const chatOpen = selectedId != null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b141a] text-zinc-100" dir="rtl">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-[#202c33] px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold sm:text-base">صندوق وارد واتساب</h1>
          <p className="hidden truncate text-[11px] text-zinc-400 sm:block">
            استلام والرد كاستقبال — زي واتساب
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/admin/whatsapp"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">إعدادات</span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-zinc-300 hover:bg-white/5"
            onClick={() => void loadList()}
            aria-label="تحديث"
          >
            <RefreshCw className={`h-4 w-4 ${loadingList ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-rose-500/30 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          {error}
          <button
            type="button"
            className="ms-2 underline"
            onClick={() => setError(null)}
          >
            إخفاء
          </button>
        </div>
      ) : null}

      {/* Two independent columns (RTL: aside = right). Never let this row grow the page. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* RIGHT — conversation sidebar */}
        <aside
          className={`flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-white/5 bg-[#111b21] lg:w-[380px] lg:border-e ${
            chatOpen ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="shrink-0 space-y-2 border-b border-white/5 px-3 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="بحث بالاسم أو الهاتف"
                className="w-full rounded-lg border-0 bg-[#202c33] py-2 pe-3 ps-9 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-0 focus:ring-1 focus:ring-emerald-700/60"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    filter === f.id
                      ? 'bg-emerald-700/40 text-emerald-100'
                      : 'bg-[#202c33] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-luxury-v">
            {items.map((item) => {
              const active = item.conversationId === selectedId;
              const urgent = item.mode === 'HUMAN_REQUESTED';
              return (
                <button
                  key={item.conversationId}
                  type="button"
                  onClick={() => void openConversation(item.conversationId)}
                  className={`flex w-full items-center gap-3 border-b border-white/4 px-3 py-3 text-right transition-colors ${
                    active
                      ? 'bg-[#2a3942]'
                      : urgent
                        ? 'bg-amber-950/25 hover:bg-amber-950/40'
                        : 'hover:bg-white/3'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#6b7c85] text-sm font-semibold text-white">
                      {initials(item.displayName, item.phone)}
                    </div>
                    <span
                      className={`absolute bottom-0 end-0 h-2.5 w-2.5 rounded-full border-2 border-[#111b21] ${modeDotClass(item.mode)}`}
                      title={ownershipLabel(item)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[15px] font-medium text-zinc-100">
                        {item.displayName || item.phone}
                      </p>
                      <span
                        className={`shrink-0 text-[11px] ${
                          item.unreadCount > 0 ? 'text-emerald-400' : 'text-zinc-500'
                        }`}
                      >
                        {formatListTime(item.lastMessageAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] text-zinc-400">
                        {item.lastMessagePreview || '—'}
                      </p>
                      {item.unreadCount > 0 ? (
                        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">
                          {item.unreadCount > 99 ? '99+' : item.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {ownershipLabel(item)}
                    </p>
                  </div>
                </button>
              );
            })}
            {items.length === 0 && !loadingList ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-zinc-500">
                <MessageCircle className="h-10 w-10 opacity-40" />
                <p className="text-sm">لا توجد محادثات</p>
              </div>
            ) : null}
            {loadingList && items.length === 0 ? (
              <p className="p-6 text-center text-sm text-zinc-500">جاري التحميل…</p>
            ) : null}
          </div>
        </aside>

        {/* LEFT / main — selected chat (independent scroll) */}
        <section
          className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0b141a] ${
            chatOpen ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {!chatOpen ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-s border-white/5 bg-[#222e35] px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#202c33]">
                <MessageCircle className="h-8 w-8 text-zinc-500" />
              </div>
              <p className="text-lg font-medium text-zinc-300">صندوق واتساب</p>
              <p className="max-w-sm text-sm text-zinc-500">
                اختر محادثة من القائمة عشان تفتح الشات. السكرول والقائمة مستقلين زي واتساب.
              </p>
            </div>
          ) : (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-white/5 bg-[#202c33] px-2 py-2 sm:gap-3 sm:px-4">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-300 hover:bg-white/5 lg:hidden"
                  onClick={closeConversation}
                  aria-label="رجوع للقائمة"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#6b7c85] text-sm font-semibold text-white">
                  {initials(
                    detail?.displayName ?? selectedListItem?.displayName ?? null,
                    chatPhone,
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold leading-tight">
                    {chatTitle || '…'}
                  </h2>
                  <p className="truncate text-[12px] text-zinc-400">
                    {loadingDetail && !detail
                      ? 'جاري التحميل…'
                      : headerLabel || chatPhone}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {detail && needsTakeover ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-emerald-700 text-xs hover:bg-emerald-600"
                      onClick={() => void takeover()}
                    >
                      استلام
                    </Button>
                  ) : null}
                  {detail && (detail.mode === 'HUMAN' || detail.mode === 'HUMAN_REQUESTED') ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void returnToBot()}
                      className={`h-8 border-white/10 bg-transparent text-xs hover:bg-white/5 ${
                        confirmReturn ? 'border-amber-500 text-amber-300' : 'text-zinc-300'
                      }`}
                    >
                      {confirmReturn ? 'تأكيد الإرجاع' : 'إرجاع للبوت'}
                    </Button>
                  ) : null}
                </div>
              </header>

              {detail?.mode === 'HUMAN_REQUESTED' ? (
                <div className="shrink-0 border-b border-amber-500/20 bg-amber-950/40 px-4 py-2 text-center text-xs text-amber-200">
                  محتاج استلام — العميل طلب الاستقبال
                </div>
              ) : null}

              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  ref={messagesPaneRef}
                  onScroll={onMessagesScroll}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-8 scrollbar-luxury-v"
                  style={{
                    minHeight: 0,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    backgroundImage:
                      'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.02) 0, transparent 40%), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.015) 0, transparent 35%)',
                  }}
                >
                  {loadingDetail && !detail ? (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                      جاري فتح المحادثة…
                    </div>
                  ) : null}

                  {detail ? (
                    <div className="mx-auto flex max-w-3xl flex-col gap-1.5" dir="ltr">
                      {detail.messages.map((m) => {
                        const mine = m.direction === 'outbound';
                        const meta = bubbleMeta(m.origin);
                        const botish = m.origin === 'BOT' || m.origin === 'HANDOFF_ACK';
                        return (
                          <div
                            key={m.messageId}
                            className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`relative max-w-[min(85%,28rem)] rounded-lg px-2.5 pb-1.5 pt-1.5 text-[14.2px] leading-snug shadow-sm ${
                                mine
                                  ? botish
                                    ? 'rounded-tr-none bg-[#202c33] text-zinc-100'
                                    : 'rounded-tr-none bg-[#005c4b] text-zinc-50'
                                  : 'rounded-tl-none bg-[#202c33] text-zinc-100'
                              }`}
                              dir="auto"
                            >
                              {meta ? (
                                <p className="mb-0.5 text-[10px] font-medium text-emerald-300/80">
                                  {meta}
                                </p>
                              ) : null}
                              <p className="whitespace-pre-wrap wrap-break-word">{m.text || '—'}</p>
                              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-400/90">
                                <span>{formatBubbleTime(m.occurredAt)}</span>
                                {mine ? (
                                  <CheckCheck
                                    className={`h-3.5 w-3.5 ${
                                      m.deliveryStatus === 'read' || m.deliveryStatus === 'READ'
                                        ? 'text-sky-400'
                                        : 'text-zinc-400/80'
                                    }`}
                                  />
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {showNewBelow ? (
                  <button
                    type="button"
                    onClick={() => scrollMessagesToBottom('smooth')}
                    className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#202c33] px-3 py-1.5 text-xs font-medium text-emerald-200 shadow-lg ring-1 ring-white/10 hover:bg-[#2a3942]"
                  >
                    رسائل جديدة
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              <footer className="shrink-0 border-t border-white/5 bg-[#202c33] px-2 py-2 sm:px-3">
                {!composerEnabled && detail ? (
                  <p className="mb-1.5 px-1 text-center text-[11px] text-zinc-500">
                    استلم المحادثة أولاً عشان تقدر تبعت كاستقبال.
                  </p>
                ) : null}
                <div className="mx-auto flex max-w-3xl items-end gap-2">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    disabled={!composerEnabled || sending || !detail}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={
                      composerEnabled ? 'اكتب رسالة…' : 'الاستلام مطلوب قبل الإرسال'
                    }
                    rows={1}
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border-0 bg-[#2a3942] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-emerald-700/50 disabled:opacity-50"
                  />
                  <Button
                    type="button"
                    disabled={!composerEnabled || sending || !draft.trim()}
                    onClick={() => void send()}
                    className="h-11 w-11 shrink-0 rounded-full bg-emerald-700 p-0 hover:bg-emerald-600 disabled:opacity-40"
                    aria-label="إرسال"
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
