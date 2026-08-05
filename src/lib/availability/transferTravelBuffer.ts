/**
 * Multi-branch transfer travel buffer — Phase F.
 * Mandatory 60 minutes blocked around transfer edges for booking/queue.
 */
export const TRANSFER_TRAVEL_BUFFER_MINUTES = 60;
export const TRAVEL_BUFFER_BLOCK = 'TRAVEL_BUFFER' as const;

export type TravelBufferInterval = {
  startMs: number;
  endMs: number;
  reasonCode: typeof TRAVEL_BUFFER_BLOCK;
  fromBranchId: number;
  toBranchId: number;
};

/**
 * Build blocked intervals for a same-day transfer.
 * Buffer blocks booking/queue on both sides of the transfer moment.
 */
export function buildTransferTravelBuffers(args: {
  transferAtMs: number;
  fromBranchId: number;
  toBranchId: number;
  bufferMinutes?: number;
}): TravelBufferInterval[] {
  const buf = (args.bufferMinutes ?? TRANSFER_TRAVEL_BUFFER_MINUTES) * 60_000;
  const mid = args.transferAtMs;
  return [
    {
      startMs: mid - buf,
      endMs: mid,
      reasonCode: TRAVEL_BUFFER_BLOCK,
      fromBranchId: args.fromBranchId,
      toBranchId: args.toBranchId,
    },
    {
      startMs: mid,
      endMs: mid + buf,
      reasonCode: TRAVEL_BUFFER_BLOCK,
      fromBranchId: args.fromBranchId,
      toBranchId: args.toBranchId,
    },
  ];
}

export function intervalOverlapsTravelBuffer(
  startMs: number,
  endMs: number,
  buffers: TravelBufferInterval[],
): TravelBufferInterval | null {
  for (const b of buffers) {
    if (startMs < b.endMs && endMs > b.startMs) return b;
  }
  return null;
}
