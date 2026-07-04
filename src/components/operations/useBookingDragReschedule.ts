'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  DRAG_ACTIVATION_PX,
  LARGE_MOVE_CONFIRM_MINUTES,
  UNDO_TIMEOUT_MS,
  formatMinutesDeltaLabel,
  isBookingDraggable,
  pixelDeltaToMinutes,
  snapDateTimeByMinutes,
  type TimelineItem,
} from './schedulerUtils';
import {
  commitBookingMove,
  evaluateLocalBookingMove,
  validateMoveOnServer,
  type DragPreviewState,
} from '@/lib/bookingDragReschedule';

export interface ActiveDragState {
  item: TimelineItem;
  empId: number;
  empName: string;
  originalStartIso: string;
  originalEndIso: string;
  proposedStartIso: string;
  proposedEndIso: string;
  deltaMinutes: number;
  previewState: DragPreviewState;
  previewMessage?: string;
  laneRect: DOMRect;
  cardHeightPx: number;
  cardTopPx: number;
  isCommitting: boolean;
}

interface BarberLaneInfo {
  empId: number;
  empName: string;
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  timeline: TimelineItem[];
}

interface UseBookingDragRescheduleArgs {
  operationalDate?: string;
  barbers: BarberLaneInfo[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onRefresh?: () => void;
  onToast?: (message: string, ok: boolean, undo?: () => void) => void;
}

export function useBookingDragReschedule({
  operationalDate,
  barbers,
  scrollRef,
  onRefresh,
  onToast,
}: UseBookingDragRescheduleArgs) {
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null);
  const [confirmMove, setConfirmMove] = useState<{
    item: TimelineItem;
    proposedStartIso: string;
    proposedEndIso: string;
    originalStartIso: string;
    originalEndIso: string;
    label: string;
  } | null>(null);
  const [isConfirmingMove, setIsConfirmingMove] = useState(false);
  const [dragPressBookingId, setDragPressBookingId] = useState<number | null>(null);

  const pointerRef = useRef<{
    startY: number;
    startX: number;
    activated: boolean;
    item: TimelineItem;
    empId: number;
    empName: string;
    laneRect: DOMRect;
    cardTopPx: number;
    cardHeightPx: number;
    originalStartIso: string;
    originalEndIso: string;
    deltaPx: number;
    previewState: DragPreviewState;
    proposedStartIso: string;
    previewMessage?: string;
    pointerId: number;
    captureEl: HTMLElement | null;
  } | null>(null);

