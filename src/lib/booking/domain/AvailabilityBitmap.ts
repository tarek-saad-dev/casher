/**
 * Booking V2 — reusable 5-minute availability bitmap.
 *
 * Timeline is minutes from business-day midnight on a continuous scale that
 * spans 48 hours so overnight windows (e.g. 11:00 → 01:30) fit without wrap.
 *
 * Ranges are half-open [startMin, endMin). Bits are packed LSB-first per byte.
 * This module is pure — no DB, Redis, or route imports.
 */

export const AVAILABILITY_QUANTUM_MINUTES = 5 as const;
/** Business day + next calendar morning (overnight). */
export const AVAILABILITY_TIMELINE_HOURS = 48 as const;
export const AVAILABILITY_TIMELINE_MINUTES =
  AVAILABILITY_TIMELINE_HOURS * 60; /* 2880 */
export const AVAILABILITY_SLOT_COUNT =
  AVAILABILITY_TIMELINE_MINUTES / AVAILABILITY_QUANTUM_MINUTES; /* 576 */
export const AVAILABILITY_BYTE_LENGTH = Math.ceil(AVAILABILITY_SLOT_COUNT / 8); /* 72 */

export type AvailabilityFreeRange = {
  /** Minutes from business-day midnight (may be ≥ 1440 for overnight). */
  startMin: number;
  /** Exclusive end on the same continuous timeline. */
  endMin: number;
};

function assertFiniteInt(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`INVALID_BITMAP_${name}:${String(value)}`);
  }
}

function clampSlot(slot: number): number {
  if (slot < 0) return 0;
  if (slot > AVAILABILITY_SLOT_COUNT) return AVAILABILITY_SLOT_COUNT;
  return slot;
}

/** Convert exclusive minute range → exclusive slot range (quantum-aligned cover). */
export function minutesToSlotRange(
  startMin: number,
  endMin: number,
): { startSlot: number; endSlotExclusive: number } {
  assertFiniteInt('START_MIN', startMin);
  assertFiniteInt('END_MIN', endMin);
  if (endMin <= startMin) {
    return { startSlot: 0, endSlotExclusive: 0 };
  }
  const startSlot = clampSlot(Math.floor(startMin / AVAILABILITY_QUANTUM_MINUTES));
  const endSlotExclusive = clampSlot(
    Math.ceil(endMin / AVAILABILITY_QUANTUM_MINUTES),
  );
  if (endSlotExclusive <= startSlot) {
    return { startSlot: 0, endSlotExclusive: 0 };
  }
  return { startSlot, endSlotExclusive };
}

export function slotToStartMin(slot: number): number {
  return slot * AVAILABILITY_QUANTUM_MINUTES;
}

