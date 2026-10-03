import { NextRequest } from 'next/server';
import { resolvePosPackageRequest } from '@/lib/pos/resolvePosPackageRequest';

/**
 * POST /api/pos/groom-packages/resolve
 * Groom-only variant of /api/pos/packages/resolve (kept for existing callers).
 * Body: { packageId, addonProIds?: number[] }
 * Does not trust client prices.
 */
export async function POST(req: NextRequest) {
  return resolvePosPackageRequest(req, ['groom'], '[api/pos/groom-packages/resolve]');
}
