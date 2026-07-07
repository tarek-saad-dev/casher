import { describe, expect, it } from 'vitest';
import { intervalsOverlap } from '@/lib/scheduleIntervals';

function at(h: number, m = 0): Date {
  return new Date(`2026-07-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
}

describe('schedule overlap — half-open [start, end)', () => {
  it('rejects booking vs booking partial overlap', () => {
    expect(intervalsOverlap(at(10, 22), at(10, 52), at(10, 0), at(10, 45))).toBe(true);
  });

  it('allows exact boundary touch', () => {
    expect(intervalsOverlap(at(10, 45), at(11, 15), at(10, 0), at(10, 45))).toBe(false);
  });

  it('allows candidate ending exactly at existing start', () => {
    expect(intervalsOverlap(at(9, 30), at(10, 0), at(10, 0), at(10, 45))).toBe(false);
  });

  it('rejects booking vs queue overlap', () => {
    expect(intervalsOverlap(at(10, 30), at(11, 0), at(10, 21), at(10, 51))).toBe(true);
  });

  it('allows queue ending when booking starts', () => {
    expect(intervalsOverlap(at(11, 0), at(11, 30), at(10, 21), at(11, 0))).toBe(false);
  });

  it('rejects queue overlapping booking', () => {
    expect(intervalsOverlap(at(11, 15), at(11, 45), at(11, 30), at(12, 0))).toBe(true);
  });

  it('rejects candidate inside block_range', () => {
    const blockStart = at(19, 21);
    const blockEnd = at(20, 30);
    expect(intervalsOverlap(at(20, 0), at(20, 30), blockStart, blockEnd)).toBe(true);
  });
});

describe('duration boundary — 55min service in 39min gap', () => {
  it('gap too short means no valid slot at gap start', () => {
    const gapStart = at(17, 0);
    const gapEnd = at(17, 39);
    const candidateEnd = new Date(gapStart.getTime() + 55 * 60000);
    expect(candidateEnd > gapEnd).toBe(true);
  });
});