export class AvailabilityBitmap {
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    if (bytes.length !== AVAILABILITY_BYTE_LENGTH) {
      throw new Error(`INVALID_BITMAP_LENGTH:${bytes.length}`);
    }
    this.bytes = bytes;
  }

  static empty(): AvailabilityBitmap {
    return new AvailabilityBitmap(new Uint8Array(AVAILABILITY_BYTE_LENGTH));
  }

  static full(): AvailabilityBitmap {
    const bytes = new Uint8Array(AVAILABILITY_BYTE_LENGTH);
    bytes.fill(0xff);
    // Clear unused high bits in the last byte (576 % 8 === 0 → none).
    return new AvailabilityBitmap(bytes);
  }

  static fromBytes(bytes: Uint8Array | ArrayLike<number>): AvailabilityBitmap {
    const copy = new Uint8Array(AVAILABILITY_BYTE_LENGTH);
    copy.set(bytes instanceof Uint8Array ? bytes.subarray(0, AVAILABILITY_BYTE_LENGTH) : bytes);
    return new AvailabilityBitmap(copy);
  }

  static fromBase64(b64: string): AvailabilityBitmap {
    const buf = Buffer.from(b64, 'base64');
    return AvailabilityBitmap.fromBytes(buf);
  }

  static fromFreeRanges(ranges: AvailabilityFreeRange[]): AvailabilityBitmap {
    const bm = AvailabilityBitmap.empty();
    for (const r of ranges) bm.setRange(r.startMin, r.endMin);
    return bm;
  }

  clone(): AvailabilityBitmap {
    return new AvailabilityBitmap(new Uint8Array(this.bytes));
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  toBase64(): string {
    return Buffer.from(this.bytes).toString('base64');
  }

  equals(other: AvailabilityBitmap): boolean {
    if (this.bytes.length !== other.bytes.length) return false;
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== other.bytes[i]) return false;
    }
    return true;
  }

  isEmpty(): boolean {
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== 0) return false;
    }
    return true;
  }

  /** True when slot index is free (available). */
  isSlotFree(slot: number): boolean {
    if (slot < 0 || slot >= AVAILABILITY_SLOT_COUNT) return false;
    const byte = this.bytes[slot >> 3]!;
    return ((byte >> (slot & 7)) & 1) === 1;
  }

  private setSlot(slot: number, free: boolean): void {
    if (slot < 0 || slot >= AVAILABILITY_SLOT_COUNT) return;
    const idx = slot >> 3;
    const bit = 1 << (slot & 7);
    if (free) this.bytes[idx]! |= bit;
    else this.bytes[idx]! &= ~bit & 0xff;
  }

  /** Mark [startMin, endMin) as free/available. */
  setRange(startMin: number, endMin: number): this {
    const { startSlot, endSlotExclusive } = minutesToSlotRange(startMin, endMin);
    for (let s = startSlot; s < endSlotExclusive; s++) this.setSlot(s, true);
    return this;
  }

  /** Mark [startMin, endMin) as busy/unavailable. */
  clearRange(startMin: number, endMin: number): this {
    const { startSlot, endSlotExclusive } = minutesToSlotRange(startMin, endMin);
    for (let s = startSlot; s < endSlotExclusive; s++) this.setSlot(s, false);
    return this;
  }

  and(other: AvailabilityBitmap): AvailabilityBitmap {
    const out = new Uint8Array(AVAILABILITY_BYTE_LENGTH);
    for (let i = 0; i < out.length; i++) out[i] = this.bytes[i]! & other.bytes[i]!;
    return new AvailabilityBitmap(out);
  }

  or(other: AvailabilityBitmap): AvailabilityBitmap {
    const out = new Uint8Array(AVAILABILITY_BYTE_LENGTH);
    for (let i = 0; i < out.length; i++) out[i] = this.bytes[i]! | other.bytes[i]!;
    return new AvailabilityBitmap(out);
  }

  not(): AvailabilityBitmap {
    const out = new Uint8Array(AVAILABILITY_BYTE_LENGTH);
    for (let i = 0; i < out.length; i++) out[i] = ~this.bytes[i]! & 0xff;
    return new AvailabilityBitmap(out);
  }

  /**
   * True when [startMin, startMin + durationMinutes) is entirely free.
   * Duration is covered by ceil(duration / quantum) consecutive free slots.
   */
  hasConsecutiveFreeAt(startMin: number, durationMinutes: number): boolean {
    assertFiniteInt('START_MIN', startMin);
    assertFiniteInt('DURATION', durationMinutes);
    if (durationMinutes <= 0) return true;
    const startSlot = Math.floor(startMin / AVAILABILITY_QUANTUM_MINUTES);
    const slotsNeeded = Math.ceil(durationMinutes / AVAILABILITY_QUANTUM_MINUTES);
    if (startSlot < 0 || startSlot + slotsNeeded > AVAILABILITY_SLOT_COUNT) return false;
    for (let i = 0; i < slotsNeeded; i++) {
      if (!this.isSlotFree(startSlot + i)) return false;
    }
    return true;
  }

  /**
   * Scan for any start (quantum-aligned) that fits `durationMinutes` consecutive free time.
   * Returns startMin of first fit, or null.
   */
  findConsecutiveFree(
    durationMinutes: number,
    opts?: { fromMin?: number; toMinExclusive?: number },
  ): number | null {
    assertFiniteInt('DURATION', durationMinutes);
    if (durationMinutes <= 0) return opts?.fromMin ?? 0;
    const slotsNeeded = Math.ceil(durationMinutes / AVAILABILITY_QUANTUM_MINUTES);
    const fromSlot = clampSlot(
      Math.floor((opts?.fromMin ?? 0) / AVAILABILITY_QUANTUM_MINUTES),
    );
    const toSlotExclusive = clampSlot(
      Math.ceil((opts?.toMinExclusive ?? AVAILABILITY_TIMELINE_MINUTES) / AVAILABILITY_QUANTUM_MINUTES),
    );
    let run = 0;
    for (let s = fromSlot; s < toSlotExclusive; s++) {
      if (this.isSlotFree(s)) {
        run++;
        if (run >= slotsNeeded) {
          return slotToStartMin(s - slotsNeeded + 1);
        }
      } else {
        run = 0;
      }
    }
    return null;
  }

  /** True when any consecutive free stretch of `durationMinutes` exists. */
  hasConsecutiveFree(durationMinutes: number): boolean {
    return this.findConsecutiveFree(durationMinutes) != null;
  }

  /** Merge free slots into half-open minute ranges (diagnostic). */
  toFreeRanges(): AvailabilityFreeRange[] {
    const ranges: AvailabilityFreeRange[] = [];
    let runStart: number | null = null;
    for (let s = 0; s <= AVAILABILITY_SLOT_COUNT; s++) {
      const free = s < AVAILABILITY_SLOT_COUNT && this.isSlotFree(s);
      if (free && runStart == null) runStart = s;
      if (!free && runStart != null) {
        ranges.push({
          startMin: slotToStartMin(runStart),
          endMin: slotToStartMin(s),
        });
        runStart = null;
      }
    }
    return ranges;
  }

  countFreeSlots(): number {
    let n = 0;
    for (let s = 0; s < AVAILABILITY_SLOT_COUNT; s++) {
      if (this.isSlotFree(s)) n++;
    }
    return n;
  }
}
