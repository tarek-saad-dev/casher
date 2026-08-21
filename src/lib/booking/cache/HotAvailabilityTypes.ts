/**
 * Booking V2 B8 — Hot availability day entry (raw masks only).
 * Cache is NOT correctness authority. SQL / claims remain SoT for writes.
 * Never store service-specific slot start arrays.
 */

import type { AvailabilityRevisionParts } from '@/lib/booking/projection/AvailabilityRevision';
import {
  AvailabilityBitmap,
} from '@/lib/booking/domain/AvailabilityBitmap';

export type HotAvailabilityDayKey = {
  employeeId: number;
  branchId: number;
  businessDate: string; // YYYY-MM-DD
};

export type HotAvailabilityDayPayload = {
  availabilityRevision: string;
  parts: AvailabilityRevisionParts;
  effectiveWorkMask: AvailabilityBitmap;
  bookingOccupancyMask: AvailabilityBitmap;
  holdOccupancyMask: AvailabilityBitmap;
  queueOccupancyMask: AvailabilityBitmap;
  freeMask: AvailabilityBitmap;
  reusedBaseline: boolean;
  /** Diagnostic only — not used as correctness TTL alone. */
  builtAtMs: number;
};

/** Serializable form for L1/L2 (72 bytes × 5 masks ≈ 360B + meta). */
export type HotAvailabilityDayRecord = {
  employeeId: number;
  branchId: number;
  businessDate: string;
  availabilityRevision: string;
  parts: AvailabilityRevisionParts;
  effectiveWorkMaskB64: string;
  bookingOccupancyMaskB64: string;
  holdOccupancyMaskB64: string;
  queueOccupancyMaskB64: string;
  freeMaskB64: string;
  reusedBaseline: boolean;
  builtAtMs: number;
};

export function hotAvailabilityDayKeyString(key: HotAvailabilityDayKey): string {
  return `hot:${key.employeeId}:${key.branchId}:${key.businessDate}`;
}

export function encodeHotAvailabilityDay(
  key: HotAvailabilityDayKey,
  payload: HotAvailabilityDayPayload,
): HotAvailabilityDayRecord {
  return {
    employeeId: key.employeeId,
    branchId: key.branchId,
    businessDate: key.businessDate,
    availabilityRevision: payload.availabilityRevision,
    parts: { ...payload.parts },
    effectiveWorkMaskB64: payload.effectiveWorkMask.toBase64(),
    bookingOccupancyMaskB64: payload.bookingOccupancyMask.toBase64(),
    holdOccupancyMaskB64: payload.holdOccupancyMask.toBase64(),
    queueOccupancyMaskB64: payload.queueOccupancyMask.toBase64(),
    freeMaskB64: payload.freeMask.toBase64(),
    reusedBaseline: payload.reusedBaseline,
    builtAtMs: payload.builtAtMs,
  };
}

export function decodeHotAvailabilityDay(
  record: HotAvailabilityDayRecord,
): HotAvailabilityDayPayload {
  return {
    availabilityRevision: record.availabilityRevision,
    parts: { ...record.parts },
    effectiveWorkMask: AvailabilityBitmap.fromBase64(record.effectiveWorkMaskB64),
    bookingOccupancyMask: AvailabilityBitmap.fromBase64(record.bookingOccupancyMaskB64),
    holdOccupancyMask: AvailabilityBitmap.fromBase64(record.holdOccupancyMaskB64),
    queueOccupancyMask: AvailabilityBitmap.fromBase64(record.queueOccupancyMaskB64),
    freeMask: AvailabilityBitmap.fromBase64(record.freeMaskB64),
    reusedBaseline: record.reusedBaseline,
    builtAtMs: record.builtAtMs,
  };
}

/** Approx bytes for memory footprint metrics (base64 + JSON overhead). */
export function estimateHotAvailabilityRecordBytes(
  record: HotAvailabilityDayRecord,
): number {
  // 5 masks × ~96 base64 chars + meta ≈ 600–800; use measured string lengths.
  return (
    200 +
    record.effectiveWorkMaskB64.length +
    record.bookingOccupancyMaskB64.length +
    record.holdOccupancyMaskB64.length +
    record.queueOccupancyMaskB64.length +
    record.freeMaskB64.length +
    record.availabilityRevision.length
  );
}
