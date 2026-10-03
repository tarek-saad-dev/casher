import { NextRequest } from 'next/server';
import { resolvePosPackageRequest } from '@/lib/pos/resolvePosPackageRequest';

/**
 * POST /api/pos/packages/resolve
 * Direct POS package sale (regular + groom) — same resolver as groom booking.
 * Body: { packageId, addonProIds?: number[] }
 * Does not trust client prices.
 */
export async function POST(req: NextRequest) {
  return resolvePosPackageRequest(req, ['regular', 'groom'], '[api/pos/packages/resolve]');
}
