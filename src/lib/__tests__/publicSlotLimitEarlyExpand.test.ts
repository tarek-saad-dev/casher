import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  PUBLIC_AVAILABLE_SLOTS_LIMIT,
  PUBLIC_OVERNIGHT_SLOTS_LIMIT,
  applyPublicAvailableSlotsLimit,
} from '@/lib/bookingAvailabilityEngine';

function slot(time: string, dayOffset: 0 | 1 = 0) {
  return { time, dayOffset };
}

/** 15-min slots from startMin inclusive to endMin exclusive (minutes from midnight). */
function rangeSlots(startMin: number, endMin: number, dayOffset: 0 | 1 = 0) {
  const out = [];
  for (let m = startMin; m < endMin; m += 15) {
    const abs = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(abs / 60);
    const mm = abs % 60;
    out.push(slot(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, dayOffset));
  }
  return out;
}

describe('applyPublicAvailableSlotsLimit', () => {
  it('keeps 20:00 when early-expand morning would consume a naive day limit', () => {
    const slots = [
      ...rangeSlots(5 * 60, 16 * 60),
      ...rangeSlots(16 * 60, 24 * 60),
      ...rangeSlots(0, 2 * 60, 1),
    ];

    const limited = applyPublicAvailableSlotsLimit(slots, PUBLIC_AVAILABLE_SLOTS_LIMIT, '16:00');
    const times = limited.map((s) => s.time);
    expect(times).toContain('20:00');
    expect(times).toContain('16:00');
    expect(slots.slice(0, PUBLIC_AVAILABLE_SLOTS_LIMIT).map((s) => s.time)).not.toContain('20:00');
  });

  it('كريم-like: early expand 13:00 + overnight base 16→02 keeps 20:00 under overnight cap', () => {
    const slots = [
      ...rangeSlots(13 * 60, 16 * 60),
      ...rangeSlots(16 * 60, 24 * 60),
      ...rangeSlots(0, 90, 1),
    ];
    expect(slots.length).toBeGreaterThan(PUBLIC_AVAILABLE_SLOTS_LIMIT);
    const limited = applyPublicAvailableSlotsLimit(
      slots,
      PUBLIC_OVERNIGHT_SLOTS_LIMIT,
      '16:00',
    );
    expect(limited.map((s) => s.time)).toContain('20:00');
    expect(limited.some((s) => s.dayOffset === 1 && s.time === '00:00')).toBe(true);
  });

  it('keeps evening when early expand is extreme (05:00) under overnight cap', () => {
    const slots = [
      ...rangeSlots(5 * 60, 16 * 60),
      ...rangeSlots(16 * 60, 24 * 60),
      ...rangeSlots(0, 2 * 60, 1),
    ];
    // Naive first-56 from 05:00 ends ~19:00 and drops 20:00
    expect(slots.slice(0, PUBLIC_OVERNIGHT_SLOTS_LIMIT).map((s) => s.time)).not.toContain('20:00');
    const limited = applyPublicAvailableSlotsLimit(
      slots,
      PUBLIC_OVERNIGHT_SLOTS_LIMIT,
      '16:00',
    );
    expect(limited.map((s) => s.time)).toContain('20:00');
  });

  it('returns input when under limit', () => {
    const slots = [slot('16:00'), slot('20:00')];
    expect(applyPublicAvailableSlotsLimit(slots, 36, '16:00')).toEqual(slots);
  });

  it('falls back to naive slice when base start missing', () => {
    const slots = rangeSlots(5 * 60, 20 * 60);
    expect(applyPublicAvailableSlotsLimit(slots, 10, null)).toEqual(slots.slice(0, 10));
  });
});

describe('false-unavailable recurrence guards', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('schedule save supersedes same EffectiveFrom duplicates', () => {
    const src = read('src/lib/hr/employeeBranchScheduleSave.ts');
    expect(src).toContain('EffectiveFrom = @from');
    expect(src).toContain('SET IsActive = 0');
    expect(src).toContain('Same EffectiveFrom re-save');
  });

  it('ops workspace prefers availableSlots and rejects unavailable candidates', () => {
    const src = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(src).toContain('data.availableSlots');
    expect(src).toContain('s.available !== false');
    expect(src).not.toMatch(/\(data\.slots\s*\?\?\s*data\.availableSlots/);
  });

  it('engine uses applyPublicAvailableSlotsLimit instead of naive slice for public cap', () => {
    const src = read('src/lib/bookingAvailabilityEngine.ts');
    expect(src).toContain('applyPublicAvailableSlotsLimit(');
    expect(src).toContain('baseStart');
    expect(src).not.toMatch(
      /availableSlotsUnlimited\.slice\(\s*0\s*,\s*publicLimit\s*\)/,
    );
  });
});
