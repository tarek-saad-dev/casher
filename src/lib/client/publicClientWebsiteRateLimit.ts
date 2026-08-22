import type { NextRequest } from 'next/server';
import { checkRateLimit, getRateLimitKey } from '@/lib/publicBookingHelpers';

const LOOKUP_MAX_PER_MIN = 30;
const UPDATE_MAX_PER_MIN = 20;

export function isPublicClientWebsiteLookupRateLimited(req: NextRequest): boolean {
  return !checkRateLimit(getRateLimitKey(req), LOOKUP_MAX_PER_MIN);
}

export function isPublicClientWebsiteUpdateRateLimited(req: NextRequest): boolean {
  return !checkRateLimit(`${getRateLimitKey(req)}:update`, UPDATE_MAX_PER_MIN);
}
