export type OpsBoardPulseSnapshot = {
  maxBookingId: number;
  bookingCount: number;
  bookingUpdatedAt: string;
  maxQueueId: number;
  queueCount: number;
  calledQueueCount: number;
  inServiceQueueCount: number;
  availabilityVersion: number;
};

export function buildOpsBoardPulseFingerprint(pulse: OpsBoardPulseSnapshot): string {
  return [
    pulse.maxBookingId,
    pulse.bookingCount,
    pulse.bookingUpdatedAt,
    pulse.maxQueueId,
    pulse.queueCount,
    pulse.calledQueueCount,
    pulse.inServiceQueueCount,
    pulse.availabilityVersion,
  ].join('|');
}

export function mergeOpsBoardPulse(
  parts: OpsBoardPulseSnapshot[],
): OpsBoardPulseSnapshot {
  return parts.reduce(
    (acc, part) => ({
      maxBookingId: Math.max(acc.maxBookingId, part.maxBookingId),
      bookingCount: acc.bookingCount + part.bookingCount,
      bookingUpdatedAt:
        part.bookingUpdatedAt > acc.bookingUpdatedAt
          ? part.bookingUpdatedAt
          : acc.bookingUpdatedAt,
      maxQueueId: Math.max(acc.maxQueueId, part.maxQueueId),
      queueCount: acc.queueCount + part.queueCount,
      calledQueueCount: acc.calledQueueCount + part.calledQueueCount,
      inServiceQueueCount: acc.inServiceQueueCount + part.inServiceQueueCount,
      availabilityVersion: Math.max(acc.availabilityVersion, part.availabilityVersion),
    }),
    {
      maxBookingId: 0,
      bookingCount: 0,
      bookingUpdatedAt: '',
      maxQueueId: 0,
      queueCount: 0,
      calledQueueCount: 0,
      inServiceQueueCount: 0,
      availabilityVersion: 0,
    } satisfies OpsBoardPulseSnapshot,
  );
}

/** Skip the first sample so opening the page does not chime. */
export function shouldPlayNewBookingAlert(
  previousMaxBookingId: number | null,
  nextMaxBookingId: number,
): boolean {
  if (previousMaxBookingId == null || previousMaxBookingId <= 0) return false;
  return nextMaxBookingId > previousMaxBookingId;
}

export function nextCalendarDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
