'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeAnchoredScrollTop,
  getCairoBusinessDate,
  getCurrentTimeScrollY,
  resolveMobileAllScrollTargetY,
  resolveTimelineTargetScrollY,
  type TimelineBarber,
} from './schedulerUtils';
import type { MobileBarberSelection } from './BarberMobileSelector';

interface UseTimelineAutoScrollOptions {
  selectedDate?: string;
  headerHeight: number;
  laneHeight: number;
  loading: boolean;
  hasBarbers: boolean;
  mobileBarberSelection: MobileBarberSelection;
  desktopScrollRef: React.RefObject<HTMLDivElement | null>;
  mobileScrollRef: React.RefObject<HTMLDivElement | null>;
  barbers: TimelineBarber[];
}

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

function getActiveScrollElement(
  desktopRef: React.RefObject<HTMLDivElement | null>,
  mobileRef: React.RefObject<HTMLDivElement | null>,
): HTMLDivElement | null {
  if (isMobileViewport()) return mobileRef.current;
  return desktopRef.current;
}

export function useTimelineAutoScroll({
  selectedDate,
  headerHeight,
  laneHeight,
  loading,
  hasBarbers,
  mobileBarberSelection,
  desktopScrollRef,
  mobileScrollRef,
  barbers,
}: UseTimelineAutoScrollOptions) {
  const hasAutoScrolledForKeyRef = useRef<string | null>(null);
  const userHasScrolledRef = useRef(false);
  const [showReturnToNow, setShowReturnToNow] = useState(false);

  const scrollGuardKey = `${selectedDate ?? ''}:${mobileBarberSelection}`;

  const resolveTargetY = useCallback(() => {
    if (!selectedDate) return headerHeight;

    if (isMobileViewport() && mobileBarberSelection === 'all') {
      return resolveMobileAllScrollTargetY(selectedDate, barbers, headerHeight, laneHeight);
    }

    return resolveTimelineTargetScrollY(selectedDate, barbers, headerHeight);
  }, [selectedDate, barbers, headerHeight, laneHeight, mobileBarberSelection]);

  const scrollTimelineToY = useCallback(
    (targetY: number, behavior: ScrollBehavior) => {
      const el = getActiveScrollElement(desktopScrollRef, mobileScrollRef);
      if (!el) return false;

      const top = computeAnchoredScrollTop(targetY, el.clientHeight, el.scrollHeight, 0.3);
      el.scrollTo({ top, behavior });
      return true;
    },
    [desktopScrollRef, mobileScrollRef],
  );

  const scrollToCurrentTime = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const currentY = getCurrentTimeScrollY(headerHeight);
      if (currentY === null) return;

      scrollTimelineToY(currentY, behavior);
      setShowReturnToNow(false);
    },
    [headerHeight, scrollTimelineToY],
  );

  const updateReturnToNowVisibility = useCallback(() => {
    if (!selectedDate || selectedDate !== getCairoBusinessDate()) {
      setShowReturnToNow(false);
      return;
    }

    const el = getActiveScrollElement(desktopScrollRef, mobileScrollRef);
    const currentY = getCurrentTimeScrollY(headerHeight);
    if (!el || currentY === null) {
      setShowReturnToNow(false);
      return;
    }

    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    const margin = 48;
    const isVisible = currentY >= viewTop + margin && currentY <= viewBottom - margin;
    setShowReturnToNow(!isVisible && userHasScrolledRef.current);
  }, [selectedDate, headerHeight, desktopScrollRef, mobileScrollRef]);

  useEffect(() => {
    hasAutoScrolledForKeyRef.current = null;
    userHasScrolledRef.current = false;
    setShowReturnToNow(false);
  }, [scrollGuardKey]);

  useEffect(() => {
    if (loading || !hasBarbers || !selectedDate) return;
    if (hasAutoScrolledForKeyRef.current === scrollGuardKey) return;

    let cancelled = false;
    let attempts = 0;

    const runAutoScroll = () => {
      if (cancelled || attempts > 12) return;
      attempts += 1;

      const el = getActiveScrollElement(desktopScrollRef, mobileScrollRef);
      if (!el || el.clientHeight === 0) {
        requestAnimationFrame(runAutoScroll);
        return;
      }

      const targetY = resolveTargetY();
      const didScroll = scrollTimelineToY(targetY, 'auto');
      if (didScroll) {
        hasAutoScrolledForKeyRef.current = scrollGuardKey;
        userHasScrolledRef.current = false;
        updateReturnToNowVisibility();
      }
    };

    requestAnimationFrame(runAutoScroll);

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    hasBarbers,
    selectedDate,
    scrollGuardKey,
    resolveTargetY,
    scrollTimelineToY,
    updateReturnToNowVisibility,
    desktopScrollRef,
    mobileScrollRef,
  ]);

  useEffect(() => {
    const desktopEl = desktopScrollRef.current;
    const mobileEl = mobileScrollRef.current;

    const handleScroll = (event: Event) => {
      if (hasAutoScrolledForKeyRef.current !== scrollGuardKey) return;

      if (event.isTrusted) {
        userHasScrolledRef.current = true;
      }

      updateReturnToNowVisibility();
    };

    desktopEl?.addEventListener('scroll', handleScroll, { passive: true });
    mobileEl?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      desktopEl?.removeEventListener('scroll', handleScroll);
      mobileEl?.removeEventListener('scroll', handleScroll);
    };
  }, [
    scrollGuardKey,
    updateReturnToNowVisibility,
    desktopScrollRef,
    mobileScrollRef,
    loading,
    hasBarbers,
  ]);

  return {
    showReturnToNow: showReturnToNow && selectedDate === getCairoBusinessDate(),
    scrollToCurrentTime,
  };
}
