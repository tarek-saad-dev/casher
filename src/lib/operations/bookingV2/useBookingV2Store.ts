'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  getBookingV2StoreSnapshot,
  openBookingV2Flow,
  prefetchBookingV2Availability,
  prefetchBookingV2Bootstrap,
  refreshActiveBookingV2Matrix,
  setBookingV2Selection,
  subscribeBookingV2Store,
  getServicesForBranch,
  hasMatrixCoverageForDate,
} from '@/lib/operations/bookingV2/store';
import type { BookingV2StoreSnapshot } from '@/lib/operations/bookingV2/types';

export function useBookingV2Store(): BookingV2StoreSnapshot {
  return useSyncExternalStore(
    subscribeBookingV2Store,
    getBookingV2StoreSnapshot,
    getBookingV2StoreSnapshot,
  );
}

export function useBookingV2Actions() {
  return {
    prefetchBootstrap: useCallback(() => prefetchBookingV2Bootstrap(), []),
    prefetchAvailability: useCallback(
      (args?: Parameters<typeof prefetchBookingV2Availability>[0]) =>
        prefetchBookingV2Availability(args),
      [],
    ),
    openFlow: useCallback(
      (args: Parameters<typeof openBookingV2Flow>[0]) => openBookingV2Flow(args),
      [],
    ),
    setSelection: useCallback(
      (patch: Parameters<typeof setBookingV2Selection>[0]) =>
        setBookingV2Selection(patch),
      [],
    ),
    refreshMatrix: useCallback(() => refreshActiveBookingV2Matrix(), []),
    getServicesForBranch,
    hasMatrixCoverageForDate,
  };
}