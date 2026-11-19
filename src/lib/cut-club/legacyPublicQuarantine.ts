import { NextResponse } from 'next/server';
/**
 * Legacy public-client API endpoints accepted clientId / phone from any caller.
 * Do not implement "upgrade compatibility" using unverified query params.
 * The new wallet is /api/public/cut-club/wallet and requires server-only BFF
 * auth + a revocable opaque customer session + staff-approved record binding.
 */
export const legacyCutClubPublicDenied=()=>NextResponse.json(
  {ok:false,code:'CUT_CLUB_VERIFIED_SESSION_REQUIRED'},
  {status:403,headers:{
    'Cache-Control':'private, no-store, max-age=0',
    'X-Robots-Tag':'noindex',
    'X-Content-Type-Options':'nosniff',
  }},
);