  const suppressClickRef = useRef(false);
  const windowListenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);

  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValidatedSlotRef = useRef<string | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getBarber = useCallback(
    (empId: number) => barbers.find((b) => b.empId === empId),
    [barbers],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  const runAutoScroll = useCallback((clientY: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = 56;
    const maxSpeed = 12;

    let speed = 0;
    if (clientY < rect.top + edge) {
      speed = -maxSpeed * (1 - (clientY - rect.top) / edge);
    } else if (clientY > rect.bottom - edge) {
      speed = maxSpeed * (1 - (rect.bottom - clientY) / edge);
    }

    if (speed === 0) {
      stopAutoScroll();
      return;
    }

    el.scrollTop += speed;
    autoScrollRef.current = requestAnimationFrame(() => runAutoScroll(clientY));
  }, [scrollRef, stopAutoScroll]);

  const scheduleServerValidate = useCallback(
    (bookingId: number, proposedStartIso: string) => {
      if (!operationalDate) return;
      if (lastValidatedSlotRef.current === proposedStartIso) return;
      lastValidatedSlotRef.current = proposedStartIso;

      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
      validateTimerRef.current = setTimeout(async () => {
        setActiveDrag((prev) =>
          prev && prev.item.sourceId === bookingId
            ? { ...prev, previewState: 'checking' }
            : prev,
        );

        const result = await validateMoveOnServer({
          bookingId,
          newStartAt: proposedStartIso,
          operationalDate,
        });

        setActiveDrag((prev) => {
          if (!prev || prev.item.sourceId !== bookingId) return prev;
          if (result.valid) {
            const next = {
              ...prev,
              previewState: 'available' as const,
              previewMessage: undefined,
              proposedStartIso: result.newStartAt ?? prev.proposedStartIso,
              proposedEndIso: result.newEndAt ?? prev.proposedEndIso,
            };
            if (pointerRef.current?.item.sourceId === bookingId) {
              pointerRef.current.previewState = 'available';
              pointerRef.current.proposedStartIso = next.proposedStartIso;
            }
            return next;
          }
          const nextState = result.message?.includes('خارج') ? 'outside' as const : 'conflict' as const;
          if (pointerRef.current?.item.sourceId === bookingId) {
            pointerRef.current.previewState = nextState;
          }
          return {
            ...prev,
            previewState: nextState,
            previewMessage: result.message,
          };
        });
      }, 180);
    },
    [operationalDate],
  );

  const updateDragPreview = useCallback(
    (deltaPx: number) => {
      const ptr = pointerRef.current;
      if (!ptr || !operationalDate) return;

      const deltaMinutes = snapDeltaMinutes(pixelDeltaToMinutes(deltaPx));
      const proposedStartIso = snapDateTimeByMinutes(ptr.originalStartIso, deltaMinutes);
      const durationMs =
        new Date(ptr.originalEndIso).getTime() - new Date(ptr.originalStartIso).getTime();
      const proposedEndIso = new Date(
        new Date(proposedStartIso).getTime() + durationMs,
      ).toISOString();

      const barber = getBarber(ptr.empId);
      const local = barber
        ? evaluateLocalBookingMove({
            proposedStartIso,
            proposedEndIso,
            busyItems: barber.timeline,
            excludeBookingId: ptr.item.sourceId,
            workStart: barber.workStart,
            workEnd: barber.workEnd,
            isOvernightShift: barber.isOvernightShift,
          })
        : { state: 'checking' as const };

      const previewState: DragPreviewState =
        local.state === 'available' ? 'checking' : local.state;

      setActiveDrag({
        item: ptr.item,
        empId: ptr.empId,
        empName: ptr.empName,
        originalStartIso: ptr.originalStartIso,
        originalEndIso: ptr.originalEndIso,
        proposedStartIso,
        proposedEndIso,
        deltaMinutes,
        previewState,
        previewMessage: local.reason,
        laneRect: ptr.laneRect,
        cardHeightPx: ptr.cardHeightPx,
        cardTopPx: ptr.cardTopPx + deltaPx,
        isCommitting: false,
      });

      if (local.state === 'available') {
        scheduleServerValidate(ptr.item.sourceId, proposedStartIso);
      }

      ptr.proposedStartIso = proposedStartIso;
      ptr.previewState = previewState;
      ptr.previewMessage = local.reason;
    },
    [getBarber, operationalDate, scheduleServerValidate],
  );

  const executeCommit = useCallback(
    async (args: {
      item: TimelineItem;
      proposedStartIso: string;
      originalStartIso: string;
      originalEndIso: string;
      customerName?: string;
    }) => {
      if (!operationalDate) return;

      setActiveDrag((prev) =>
        prev ? { ...prev, isCommitting: true } : prev,
      );

      const result = await commitBookingMove({
        bookingId: args.item.sourceId,
        newStartAt: args.proposedStartIso,
        operationalDate,
      });

      setActiveDrag(null);

      if (!result.ok) {
        onToast?.(result.message ?? 'فشل نقل الموعد', false);
        return;
      }

      setConfirmMove(null);

      onRefresh?.();

      const customer = args.customerName || args.item.customerName || 'العميل';
      const oldTime = formatArabicTime(args.originalStartIso);
      const newTime = formatArabicTime(result.newStartAt ?? args.proposedStartIso);
      const message = `تم نقل موعد ${customer} من ${oldTime} إلى ${newTime}`;

      const undoFn = () => {
        commitBookingMove({
          bookingId: args.item.sourceId,
          newStartAt: args.originalStartIso,
          operationalDate,
          source: 'operations_drag_drop_undo',
        }).then((undoResult) => {
          if (undoResult.ok) {
            onRefresh?.();
            onToast?.('تم التراجع عن نقل الموعد', true);
          } else {
            onToast?.('تعذر التراجع لأن الوقت السابق لم يعد متاحًا', false);
          }
        });
      };

      onToast?.(message, true, undoFn);

      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => {
        undoTimerRef.current = null;
      }, UNDO_TIMEOUT_MS);
    },
    [operationalDate, onRefresh, onToast],
  );

  const detachWindowDragListeners = useCallback(() => {
    const listeners = windowListenersRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.up);
    window.removeEventListener('pointercancel', listeners.up);
    windowListenersRef.current = null;
  }, []);

  const releasePointerCapture = useCallback(() => {
    const ptr = pointerRef.current;
    if (!ptr?.captureEl) return;
    try {
      ptr.captureEl.releasePointerCapture(ptr.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const resetPointerSession = useCallback(() => {
    detachWindowDragListeners();
    releasePointerCapture();
    pointerRef.current = null;
    setDragPressBookingId(null);
    lastValidatedSlotRef.current = null;
  }, [detachWindowDragListeners, releasePointerCapture]);

  const finishPointerDrag = useCallback(
    (ptr: NonNullable<typeof pointerRef.current>) => {
      const previewState = ptr.previewState;
      const proposedStartIso = ptr.proposedStartIso;

      if (previewState === 'conflict' || previewState === 'outside') {
        onToast?.(
          ptr.previewMessage ?? activeDrag?.previewMessage ?? 'لا يمكن نقل الموعد: الفترة غير متاحة',
          false,
        );
        setActiveDrag(null);
        return;
      }

      if (previewState !== 'available' && previewState !== 'checking') {
        setActiveDrag(null);
        return;
      }

      const deltaMinutes = snapDeltaMinutes(pixelDeltaToMinutes(ptr.deltaPx));
      if (deltaMinutes === 0) {
        setActiveDrag(null);
        return;
      }

      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);

      const durationMs =
        new Date(ptr.originalEndIso).getTime() - new Date(ptr.originalStartIso).getTime();
      const proposedEndIso = new Date(
        new Date(proposedStartIso).getTime() + durationMs,
      ).toISOString();

      const absDelta = Math.abs(deltaMinutes);
      if (absDelta > LARGE_MOVE_CONFIRM_MINUTES) {
        setConfirmMove({
          item: ptr.item,
          proposedStartIso,
          proposedEndIso,
          originalStartIso: ptr.originalStartIso,
          originalEndIso: ptr.originalEndIso,
          label: formatMoveLabel(ptr.originalStartIso, proposedStartIso, deltaMinutes),
        });
        setActiveDrag(null);
        return;
      }

      void executeCommit({
        item: ptr.item,
        proposedStartIso,
        originalStartIso: ptr.originalStartIso,
        originalEndIso: ptr.originalEndIso,
        customerName: ptr.item.customerName,
      });
    },
    [activeDrag?.previewMessage, executeCommit, onToast],
  );

  const attachWindowDragSession = useCallback(() => {
    if (windowListenersRef.current) return;

    const onWindowMove = (e: PointerEvent) => {
      const ptr = pointerRef.current;
      if (!ptr || e.pointerId !== ptr.pointerId) return;

      const deltaY = e.clientY - ptr.startY;
      const deltaX = e.clientX - ptr.startX;

      if (!ptr.activated) {
        const absY = Math.abs(deltaY);
        const absX = Math.abs(deltaX);
        if (absY < DRAG_ACTIVATION_PX && absY <= absX) return;

        ptr.activated = true;
        setDragPressBookingId(null);

        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(8);
        }
      }

      e.preventDefault();
      ptr.deltaPx = deltaY;
      updateDragPreview(deltaY);
      runAutoScroll(e.clientY);
    };

    const onWindowUp = (e: PointerEvent) => {
      const ptr = pointerRef.current;
      if (!ptr || e.pointerId !== ptr.pointerId) return;

      stopAutoScroll();
      const snapshot = { ...ptr };
      resetPointerSession();

      if (snapshot.activated) {
        finishPointerDrag(snapshot);
      } else {
        setActiveDrag(null);
      }
    };

    windowListenersRef.current = { move: onWindowMove, up: onWindowUp };
    window.addEventListener('pointermove', onWindowMove, { passive: false });
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
  }, [finishPointerDrag, resetPointerSession, runAutoScroll, stopAutoScroll, updateDragPreview]);

  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      item: TimelineItem,
      empId: number,
      empName: string,
      laneEl: HTMLElement,
      cardTopPx: number,
      cardHeightPx: number,
    ) => {
      if (!isBookingDraggable(item)) return;
      e.stopPropagation();

      resetPointerSession();

      const captureEl = e.currentTarget as HTMLElement;
      pointerRef.current = {
        startY: e.clientY,
        startX: e.clientX,
        activated: false,
        item,
        empId,
        empName,
        laneRect: laneEl.getBoundingClientRect(),
        cardTopPx,
        cardHeightPx,
        originalStartIso: item.startTime,
        originalEndIso: item.endTime,
        deltaPx: 0,
        previewState: 'checking',
        proposedStartIso: item.startTime,
        pointerId: e.pointerId,
        captureEl,
      };

      setDragPressBookingId(item.sourceId);

      try {
        captureEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      attachWindowDragSession();
    },
    [attachWindowDragSession, resetPointerSession],
  );

  const shouldSuppressCardClick = useCallback(() => suppressClickRef.current, []);

  const handleKeyboardNudge = useCallback(
    (item: TimelineItem, empId: number, empName: string, direction: -1 | 1) => {
      if (!isBookingDraggable(item) || !operationalDate) return;

      const deltaMinutes = direction * 15;
      const proposedStartIso = snapDateTimeByMinutes(item.startTime, deltaMinutes);
      const durationMs = new Date(item.endTime).getTime() - new Date(item.startTime).getTime();
      const proposedEndIso = new Date(new Date(proposedStartIso).getTime() + durationMs).toISOString();

      setActiveDrag({
        item,
        empId,
        empName,
        originalStartIso: item.startTime,
        originalEndIso: item.endTime,
        proposedStartIso,
        proposedEndIso,
        deltaMinutes,
        previewState: 'checking',
        laneRect: new DOMRect(),
        cardHeightPx: 56,
        cardTopPx: 0,
        isCommitting: false,
      });

      scheduleServerValidate(item.sourceId, proposedStartIso);
    },
    [operationalDate, scheduleServerValidate],
  );

  const confirmPendingMove = useCallback(async () => {
    if (!confirmMove || isConfirmingMove) return;
    setIsConfirmingMove(true);
    try {
      await executeCommit({
        item: confirmMove.item,
        proposedStartIso: confirmMove.proposedStartIso,
        originalStartIso: confirmMove.originalStartIso,
        originalEndIso: confirmMove.originalEndIso,
        customerName: confirmMove.item.customerName,
      });
    } finally {
      setIsConfirmingMove(false);
    }
  }, [confirmMove, executeCommit, isConfirmingMove]);

  const cancelPendingMove = useCallback(() => {
    if (isConfirmingMove) return;
    setConfirmMove(null);
  }, [isConfirmingMove]);

  const applyTimeAdjust = useCallback(
    async (item: TimelineItem, deltaMinutes: number) => {
      if (!operationalDate || deltaMinutes === 0) return;
      const proposedStartIso = snapDateTimeByMinutes(item.startTime, deltaMinutes);
      await executeCommit({
        item,
        proposedStartIso,
        originalStartIso: item.startTime,
        originalEndIso: item.endTime,
        customerName: item.customerName,
      });
    },
    [executeCommit, operationalDate],
  );

  useEffect(() => () => {
    stopAutoScroll();
    detachWindowDragListeners();
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [detachWindowDragListeners, stopAutoScroll]);

  return {
    activeDrag,
    confirmMove,
    dragPressBookingId,
    handlePointerDown,
    handleKeyboardNudge,
    confirmPendingMove,
    cancelPendingMove,
    applyTimeAdjust,
    isConfirmingMove,
    shouldSuppressCardClick,
    isBookingDraggable,
  };
}

function snapDeltaMinutes(raw: number): number {
  return Math.round(raw / 15) * 15;
}

function formatArabicTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatMoveLabel(originalIso: string, proposedIso: string, deltaMinutes: number): string {
  const from = formatArabicTime(originalIso);
  const to = formatArabicTime(proposedIso);
  return `${from} → ${to} (${formatMinutesDeltaLabel(deltaMinutes)})`;
}

export { formatMoveLabel, formatArabicTime };
