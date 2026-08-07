import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('public available-slots lean path', () => {
  const availabilitySrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingAvailability.ts'),
    'utf8',
  );
  const engineSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/bookingAvailabilityEngine.ts'),
    'utf8',
  );
  const ownershipSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/branch/bookingQueueOwnership.ts'),
    'utf8',
  );

  it('caches before schedule classify in getPublicAvailableSlots', () => {
    const fnStart = availabilitySrc.indexOf('export async function getPublicAvailableSlots');
    const fnBody = availabilitySrc.slice(fnStart, fnStart + 3500);
    const cacheIdx = fnBody.indexOf('cacheGet<PublicAvailableSlotsResponse>');
    const classifyIdx = fnBody.indexOf('classifySpecificBarberDay');
    expect(cacheIdx).toBeGreaterThan(0);
    expect(classifyIdx).toBeGreaterThan(cacheIdx);
  });

  it('uses single-emp bookable check for specific mode', () => {
    expect(ownershipSrc).toContain('export async function isEmployeeBookableAtBranch');
    expect(engineSrc).toContain('isEmployeeBookableAtBranch');
    expect(engineSrc).toMatch(/Specific: do NOT load the full branch roster/);
  });

  it('skips public alternative-barber scan and day-plan enrichment', () => {
    expect(engineSrc).toContain("source !== 'public'");
    expect(engineSrc).toContain('Public path: skip second day-plan batch');
  });

  it('bumps availability contract/cache to v7', () => {
    expect(availabilitySrc).toContain("__pos_public_booking_availability_v7");
    expect(availabilitySrc).toMatch(/const CONTRACT = 'v7'/);
  });

  it('does not re-truncate slots in getPublicAvailableSlots merge', () => {
    expect(availabilitySrc).toMatch(/mergeCandidateSlots\(engine\.availableSlots\)/);
    expect(availabilitySrc).not.toMatch(
      /mergeCandidateSlots\(engine\.availableSlots,\s*(hasOvernight|PUBLIC_)/,
    );
  });
});
