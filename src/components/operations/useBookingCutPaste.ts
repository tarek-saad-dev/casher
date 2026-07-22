'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  commitBookingMove,
  describeMoveFailure,
  enumeratePasteCandidateSlots,
  validateMoveOnServer,
  type BookingMoveSession,
  type PasteCandidateSlot,
} from '@/lib/bookingDragReschedule';
import {
  getTimelineHeightPx,
  getTimelineTopPx,
  isBookingDraggable,
  UNDO_TIMEOUT_MS,
  type TimelineItem,
} from './schedulerUtils';

interface BarberLaneInfo {
  empId: number;
  empName: string;
  status: string;
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  timeline: TimelineItem[];
}

interface UseBookingCutPasteArgs {
  operationalDate?: string;
  barbers: BarberLaneInfo[];
  onRefresh?: () => void;
  onToast?: (message: string, ok: boolean, undo?: () => void) => void;
}

export interface PendingPasteSelection {
  slot: PasteCandidateSlot;
  validating: boolean;
  error?: string;
}

function formatArabicTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function useBookingCutPaste({
  operationalDate,
  barbers,
  onRefresh,
  onToast,
}: UseBookingCutPasteArgs) {
  const [moveSession, setMoveSession] = useState<BookingMoveSession | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<PendingPasteSelection | null>(null);
  const [mobileConfirmOpen, setMobileConfirmOpen] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobileRef = useRef(false);

  useEffect(() => {
    isMobileRef.current = typeof window !== 'undefined' && window.innerWidth < 768;
    const onResize = () => {
      isMobileRef.current = window.innerWidth < 768;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pasteCandidates = useMemo(() => {
    if (!moveSession || !operationalDate) return [] as PasteCandidateSlot[];
    const raw = enumeratePasteCandidateSlots({
      session: moveSession,
      operationalDate,
      barbers,
    });
    return raw.map((slot) => ({
      ...slot,
      topPx: getTimelineTopPx(slot.startIso),
      heightPx: getTimelineHeightPx(moveSession.durationMinutes),
    }));
  }, [moveSession, operationalDate, barbers]);

  const candidatesByEmpId = useMemo(() => {
    const map = new Map<number, PasteCandidateSlot[]>();
    for (const slot of pasteCandidates) {
      const list = map.get(slot.empId) ?? [];
      list.push(slot);
      map.set(slot.empId, list);
    }
    return map;
  }, [pasteCandidates]);

  const cancelMove = useCallback(() => {
    setMoveSession(null);
    setPendingPaste(null);
    setMobileConfirmOpen(false);
  }, []);

  const cutBooking = useCallback(
    (
      item: TimelineItem,
      empId: number,
      empName: string,
    ) => {
      if (!isBookingDraggable(item)) return;

      if (moveSession?.appointmentId === item.sourceId) {
        cancelMove();
        return;
      }

      setMoveSession({
        appointmentId: item.sourceId,
        customerName: item.customerName || item.label || '—',
        originalEmpId: empId,
        originalEmpName: empName,
        originalStartAt: item.startTime,
        originalEndAt: item.endTime,
        durationMinutes: item.durationMinutes ?? 30,
        serviceNames: item.serviceNames,
      });
      setPendingPaste(null);
      setMobileConfirmOpen(false);
    },
    [cancelMove, moveSession?.appointmentId],
  );

  const executePaste = useCallback(
    async (slot: PasteCandidateSlot) => {
      if (!moveSession || !operationalDate || isCommitting) return;

      setIsCommitting(true);
      try {
        const validation = await validateMoveOnServer({
          bookingId: moveSession.appointmentId,
          newStartAt: slot.startIso,
          operationalDate,
          targetEmpId: slot.empId,
          source: 'operations_cut_paste',
        });

        if (!validation.valid) {
          onToast?.(
            describeMoveFailure({
              code: validation.code,
              message: validation.message,
              details: validation.details,
            }),
            false,
          );
          setPendingPaste(null);
          setMobileConfirmOpen(false);
          return;
        }

        const result = await commitBookingMove({
          bookingId: moveSession.appointmentId,
          newStartAt: validation.newStartAt ?? slot.startIso,
          operationalDate,
          targetEmpId: slot.empId,
          source: 'operations_cut_paste',
        });

        if (!result.ok) {
          onToast?.(
            describeMoveFailure({
              code: result.code,
              message: result.message,
              details: result.details,
            }),
            false,
          );
          return;
        }

        const undoPayload = {
          bookingId: moveSession.appointmentId,
          newStartAt: moveSession.originalStartAt,
          targetEmpId: moveSession.originalEmpId,
          operationalDate,
        };

        const customer = moveSession.customerName;
        const targetName =
          slot.empId === moveSession.originalEmpId
            ? moveSession.originalEmpName
            : (result.newEmpName ?? slot.empName);
        const fromTime = formatArabicTime(moveSession.originalStartAt);
        const toTime = formatArabicTime(result.newStartAt ?? slot.startIso);

        const toastMsg =
          slot.empId === moveSession.originalEmpId
            ? `تم نقل موعد ${customer} من ${fromTime} إلى ${toTime}`
            : `تم نقل موعد ${customer} إلى ${targetName} من ${fromTime} إلى ${toTime}`;

        onToast?.(toastMsg, true, () => {
          void commitBookingMove({
            bookingId: undoPayload.bookingId,
            newStartAt: undoPayload.newStartAt,
            operationalDate: undoPayload.operationalDate,
            targetEmpId: undoPayload.targetEmpId,
            source: 'operations_cut_paste_undo',
          }).then((undoResult) => {
            if (undoResult.ok) {
              onRefresh?.();
              onToast?.('تم التراجع عن النقل', true);
            } else {
              onToast?.(undoResult.message ?? 'تعذر التراجع — الموعد الأصلي غير متاح', false);
            }
          });
        });

        setMoveSession(null);
        setPendingPaste(null);
        setMobileConfirmOpen(false);
        onRefresh?.();
      } finally {
        setIsCommitting(false);
      }
    },
    [isCommitting, moveSession, onRefresh, onToast, operationalDate],
  );

  const selectPasteSlot = useCallback(
    (slot: PasteCandidateSlot) => {
      if (!moveSession || isCommitting) return;

      if (isMobileRef.current) {
        setPendingPaste({ slot, validating: false });
        setMobileConfirmOpen(true);
        return;
      }

      void executePaste(slot);
    },
    [executePaste, isCommitting, moveSession],
  );

  const confirmMobilePaste = useCallback(async () => {
    if (!pendingPaste) return;
    await executePaste(pendingPaste.slot);
  }, [executePaste, pendingPaste]);

  useEffect(() => {
    if (!moveSession) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelMove();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelMove, moveSession]);

  useEffect(() => {
    cancelMove();
  }, [operationalDate, cancelMove]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [],
  );

  return {
    moveSession,
    isCommitting,
    pasteCandidates,
    candidatesByEmpId,
    pendingPaste,
    mobileConfirmOpen,
    cutBooking,
    cancelMove,
    selectPasteSlot,
    confirmMobilePaste,
    closeMobileConfirm: () => {
      setMobileConfirmOpen(false);
      setPendingPaste(null);
    },
    isBookingCuttable: isBookingDraggable,
  };
}

export { formatArabicTime as formatCutPasteArabicTime, UNDO_TIMEOUT_MS as CUT_PASTE_UNDO_MS };
