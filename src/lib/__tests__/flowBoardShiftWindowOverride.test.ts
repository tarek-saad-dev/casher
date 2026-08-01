/**
 * Flow-board must clip timelines with override-aware hours so custom_hours
 * bookings (e.g. 13:00 when weekly base is 14:00) still appear.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('flowBoardShiftWindowOverride', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/operations/loadFlowBoardForBranch.ts'),
    'utf8',
  );

  it('prefers dayStatus effectiveStart/End over presence weekly times', () => {
    expect(src).toContain(
      'dayStatus.effectiveStart ?? presenceRow?.startTime',
    );
    expect(src).toContain('dayStatus.effectiveEnd ?? presenceRow?.endTime');
    expect(src).not.toContain(
      'presenceRow?.startTime ?? dayStatus.effectiveStart',
    );
    expect(src).not.toContain('presenceRow?.endTime ?? dayStatus.effectiveEnd');
  });

  it('still drops bookings outside the computed shift via inShiftWindow', () => {
    expect(src).toContain('if (!inShiftWindow(start, end)) continue');
  });
});
